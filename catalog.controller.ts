import { Request, Response } from "express";
import { z } from "zod";
import * as catalog from "../services/catalog.service";
import { HttpError } from "../middleware/errors";

const id = z.coerce.number().int().positive();
const browseQuery = z.object({
  genre: z.string().min(1).max(40),                            // genre slug, e.g. "sci-fi"
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const genres = async (_req: Request, res: Response) => { res.json(await catalog.listGenres()); };

export async function browse(req: Request, res: Response) {
  const q = browseQuery.parse(req.query);
  res.json(await catalog.browseByGenre(req.userId, q.genre, q.limit, q.offset));
}

export async function watched(req: Request, res: Response) {
  const created = await catalog.markWatched(req.userId, id.parse(req.params.id));
  res.status(created ? 201 : 200).json({ watched: true });
}

export const watchlist = async (req: Request, res: Response) => { res.json(await catalog.getWatchlist(req.userId)); };

export async function removeFromWatchlist(req: Request, res: Response) {
  if (!(await catalog.removeFromWatchlist(req.userId, id.parse(req.params.movieId)))) {
    throw new HttpError(404, "Movie is not in your watchlist");
  }
  res.status(204).end();
}
