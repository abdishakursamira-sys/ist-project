import { PoolClient } from "pg";
import { pool, withTransaction } from "../config/db";
import { env } from "../config/env";
import { Recommendation } from "../types";
import { genresOf, notSeen } from "./sql";

export const RECOMMENDATION_COUNT = 12;   // [5] movies returned per request
const POOL_SIZE = 60;                     // [4] how many are stored per refresh
const ANN_CANDIDATES = 200;               // nearest neighbours pulled from the HNSW index
const MAX_AGE_HOURS = 24;                 // refresh at least daily...
const REFRESH_AFTER_NEW_SIGNALS = 10;     // ...or after 10 new likes/watches
const HALF_LIFE_DAYS = 14;                // [9] an activity's weight halves every 14 days
const TASTE_SAMPLE = 100;                 // most recent liked/watched movies used for the taste vector

interface Candidate { movieId: number; percent: number; reason: string }

/** Rescales cosine similarity [floor, 1] to 0-100%. Tune MATCH_SIM_FLOOR to your embedding model. */
export function similarityToPercent(sim: number): number {
  const scaled = (sim - env.MATCH_SIM_FLOOR) / (1 - env.MATCH_SIM_FLOOR);
  return Math.round(Math.min(1, Math.max(0, scaled)) * 100);
}

/**
 * [5] Returns 12 unseen recommendations with match % and a reason.
 * Normal case: a cheap read of the stored pool [4]. The pool is only recomputed when stale.
 */
export async function getRecommendations(userId: string): Promise<Recommendation[]> {
  if (await needsRefresh(userId)) await refreshRecommendations(userId);
  return readStored(userId, RECOMMENDATION_COUNT);
}

/** Stale if never generated, older than 24h, 10+ new likes/watches since, or fewer than 12 unseen left. */
async function needsRefresh(userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT s.generated_at,
            ((SELECT count(*) FROM swipe_history sh
               WHERE sh.user_id = s.user_id AND sh.action = 'liked' AND sh.created_at > s.generated_at)
           + (SELECT count(*) FROM watched_movies w
               WHERE w.user_id = s.user_id AND w.watched_at > s.generated_at))::int AS new_signals,
            (SELECT count(*) FROM recommendations r
               WHERE r.user_id = s.user_id AND ${notSeen("s.user_id", "r.movie_id")})::int AS remaining
     FROM user_rec_state s WHERE s.user_id = $1`,
    [userId],
  );
  const s = rows[0];
  if (!s) return true;
  const ageHours = (Date.now() - new Date(s.generated_at).getTime()) / 3_600_000;
  return ageHours > MAX_AGE_HOURS || s.new_signals >= REFRESH_AFTER_NEW_SIGNALS || s.remaining < RECOMMENDATION_COUNT;
}

async function readStored(userId: string, limit: number): Promise<Recommendation[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.title, m.release_year, m.poster_url, ${genresOf("m.id")} AS genres,
            r.match_percent, r.reason
     FROM recommendations r JOIN movies m ON m.id = r.movie_id
     WHERE r.user_id = $1 AND ${notSeen("r.user_id", "r.movie_id")}
     ORDER BY r.match_percent DESC, m.popularity DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    movieId: Number(r.id), title: r.title, releaseYear: r.release_year, posterUrl: r.poster_url,
    genres: r.genres, matchPercent: r.match_percent, reason: r.reason,
  }));
}

/** Recomputes and stores the pool. The advisory lock stops two tabs from refreshing at once. */
export async function refreshRecommendations(userId: string): Promise<void> {
  await withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [userId]);

    const taste = await buildTasteVector(db, userId);
    let candidates = taste
      ? await personalizedCandidates(db, userId, taste)
      : await coldStartCandidates(db, userId);          // [7] no history yet: use signup genres
    if (candidates.length === 0) candidates = await popularCandidates(db, userId);

    await db.query(`DELETE FROM recommendations WHERE user_id = $1`, [userId]);
    if (candidates.length) {
      await db.query(
        `INSERT INTO recommendations (user_id, movie_id, match_percent, reason)
         SELECT $1, t.movie_id, t.pct, t.reason
         FROM unnest($2::bigint[], $3::int[], $4::text[]) AS t(movie_id, pct, reason)`,
        [userId, candidates.map((c) => c.movieId), candidates.map((c) => c.percent), candidates.map((c) => c.reason)],
      );
    }
    await db.query(
      `INSERT INTO user_rec_state (user_id, generated_at) VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET generated_at = EXCLUDED.generated_at`,
      [userId],
    );
  });
}

/**
 * [9] Taste vector = recency-weighted average of the embeddings of movies the user liked or watched.
 * Weight = 0.5 ^ (ageInDays / 14), so last week's likes count far more than last year's.
 * (A movie that was both liked and watched counts twice: a deliberately stronger signal.)
 * Weighting happens in Node because pgvector can't multiply a vector by a scalar.
 * Dislikes are not used here; they only exclude movies from future results.
 */
async function buildTasteVector(db: PoolClient, userId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT m.embedding::real[] AS v, x.at
     FROM (SELECT movie_id, created_at AS at FROM swipe_history WHERE user_id = $1 AND action = 'liked'
           UNION ALL
           SELECT movie_id, watched_at AS at FROM watched_movies WHERE user_id = $1) x
     JOIN movies m ON m.id = x.movie_id
     WHERE m.embedding IS NOT NULL
     ORDER BY x.at DESC LIMIT $2`,
    [userId, TASTE_SAMPLE],
  );
  if (rows.length === 0) return null;

  const sum = new Array<number>(rows[0].v.length).fill(0);
  const now = Date.now();
  for (const r of rows) {
    const ageDays = Math.max(0, (now - new Date(r.at).getTime()) / 86_400_000);
    const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    for (let i = 0; i < sum.length; i++) sum[i] += weight * Number(r.v[i]);
  }
  const norm = Math.sqrt(sum.reduce((a, x) => a + x * x, 0));
  return norm === 0 ? null : `[${sum.map((x) => x / norm).join(",")}]`;
}

/** Nearest unseen movies to the taste vector, each with a match % and a human-readable reason. */
async function personalizedCandidates(db: PoolClient, userId: string, taste: string): Promise<Candidate[]> {
  // pgvector >= 0.8: keep scanning the index until enough rows survive the "unseen" filter.
  await db.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
  await db.query(`SET LOCAL hnsw.ef_search = 100`);

  const { rows } = await db.query(
    `SELECT n.id, n.sim, n.genres,
            (SELECT lm.title FROM swipe_history sh JOIN movies lm ON lm.id = sh.movie_id
              WHERE sh.user_id = $1 AND sh.action = 'liked' AND lm.embedding IS NOT NULL
              ORDER BY lm.embedding <=> n.embedding LIMIT 1) AS similar_to
     FROM (
       SELECT m.id, m.embedding, m.embedding <=> $2::vector AS dist,
              1 - (m.embedding <=> $2::vector) AS sim, ${genresOf("m.id")} AS genres
       FROM movies m
       WHERE m.embedding IS NOT NULL AND ${notSeen("$1", "m.id")}
       ORDER BY m.embedding <=> $2::vector
       LIMIT $3
     ) n
     ORDER BY n.dist       -- re-sort: relaxed_order can return rows slightly out of order
     LIMIT $4`,
    [userId, taste, ANN_CANDIDATES, POOL_SIZE],
  );

  const favs = await favoriteGenreNames(db, userId);
  return rows.map((r) => {
    const reasons: string[] = [];
    if (r.similar_to) reasons.push(`Because you liked ${r.similar_to}`);
    const shared = (r.genres as string[]).filter((g) => favs.has(g));
    if (shared.length) reasons.push(`Matches your favorite genres: ${shared.join(", ")}`);
    return {
      movieId: Number(r.id),
      percent: similarityToPercent(Number(r.sim)),
      reason: reasons.join(" · ") || "Similar to your recent taste",
    };
  });
}

/** [7] New user, no history: rank by how many of their 3 signup genres a movie matches. */
async function coldStartCandidates(db: PoolClient, userId: string): Promise<Candidate[]> {
  const { rows } = await db.query(
    `SELECT m.id, array_agg(g.name ORDER BY g.name) AS matched
     FROM movies m
     JOIN movie_genres mg ON mg.movie_id = m.id
     JOIN user_favorite_genres f ON f.genre_id = mg.genre_id AND f.user_id = $1
     JOIN genres g ON g.id = mg.genre_id
     WHERE ${notSeen("$1", "m.id")}
     GROUP BY m.id, m.popularity
     ORDER BY count(*) DESC, m.popularity DESC
     LIMIT $2`,
    [userId, POOL_SIZE],
  );
  return rows.map((r) => ({
    movieId: Number(r.id),
    percent: Math.min(95, 55 + 15 * r.matched.length),   // 1 genre = 70%, 2 = 85%, 3 = 95%
    reason: `Matches your favorite genres: ${r.matched.join(", ")}`,
  }));
}

/** Last resort (no history and no matching genres): most popular unseen movies. */
async function popularCandidates(db: PoolClient, userId: string): Promise<Candidate[]> {
  const { rows } = await db.query(
    `SELECT m.id FROM movies m WHERE ${notSeen("$1", "m.id")} ORDER BY m.popularity DESC LIMIT $2`,
    [userId, POOL_SIZE],
  );
  return rows.map((r) => ({ movieId: Number(r.id), percent: 50, reason: "Popular right now" }));
}

async function favoriteGenreNames(db: PoolClient, userId: string): Promise<Set<string>> {
  const { rows } = await db.query(
    `SELECT g.name FROM user_favorite_genres f JOIN genres g ON g.id = f.genre_id WHERE f.user_id = $1`,
    [userId],
  );
  return new Set(rows.map((r) => r.name as string));
}
