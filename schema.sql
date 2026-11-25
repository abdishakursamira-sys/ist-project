-- Movie Match AI database schema. Requires PostgreSQL 15+ and pgvector >= 0.8.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE swipe_action AS ENUM ('liked', 'disliked');

-- ================================================================ users
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE                       -- citext = case-insensitive uniqueness
                        CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash         text   NOT NULL,                            -- bcrypt hash, never the password
  display_name          text   NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  status                text   NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,                                 -- brute-force lockout
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ===================================== [1] movies and genres are separate
CREATE TABLE genres (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE,
  slug  text NOT NULL UNIQUE
);

CREATE TABLE movies (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tmdb_id       integer UNIQUE,
  title         text NOT NULL CHECK (char_length(title) > 0),
  release_year  smallint CHECK (release_year BETWEEN 1888 AND 2100),
  poster_url    text,
  overview      text,
  popularity    real NOT NULL DEFAULT 0 CHECK (popularity >= 0),
  embedding     vector(1536),                                        -- match your embedding model
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (title, release_year)                                       -- [12] no duplicate movies
);

-- Many-to-many: a movie has several genres, a genre has many movies.
CREATE TABLE movie_genres (
  movie_id  bigint   NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  genre_id  smallint NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, genre_id)
);
CREATE INDEX idx_movie_genres_genre ON movie_genres (genre_id, movie_id);   -- "movies in genre X"

CREATE INDEX idx_movies_embedding_hnsw ON movies USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_movies_popularity ON movies (popularity DESC);

-- ============================ [7] the 3 favourite genres picked at signup
CREATE TABLE user_favorite_genres (
  user_id   uuid     NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  genre_id  smallint NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, genre_id)
);

-- [12] The database itself refuses a 4th favourite genre, even if the API has a bug.
CREATE FUNCTION limit_favorite_genres() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM user_favorite_genres WHERE user_id = NEW.user_id) >= 3 THEN
    RAISE EXCEPTION 'A user can have at most 3 favorite genres' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_limit_favorite_genres BEFORE INSERT ON user_favorite_genres
  FOR EACH ROW EXECUTE FUNCTION limit_favorite_genres();

-- ====================================== [2][3][12] swipe history
-- One row per (user, movie): UNIQUE makes duplicate swipes impossible and doubles as the
-- "already seen" lookup. match_percent is the score shown to the user at swipe time.
CREATE TABLE swipe_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid   NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  movie_id       bigint NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  action         swipe_action NOT NULL,
  match_percent  smallint CHECK (match_percent BETWEEN 0 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, movie_id)
);
CREATE INDEX idx_swipes_user_recent ON swipe_history (user_id, created_at DESC);
CREATE INDEX idx_swipes_user_liked  ON swipe_history (user_id, created_at DESC) WHERE action = 'liked';

-- [3] Watched movies are tracked separately so a movie can be watched without a swipe.
CREATE TABLE watched_movies (
  user_id     uuid   NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  movie_id    bigint NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  watched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
CREATE INDEX idx_watched_user_recent ON watched_movies (user_id, watched_at DESC);

-- ============================================== [8] Watch Later list
CREATE TABLE watchlist (
  user_id   uuid   NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  movie_id  bigint NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  source    text   NOT NULL DEFAULT 'manual' CHECK (source IN ('auto_like', 'manual')),
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
CREATE INDEX idx_watchlist_user_recent ON watchlist (user_id, added_at DESC);

-- A like automatically adds the movie to Watch Later (enforced in the DB, not just the API).
CREATE FUNCTION sync_watchlist_on_swipe() RETURNS trigger AS $$
BEGIN
  IF NEW.action = 'liked' THEN
    INSERT INTO watchlist (user_id, movie_id, source)
    VALUES (NEW.user_id, NEW.movie_id, 'auto_like') ON CONFLICT DO NOTHING;
  ELSIF TG_OP = 'UPDATE' THEN
    DELETE FROM watchlist WHERE user_id = NEW.user_id AND movie_id = NEW.movie_id AND source = 'auto_like';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_swipe_watchlist AFTER INSERT OR UPDATE OF action ON swipe_history
  FOR EACH ROW EXECUTE FUNCTION sync_watchlist_on_swipe();

-- Once a movie is watched it leaves Watch Later.
CREATE FUNCTION clear_watchlist_on_watched() RETURNS trigger AS $$
BEGIN
  DELETE FROM watchlist WHERE user_id = NEW.user_id AND movie_id = NEW.movie_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_watched_watchlist AFTER INSERT ON watched_movies
  FOR EACH ROW EXECUTE FUNCTION clear_watchlist_on_watched();

-- ====================================== [4] stored recommendations
-- A pool of recommendations per user, so opening the app is a cheap read.
CREATE TABLE recommendations (
  user_id        uuid   NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  movie_id       bigint NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  match_percent  smallint NOT NULL CHECK (match_percent BETWEEN 0 AND 100),
  reason         text NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
CREATE INDEX idx_recs_user_best ON recommendations (user_id, match_percent DESC);

-- When the pool was last generated; drives the "is it stale?" decision.
CREATE TABLE user_rec_state (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  generated_at  timestamptz NOT NULL
);

-- ============================================================ [11] badges
-- Badge definitions only. Which badges a user has EARNED is computed from live data
-- (see stats.service.ts), so it can never drift out of sync with their history.
CREATE TABLE badges (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL,
  metric       text NOT NULL CHECK (metric IN ('watched_count', 'liked_count', 'genre_variety')),
  threshold    integer NOT NULL CHECK (threshold > 0)
);
