import { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/errors";
import * as swipes from "../services/swipe.service";

const swipeSchema = z.object({ movieId: z.number().int().positive(), action: z.enum(["liked", "disliked"]) });
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function create(req: Request, res: Response) {
  const { movieId, action } = swipeSchema.parse(req.body);
  const saved = await swipes.recordSwipe(req.userId, movieId, action);
  if (!saved) throw new HttpError(409, "You have already swiped on or watched this movie");
  res.status(201).json(saved);
}

export async function history(req: Request, res: Response) {
  const { limit, offset } = pageSchema.parse(req.query);
  res.json(await swipes.getSwipeHistory(req.userId, limit, offset));
}
