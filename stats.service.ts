import { pool } from "../config/db";

/**
 * [11] Watched count, favourite genre and earned badges, all computed from live data.
 * "Engaged" movies = liked + watched. The favourite genre is the one that appears most among them;
 * before any history exists it falls back to one of the user's signup genres.
 */
export async function getUserStats(userId: string) {
  const { rows } = await pool.query(
    `WITH engaged AS (
       SELECT movie_id FROM swipe_history WHERE user_id = $1 AND action = 'liked'
       UNION ALL
       SELECT movie_id FROM watched_movies WHERE user_id = $1
     ),
     genre_counts AS (
       SELECT g.name, count(*)::int AS n
       FROM engaged e JOIN movie_genres mg ON mg.movie_id = e.movie_id JOIN genres g ON g.id = mg.genre_id
       GROUP BY g.name
     )
     SELECT
       (SELECT count(*) FROM watched_movies WHERE user_id = $1)::int AS watched_count,
       (SELECT count(*) FROM swipe_history WHERE user_id = $1 AND action = 'liked')::int AS liked_count,
       (SELECT count(*) FROM swipe_history WHERE user_id = $1 AND action = 'disliked')::int AS disliked_count,
       (SELECT count(*) FROM genre_counts)::int AS genre_variety,
       COALESCE(
         (SELECT name FROM genre_counts ORDER BY n DESC, name LIMIT 1),
         (SELECT g.name FROM user_favorite_genres f JOIN genres g ON g.id = f.genre_id
           WHERE f.user_id = $1 ORDER BY g.name LIMIT 1)) AS favorite_genre`,
    [userId],
  );
  const s = rows[0];

  const badges = await pool.query(
    `SELECT code, name, description FROM badges
     WHERE threshold <= CASE metric WHEN 'watched_count' THEN $1::int
                                    WHEN 'liked_count'   THEN $2::int
                                    WHEN 'genre_variety' THEN $3::int END
     ORDER BY threshold, code`,
    [s.watched_count, s.liked_count, s.genre_variety],
  );

  return {
    moviesWatched: s.watched_count, moviesLiked: s.liked_count, moviesDisliked: s.disliked_count,
    favoriteGenre: s.favorite_genre as string | null, badges: badges.rows,
  };
}
