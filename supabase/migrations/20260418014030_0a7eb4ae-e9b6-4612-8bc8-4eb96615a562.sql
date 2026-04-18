-- Enable pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- New unified corpus table
CREATE TABLE public.films_corpus (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tmdb_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  year INTEGER,
  genres TEXT[] NOT NULL DEFAULT '{}',
  overview TEXT NOT NULL,
  popularity REAL DEFAULT 0,
  is_gold BOOLEAN NOT NULL DEFAULT false,
  embedding vector(768),
  beats JSONB,
  strengths TEXT[] DEFAULT '{}',
  weaknesses TEXT[] DEFAULT '{}',
  midpoint_outcome TEXT,
  act3_outcome TEXT,
  beats_annotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for fast cosine similarity on embeddings
CREATE INDEX films_corpus_embedding_idx
  ON public.films_corpus
  USING hnsw (embedding vector_cosine_ops);

-- GIN index for genre array filtering
CREATE INDEX films_corpus_genres_idx
  ON public.films_corpus
  USING GIN (genres);

-- Index for popularity-based ranking
CREATE INDEX films_corpus_popularity_idx
  ON public.films_corpus (popularity DESC);

-- Enable RLS
ALTER TABLE public.films_corpus ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Films corpus is publicly readable"
  ON public.films_corpus
  FOR SELECT
  USING (true);

-- No public write/update/delete: only service role (edge functions) can mutate

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_films_corpus_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER films_corpus_set_updated_at
  BEFORE UPDATE ON public.films_corpus
  FOR EACH ROW
  EXECUTE FUNCTION public.update_films_corpus_updated_at();

-- Migrate the 59 curated films into the new corpus as gold-standard rows
INSERT INTO public.films_corpus (
  title, year, genres, overview, popularity, is_gold,
  beats, strengths, weaknesses, midpoint_outcome, act3_outcome, beats_annotated_at
)
SELECT
  title,
  year,
  genres,
  COALESCE(summary, logline),
  100,                      -- gold films get high popularity so they surface easily
  true,
  beats,
  strengths,
  weaknesses,
  midpoint_outcome,
  act3_outcome,
  now()
FROM public.films;

-- Drop the old table
DROP TABLE public.films;

-- RPC: vector similarity search with optional genre filter
CREATE OR REPLACE FUNCTION public.match_films(
  query_embedding vector(768),
  match_count INTEGER DEFAULT 40,
  filter_genres TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  year INTEGER,
  genres TEXT[],
  overview TEXT,
  popularity REAL,
  is_gold BOOLEAN,
  beats JSONB,
  strengths TEXT[],
  weaknesses TEXT[],
  midpoint_outcome TEXT,
  act3_outcome TEXT,
  similarity REAL
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    f.id,
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
    (1 - (f.embedding <=> query_embedding))::real AS similarity
  FROM public.films_corpus f
  WHERE f.embedding IS NOT NULL
    AND (filter_genres IS NULL OR f.genres && filter_genres)
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
$$;