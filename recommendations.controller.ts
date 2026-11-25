import { Request, Response } from "express";
import { getRecommendations } from "../services/recommendation.service";

/** GET /api/recommendations: 12 movies with match % and a reason for each. */
export async function list(req: Request, res: Response) {
  res.json(await getRecommendations(req.userId));
}
