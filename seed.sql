-- Reference data + 40 sample movies for development and class demos. Safe to re-run.

INSERT INTO genres (name, slug) VALUES
 ('Action','action'),('Adventure','adventure'),('Animation','animation'),('Comedy','comedy'),
 ('Crime','crime'),('Drama','drama'),('Family','family'),('Fantasy','fantasy'),
 ('Horror','horror'),('Romance','romance'),('Sci-Fi','sci-fi'),('Thriller','thriller')
ON CONFLICT DO NOTHING;

INSERT INTO badges (code, name, description, metric, threshold) VALUES
 ('first_watch',    'First Watch',     'Mark your first movie as watched',          'watched_count', 1),
 ('movie_buff',     'Movie Buff',      'Watch 10 movies',                           'watched_count', 10),
 ('cinephile',      'Cinephile',       'Watch 50 movies',                           'watched_count', 50),
 ('taste_maker',    'Taste Maker',     'Like 10 movies',                            'liked_count',   10),
 ('genre_explorer', 'Genre Explorer',  'Engage with movies from 5 different genres','genre_variety', 5)
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE seed (title text, year int, genres text, popularity real);
INSERT INTO seed VALUES
 ('The Dark Knight',2008,'Action,Crime,Thriller',95),('Inception',2010,'Action,Sci-Fi,Thriller',94),
 ('Interstellar',2014,'Adventure,Drama,Sci-Fi',93),('The Matrix',1999,'Action,Sci-Fi',92),
 ('Toy Story',1995,'Animation,Comedy,Family',90),('Finding Nemo',2003,'Animation,Adventure,Family',88),
 ('Spirited Away',2001,'Animation,Fantasy,Family',89),('The Lion King',1994,'Animation,Drama,Family',91),
 ('Shrek',2001,'Animation,Comedy,Fantasy',87),('Frozen',2013,'Animation,Fantasy,Family',86),
 ('Get Out',2017,'Horror,Thriller',85),('A Quiet Place',2018,'Horror,Sci-Fi,Thriller',80),
 ('The Conjuring',2013,'Horror,Thriller',79),('Hereditary',2018,'Horror,Drama',75),
 ('Titanic',1997,'Drama,Romance',92),('La La Land',2016,'Comedy,Drama,Romance',84),
 ('The Notebook',2004,'Drama,Romance',82),('Pride & Prejudice',2005,'Drama,Romance',78),
 ('Crazy Rich Asians',2018,'Comedy,Romance',74),('Superbad',2007,'Comedy',77),
 ('The Hangover',2009,'Comedy',80),('Bridesmaids',2011,'Comedy,Romance',72),
 ('Pulp Fiction',1994,'Crime,Drama,Thriller',90),('The Godfather',1972,'Crime,Drama',96),
 ('Goodfellas',1990,'Crime,Drama',86),('Parasite',2019,'Drama,Thriller',91),
 ('Knives Out',2019,'Comedy,Crime,Thriller',83),('Avengers: Endgame',2019,'Action,Adventure,Sci-Fi',97),
 ('Black Panther',2018,'Action,Adventure,Sci-Fi',88),('Mad Max: Fury Road',2015,'Action,Adventure,Sci-Fi',87),
 ('John Wick',2014,'Action,Crime,Thriller',83),('The Fellowship of the Ring',2001,'Adventure,Fantasy',94),
 ('Harry Potter and the Sorcerer''s Stone',2001,'Adventure,Fantasy,Family',90),
 ('Pirates of the Caribbean: The Curse of the Black Pearl',2003,'Action,Adventure,Fantasy',86),
 ('Jurassic Park',1993,'Adventure,Sci-Fi,Thriller',91),('Back to the Future',1985,'Adventure,Comedy,Sci-Fi',89),
 ('Forrest Gump',1994,'Comedy,Drama,Romance',93),('The Shawshank Redemption',1994,'Drama',97),
 ('Coco',2017,'Animation,Adventure,Family',85),('Up',2009,'Animation,Adventure,Comedy',86);

INSERT INTO movies (title, release_year, popularity)
SELECT title, year, popularity FROM seed ON CONFLICT (title, release_year) DO NOTHING;

INSERT INTO movie_genres (movie_id, genre_id)
SELECT m.id, g.id
FROM seed s
JOIN movies m ON m.title = s.title AND m.release_year = s.year
CROSS JOIN LATERAL unnest(string_to_array(s.genres, ',')) AS gname
JOIN genres g ON g.name = gname
ON CONFLICT DO NOTHING;

-- DEMO ONLY embeddings: a deterministic vector built from each movie's genres, so movies that
-- share genres are "similar". Replace with real embeddings (e.g. of title + overview) in production.
UPDATE movies m SET embedding = (
  SELECT ('[' || string_agg(round(val::numeric, 5)::text, ',' ORDER BY d) || ']')::vector
  FROM (
    SELECT d,
      COALESCE((SELECT sum(sin((mg.genre_id * 0.7 * (d + 1))::double precision))
                FROM movie_genres mg WHERE mg.movie_id = m.id), 0)
      + 0.3 * sin((m.id * 1.3 * (d + 1))::double precision) AS val
    FROM generate_series(0, 1535) AS d
  ) x
)
WHERE m.embedding IS NULL;
