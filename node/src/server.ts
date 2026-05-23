import { createServer, IncomingMessage, ServerResponse } from "http";

const MAX_BODY_BYTES = 64 * 1024;

interface Entry {
    time: string;
    method: string;
    path: string;
    raw_query?: string;
    host: string | null;
    source_ip: string;
    headers: Record<string, string | string[] | undefined>;
    body_len: number;
    body_truncated?: boolean;
    body?: string;
    body_b64?: string;
}

function clientIp(req: IncomingMessage): string {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
        return xff.split(",")[0].trim().replace(/:\d+$/, "");
    }
    if (Array.isArray(xff) && xff.length > 0) {
        return xff[0].split(",")[0].trim().replace(/:\d+$/, "");
    }
    return req.socket.remoteAddress ?? "unknown";
}

async function readBody(req: IncomingMessage): Promise<{ buf: Buffer; truncated: boolean }> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        req.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                truncated = true;
                const need = MAX_BODY_BYTES - (total - chunk.length);
                if (need > 0) chunks.push(chunk.subarray(0, need));
            } else {
                chunks.push(chunk);
            }
        });
        req.on("end", () => resolve({ buf: Buffer.concat(chunks), truncated }));
        req.on("error", reject);
    });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { buf, truncated } = await readBody(req);

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const entry: Entry = {
        time: new Date().toISOString(),
        method: req.method ?? "GET",
        path: url.pathname,
        host: (req.headers.host as string | undefined) ?? null,
        source_ip: clientIp(req),
        headers: req.headers as Record<string, string | string[] | undefined>,
        body_len: buf.length,
    };
    if (url.search.length > 1) entry.raw_query = url.search.slice(1);
    if (truncated) entry.body_truncated = true;
    if (buf.length > 0) {
        const text = buf.toString("utf8");
        if (Buffer.from(text, "utf8").equals(buf)) {
            entry.body = text;
        } else {
            entry.body_b64 = buf.toString("base64");
        }
    }

    // Structured JSON (machine-readable)
    process.stdout.write(JSON.stringify(entry) + "\n");

    // Human-readable warn line — every request stands out in container logs.
    const ua = (req.headers["user-agent"] as string | undefined) ?? "-";
    const pathDisplay = entry.raw_query ? `${entry.path}?${entry.raw_query}` : entry.path;
    process.stderr.write(
        `[ACCESS] ${entry.method} ${pathDisplay} ip=${entry.source_ip} ua="${ua}"\n`,
    );

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("404 not found\n");
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => {
    process.stderr.write(`listening on :${port}\n`);
});
