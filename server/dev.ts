// Local API server for development. Run with the Firebase emulators (see README.md).
import { createServer } from "node:http";
import { app } from "./app";

const port = Number(process.env.PORT || 8000);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const method = req.method ?? "GET";
  const response = await app.fetch(
    new Request(`http://localhost:${port}${req.url}`, {
      method,
      headers: req.headers as Record<string, string>,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`API on http://127.0.0.1:${port}`));
