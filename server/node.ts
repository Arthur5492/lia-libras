// Adapter from Node HTTP (Vercel Functions and the local server) to the Hono app.
import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "./app.js";

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  // Vercel can parse the body before the function runs. Then the stream is empty.
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.isBuffer(parsed)) return parsed;
    return Buffer.from(typeof parsed === "string" ? parsed : JSON.stringify(parsed));
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export async function handleNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  const body = await readBody(req);
  const response = await app.fetch(
    new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers,
      body: body as BodyInit | undefined,
    }),
  );
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
