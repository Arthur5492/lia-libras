// Entry point for Vercel Functions. All /api/* requests come here (see vercel.json).
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleNode } from "../server/node.js";

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleNode(req, res);
}
