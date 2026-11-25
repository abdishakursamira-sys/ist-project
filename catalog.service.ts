import { pool } from "../config/db";
import { genresOf, notSeen } from "./sql";

const toMovie = (r: any) => ({
  id: Number(r.id), title: r.title, releaseYear: r.release_year, posterUrl: r.poster_url, genres: r.genres,
});

export async function listGenres() {
  const { rows } = await pool.query(`SELECT id, name, slug FROM genres ORDER BY name`);
  return rows;
}

/** [1][3] Browse a genre, most popular first, skipping anything the user has already seen. */
export async function browseByGenre(userId: string, slug: string, limit: number, offset: number) {
  const { rows } = await pool.query(
    `SELECT m.id, m.title, m.release_year, m.poster_url, ${genresOf("m.id")} AS genres
     FROM genres g
     JOIN movie_genres mg ON mg.genre_id = g.id
     JOIN movies m        ON m.id = mg.movie_id
     WHERE g.slug = $2 AND ${notSeen("$1", "m.id")}
     ORDER BY m.popularity DESC, m.id
     LIMIT $3 OFFSET $4`,
    [userId, slug, limit, offset],
  );
  return rows.map(toMovie);
}

/** Marks a movie watched. Returns false if it was already marked (no duplicate row is written). */
export async function markWatched(userId: string, movieId: number): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO watched_movies (user_id, movie_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, movieId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** [8] The Watch Later list (likes are added automatically by a database trigger). */
export async function getWatchlist(userId: string) {
  const { rows } = await pool.query(
    `SELECT m.id, m.title, m.release_year, m.poster_url, ${genresOf("m.id")} AS genres, w.added_at, w.source
     FROM watchlist w JOIN movies m ON m.id = w.movie_id
     WHERE w.user_id = $1 ORDER BY w.added_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ ...toMovie(r), addedAt: r.added_at, source: r.source }));
}

export async function removeFromWatchlist(userId: string, movieId: number): Promise<boolean> {
  const r = await pool.query(`DELETE FROM watchlist WHERE user_id = $1 AND movie_id = $2`, [userId, movieId]);
  return (r.rowCount ?? 0) > 0;
}
