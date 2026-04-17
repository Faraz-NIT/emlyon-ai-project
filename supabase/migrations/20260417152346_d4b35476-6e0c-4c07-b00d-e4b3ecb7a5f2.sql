CREATE TABLE public.films (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  year INT,
  genres TEXT[] NOT NULL DEFAULT '{}',
  logline TEXT NOT NULL,
  summary TEXT NOT NULL,
  beats JSONB NOT NULL DEFAULT '{}'::jsonb,
  strengths TEXT[] NOT NULL DEFAULT '{}',
  weaknesses TEXT[] NOT NULL DEFAULT '{}',
  midpoint_outcome TEXT,
  act3_outcome TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.films ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Films are publicly readable"
ON public.films FOR SELECT
USING (true);

CREATE INDEX idx_films_genres ON public.films USING GIN(genres);
CREATE INDEX idx_films_title ON public.films (title);