# Story DNA Decoder

Story DNA Decoder is a Vite + React app backed by Supabase that analyzes a screenplay idea against a corpus of films. It retrieves structurally similar films, annotates missing beat data on demand, scores midpoint risk, and returns a producer-style development note with act-three prescriptions.

## What It Does

- Accepts a title, genre, logline, and rough outline.
- Retrieves similar films from a Supabase corpus using deterministic pseudo-embeddings and a `match_films` RPC.
- Lazily annotates missing 7-beat structures for retrieved films and caches the results in `films_corpus`.
- Selects the closest structural ancestors, builds a beat heatmap, scores midpoint risk, and writes a development note.
- Includes an admin screen to ingest and backfill a TMDB-derived corpus.

## Stack

- Frontend: React 18, TypeScript, Vite, React Router, TanStack Query, Tailwind, shadcn/ui
- Backend: Supabase Edge Functions, Postgres, pgvector, RPCs, background ingestion jobs
- Orchestration: LangGraph.js
- Model provider for analysis: Groq chat completions API
- Data source for ingestion: TMDB-derived CSV plus optional TMDB API lookups for posters and verified IDs

## App Routes

- `/` - public Story DNA analysis UI
- `/admin` - corpus ingestion and corpus health dashboard

## Repository Layout

```text
src/
	pages/
		Index.tsx            # main analysis experience
		Admin.tsx            # corpus ingestion/admin UI
	components/            # visualizers and shared UI
	integrations/supabase/ # generated client and database types

supabase/
	functions/
		analyse-script/      # LangGraph story-analysis pipeline
		ingest-tmdb/         # resumable corpus ingestion worker
	migrations/           # database schema and SQL changes
```

## How The Analysis Pipeline Works

The edge function in `supabase/functions/analyse-script` runs a LangGraph pipeline with these nodes:

1. `planner` - derives retrieval genres and structural keywords from the submitted project.
2. `retriever` - queries the film corpus through `match_films`, first with genre filtering and then without if recall is too low.
3. `beat_annotator` - lazily annotates missing beats for retrieved films and writes them back to `films_corpus`.
4. `beat_critic` - selects the strongest structural ancestors and creates a beat-level risk heatmap.
5. `risk_scorer` - predicts midpoint collapse risk.
6. `prescriber` - outputs three scene-level act-three moves.
7. `note_writer` - writes the final producer-style development note.

The frontend calls the function through `supabase.functions.invoke("analyse-script")` and renders the report, trace, and planner output.

## Corpus Ingestion Flow

The admin page triggers `supabase/functions/ingest-tmdb`, which:

1. Streams a public CSV containing roughly 5,000 films.
2. Normalizes titles, genres, dates, and overviews.
3. Generates deterministic hashed pseudo-embeddings so retrieval stays consistent with the analysis function.
4. Optionally enriches each film with verified `tmdb_id` and `poster_path` using `TMDB_API_KEY`.
5. Inserts rows into `films_corpus` and updates an `ingest_jobs` table for progress tracking.

The ingestion flow is resumable, so re-running it skips films already present in the corpus.

## Prerequisites

- Node.js 18+
- A Supabase project
- Supabase CLI if you want to run functions or migrations locally
- A Groq API key for the analysis pipeline
- A TMDB API key if you want poster backfill and verified TMDB lookups during ingestion

## Environment Variables

### Frontend

Create a local env file such as `.env.local` with:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_or_publishable_key
```

### Supabase Edge Functions

Set these secrets in Supabase for deployed functions, or in your local Supabase environment when developing locally:

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GROQ_API_KEY=your_groq_api_key
TMDB_API_KEY=your_tmdb_api_key
```

Notes:

- `GROQ_API_KEY` is required by `analyse-script`.
- `TMDB_API_KEY` is optional but recommended for `ingest-tmdb` enrichment.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required by both edge functions.

## Install And Run

Install dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Lint the app:

```bash
npm run lint
```

Build for production:

```bash
npm run build
```

## Supabase Local Development

Typical local workflow:

```bash
supabase start
supabase db reset
supabase functions serve analyse-script --no-verify-jwt
supabase functions serve ingest-tmdb
```

If you need to set secrets locally:

```bash
supabase secrets set GROQ_API_KEY=your_key
supabase secrets set TMDB_API_KEY=your_key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key
supabase secrets set SUPABASE_URL=your_url
```

Adjust the exact commands to match your local Supabase workflow. This repo already includes SQL migrations under `supabase/migrations` and function configuration in `supabase/config.toml`.

## Key Data Expectations

The project expects a Supabase schema with at least these working pieces:

- `films_corpus` table for titles, genres, overview text, embeddings, beat annotations, and TMDB metadata
- `ingest_jobs` table for background job tracking
- `match_films` RPC for vector similarity search with optional genre filtering

If you are connecting this frontend to a fresh Supabase project, run the included migrations before testing the app.

## Development Notes

- Beat annotations are cached after first use to avoid repeated LLM calls.
- Embeddings are lexical hashed vectors rather than model embeddings, so ingest and retrieval must stay in sync.
- The `analyse-script` function is configured with `verify_jwt = false` in `supabase/config.toml`, which allows unauthenticated invocation from the current UI setup.

## Scripts

- `npm run dev` - start Vite dev server
- `npm run build` - production build
- `npm run build:dev` - development-mode build
- `npm run preview` - preview the production build locally
- `npm run lint` - ESLint
- `npm test` - one-shot Vitest run
- `npm run test:watch` - Vitest watch mode

## Next Areas To Document

If the project keeps evolving, the next useful README additions would be:

- a schema section with the exact table and RPC signatures
- screenshots of the report and admin flow
- deployment steps for Supabase functions and the Vite frontend
