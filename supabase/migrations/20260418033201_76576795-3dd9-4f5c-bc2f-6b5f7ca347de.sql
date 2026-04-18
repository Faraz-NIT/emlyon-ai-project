
ALTER TABLE public.films_corpus ADD COLUMN IF NOT EXISTS poster_path text;

DROP FUNCTION IF EXISTS public.match_films(vector, integer, text[]);

CREATE FUNCTION public.match_films(
  query_embedding vector,
  match_count integer DEFAULT 40,
  filter_genres text[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  tmdb_id integer,
  title text,
  year integer,
  genres text[],
  overview text,
  popularity real,
  is_gold boolean,
  beats jsonb,
  strengths text[],
  weaknesses text[],
  midpoint_outcome text,
  act3_outcome text,
  poster_path text,
  similarity real
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    f.id,
    f.tmdb_id,
    f.title,
    f.year,
    f.genres,
    f.overview,
    f.popularity,
    f.is_gold,
    f.beats,
    f.strengths,
    f.weaknesses,
    f.midpoint_outcome,
    f.act3_outcome,
    f.poster_path,
    (1 - (f.embedding <=> query_embedding))::real AS similarity
  FROM public.films_corpus f
  WHERE f.embedding IS NOT NULL
    AND (filter_genres IS NULL OR f.genres && filter_genres)
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
$$;
