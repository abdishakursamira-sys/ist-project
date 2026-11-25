import { pool } from "../config/db";

export type SwipeAction = "liked" | "disliked";

/**
 * [2][3][12] Saves a like/dislike with the match % the user was shown.
 * Returns null when the swipe is refused: the movie was already swiped or already watched.
 * The percentage comes from the stored recommendations, never from the client, so it can't be faked.
 * A like also lands in Watch Later via the database trigger.
 */
export async function recordSwipe(userId: string, movieId: number, action: SwipeAction) {
  const { rows } = await pool.query(
    `INSERT INTO swipe_history (user_id, movie_id, action, match_percent)
     SELECT $1::uuid, $2::bigint, $3::swipe_action,
            (SELECT match_percent FROM recommendations WHERE user_id = $1 AND movie_id = $2)
     WHERE NOT EXISTS (SELECT 1 FROM watched_movies WHERE user_id = $1 AND movie_id = $2)
     ON CONFLICT (user_id, movie_id) DO NOTHING
     RETURNING id, match_percent`,
    [userId, movieId, action],
  );
  return rows[0] ? { id: Number(rows[0].id), matchPercent: rows[0].match_percent as number | null } : null;
}

/** [2] A user's swipe history, newest first. */
export async function getSwipeHistory(userId: string, limit: number, offset: number) {
  const { rows } = await pool.query(
    `SELECT sh.movie_id, m.title, sh.action, sh.match_percent, sh.created_at
     FROM swipe_history sh JOIN movies m ON m.id = sh.movie_id
     WHERE sh.user_id = $1 ORDER BY sh.created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows.map((r) => ({
    movieId: Number(r.movie_id), title: r.title, action: r.action,
    matchPercent: r.match_percent, swipedAt: r.created_at,
  }));
}
