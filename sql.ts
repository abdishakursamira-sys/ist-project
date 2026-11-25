/**
 * [3] "Never show a movie again" predicate: true when the user has NOT swiped on or watched it.
 * Both arguments are SQL expressions (e.g. "$1", "m.id"), never user input.
 */
export const notSeen = (userId: string, movieId: string) => `(
  NOT EXISTS (SELECT 1 FROM swipe_history _sh WHERE _sh.user_id = ${userId} AND _sh.movie_id = ${movieId})
  AND NOT EXISTS (SELECT 1 FROM watched_movies _w WHERE _w.user_id = ${userId} AND _w.movie_id = ${movieId}))`;

/** Subquery returning a movie's genre names as text[]. */
export const genresOf = (movieId: string) =>
  `ARRAY(SELECT _g.name FROM movie_genres _mg JOIN genres _g ON _g.id = _mg.genre_id
         WHERE _mg.movie_id = ${movieId} ORDER BY _g.name)`;
