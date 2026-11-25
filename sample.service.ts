import { withTransaction } from "../config/db";
import { HttpError } from "../middleware/errors";
import { notSeen } from "./sql";

const LIKED = 6, DISLIKED = 3, WATCHED = 3;
export const SAMPLE_COUNT = LIKED + DISLIKED + WATCHED;   // [10] exactly 12 movies

/**
 * [10] Adds 12 random unseen movies to the user's history (6 liked, 3 disliked, 3 watched), dated over
 * the last 12 days so recency weighting is visible. Then clears the stored recommendation state so the
 * next request is computed from the new history. For testing and demos only (see ALLOW_SAMPLE_IMPORT).
 */
export async function importSampleHistory(userId: string) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT m.id FROM movies m WHERE ${notSeen("$1", "m.id")} ORDER BY random() LIMIT $2`,
      [userId, SAMPLE_COUNT],
    );
    if (rows.length < SAMPLE_COUNT) throw new HttpError(400, "Not enough unseen movies to import a sample history");

    const ids = rows.map((r) => Number(r.id));
    const swiped = ids.slice(0, LIKED + DISLIKED);
    const actions = swiped.map((_, i) => (i < LIKED ? "liked" : "disliked"));

    await db.query(
      `INSERT INTO swipe_history (user_id, movie_id, action, match_percent, created_at)
       SELECT $1, t.movie_id, t.action::swipe_action, 55 + floor(random() * 41)::int,
              now() - (t.ord::float8 * interval '1 day')
       FROM unnest($2::bigint[], $3::text[]) WITH ORDINALITY AS t(movie_id, action, ord)`,
      [userId, swiped, actions],
    );
    await db.query(
      `INSERT INTO watched_movies (user_id, movie_id, watched_at)
       SELECT $1, t.movie_id, now() - ((t.ord + 9)::float8 * interval '1 day')
       FROM unnest($2::bigint[]) WITH ORDINALITY AS t(movie_id, ord)`,
      [userId, ids.slice(LIKED + DISLIKED)],
    );
    await db.query(`DELETE FROM user_rec_state WHERE user_id = $1`, [userId]);
    return { imported: SAMPLE_COUNT, liked: LIKED, disliked: DISLIKED, watched: WATCHED };
  });
}
