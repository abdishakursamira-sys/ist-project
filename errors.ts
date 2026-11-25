import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Express 4 doesn't catch rejected promises; this forwards them to the error handler. */
export const ah = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

/** Central error handler: clients never see SQL or stack traces. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", details: err.flatten().fieldErrors });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });

  const e = err as { code?: string; status?: number; type?: string };
  if (e.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON" });
  switch (e.code) {
    case "23505": return res.status(409).json({ error: "Already exists" });              // unique violation
    case "23503": return res.status(404).json({ error: "Referenced item not found" });  // foreign key
    case "23514":                                                                         // check / trigger
    case "22P02": return res.status(400).json({ error: "Invalid data" });                // bad uuid / enum
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
