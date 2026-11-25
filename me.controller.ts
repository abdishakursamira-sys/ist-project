import { Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../middleware/errors";
import { importSampleHistory } from "../services/sample.service";
import { getUserStats } from "../services/stats.service";

export const stats = async (req: Request, res: Response) => { res.json(await getUserStats(req.userId)); };

/** POST /api/dev/sample-history: disabled unless ALLOW_SAMPLE_IMPORT=true. */
export async function sampleHistory(req: Request, res: Response) {
  if (!env.ALLOW_SAMPLE_IMPORT) throw new HttpError(404, "Not found");
  res.status(201).json(await importSampleHistory(req.userId));
}
