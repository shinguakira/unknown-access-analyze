import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

const MAX_BODY_BYTES = 64 * 1024;

// Endpoints commonly probed by credential / config / vuln scanners.
// A hit on any of these almost always means "someone is fishing for secrets",
// not legitimate traffic — gets escalated to a warn-level log.
const SUSPICIOUS_PATH_PATTERNS: RegExp[] = [
    /\.env(\.|$)/i,                      // /.env, /.env.local, /.env.prod
    /\.git(\/|$)/i,                      // /.git/config, /.git/HEAD
    /\.aws\/credentials/i,
    /\.ssh\/(id_rsa|authorized_keys)/i,
    /\.htpasswd|\.htaccess/i,
    /\.DS_Store$/i,
    /\b(wp-admin|wp-login|wp-config|xmlrpc\.php)\b/i, // WordPress
    /\bphpmyadmin\b/i,
    /\b(actuator|jmx-console|invoker)\b/i, // Spring Boot / JBoss
    /\b(\.well-known\/security\.txt)\b/i,
    /\b(server-status|server-info)\b/i,    // Apache mod_status
    /\b(config\.json|config\.yaml|config\.yml|secrets\.json)\b/i,
    /\b(\.\.[\/\\])/,                      // path traversal
    /%2e%2e/i,                             // encoded path traversal
    /\b(eval-stdin\.php|cgi-bin)\b/i,
    /\b(boaform|GponForm|HNAP1)\b/i,       // router/IoT exploits
];

function classifyPath(path: string): "suspicious" | "normal" {
    return SUSPICIOUS_PATH_PATTERNS.some((re) => re.test(path)) ? "suspicious" : "normal";
}

function clientIpFromHeaders(headers: Record<string, string[]>): string {
    // Azure populates several IP headers; prefer x-forwarded-for, then client-ip.
    const xff = headers["x-forwarded-for"]?.[0];
    if (xff) return xff.split(",")[0].trim().replace(/:\d+$/, "");
    const ci = headers["client-ip"]?.[0];
    if (ci) return ci.replace(/:\d+$/, "");
    return "unknown";
}

interface Entry {
    time: string;
    method: string;
    path: string;
    raw_query?: string;
    host: string | null;
    headers: Record<string, string[]>;
    body_len: number;
    body_truncated?: boolean;
    body?: string;
    body_b64?: string;
}

export async function catchall(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    const headers: Record<string, string[]> = {};
    request.headers.forEach((value, key) => {
        if (!headers[key]) headers[key] = [];
        headers[key].push(value);
    });

    const buf = Buffer.from(await request.arrayBuffer());
    const truncated = buf.length > MAX_BODY_BYTES;
    const body = truncated ? buf.subarray(0, MAX_BODY_BYTES) : buf;

    const url = new URL(request.url);
    const entry: Entry = {
        time: new Date().toISOString(),
        method: request.method,
        path: url.pathname,
        host: request.headers.get("host"),
        headers,
        body_len: body.length,
    };
    if (url.search.length > 1) entry.raw_query = url.search.slice(1);
    if (truncated) entry.body_truncated = true;
    if (body.length > 0) {
        const text = body.toString("utf8");
        // Round-trip check: if re-encoding matches, it's valid UTF-8.
        if (Buffer.from(text, "utf8").equals(body)) {
            entry.body = text;
        } else {
            entry.body_b64 = body.toString("base64");
        }
    }

    // 1. Full structured log (machine-readable, for later analysis)
    context.log(JSON.stringify(entry));

    // 2. Human-readable access summary — the line you scan with your eyes.
    //    Suspicious paths get warn level so they stand out in Log Stream / KQL filters.
    const ip = clientIpFromHeaders(headers);
    const ua = headers["user-agent"]?.[0] ?? "-";
    const pathDisplay = entry.raw_query ? `${entry.path}?${entry.raw_query}` : entry.path;
    const summary = `[ACCESS] ${entry.method} ${pathDisplay} ip=${ip} ua="${ua}"`;

    if (classifyPath(entry.path) === "suspicious") {
        context.warn(`[SUSPICIOUS] ${summary}`);
    } else {
        context.log(summary);
    }

    return {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "404 not found\n",
    };
}

app.http("catchall", {
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    authLevel: "anonymous",
    route: "{*path}",
    handler: catchall,
});
