// Entry point for Vercel Functions. All /api/* requests come here (see vercel.json).
import { app } from "../server/app.js";

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
