import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

const MAX_BODY_BYTES = 64 * 1024;

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

    // Structured JSON (machine-readable, for KQL / later analysis)
    context.log(JSON.stringify(entry));

    // Human-readable access summary at warn level so every hit stands out
    // in Log Stream / Application Insights filters.
    const ip = clientIpFromHeaders(headers);
    const ua = headers["user-agent"]?.[0] ?? "-";
    const pathDisplay = entry.raw_query ? `${entry.path}?${entry.raw_query}` : entry.path;
    context.warn(`[ACCESS] ${entry.method} ${pathDisplay} ip=${ip} ua="${ua}"`);

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
