import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

/** Requires "Authorization: Bearer <jwt>". Pins the algorithm so tokens can't be forged with "none". */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "string" || typeof payload.sub !== "string") throw new Error("bad token");
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
