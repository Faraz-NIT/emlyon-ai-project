// Ingests TMDB top-5000 films into films_corpus and embeds them with Gemini.
// One-time / resumable. Triggered from the admin UI.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Fetch poster_path from TMDB for a single tmdb_id. Returns null on any failure.
async function fetchPosterPath(tmdbId: number): Promise<string | null> {
  if (!TMDB_API_KEY) return null;
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`,
    );
    if (!r.ok) return null;
    const j = await r.json();
    return (j?.poster_path as string) ?? null;
  } catch {
    return null;
  }
}

// Public mirror of a TMDB-derived movies dataset (YBI Foundation, ~5k films)
const TMDB_CSV_URL =
  "https://raw.githubusercontent.com/YBI-Foundation/Dataset/main/Movies%20Recommendation.csv";

// ---------- Streaming CSV parser ----------
// Handles a quoted-field RFC-4180-ish CSV without loading the whole file as a
// JS string at once. Yields one record at a time so we can keep memory low on
// the 23MB TMDB dataset (the previous all-in-memory char loop was OOM-killed
// by the edge runtime before producing any rows).
async function* streamCsvRecords(
  res: Response,
): AsyncGenerator<Record<string, string>> {
  if (!res.body) throw new Error("CSV response has no body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();

  let header: string[] | null = null;
  let cur: string[] = [];
  let field = "";
  let inQ = false;

  const flushField = () => { cur.push(field); field = ""; };
  const finishRow = (): Record<string, string> | null => {
    if (cur.length === 0 && field === "") return null;
    flushField();
    const row = cur;
    cur = [];
    if (!header) { header = row; return null; }
    if (row.length !== header.length) return null;
    const o: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = row[i];
    return o;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = value;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") flushField();
        else if (c === "\n") {
          const rec = finishRow();
          if (rec) yield rec;
        } else if (c === "\r") { /* skip */ }
        else field += c;
      }
    }
  }
  const rec = finishRow();
  if (rec) yield rec;
}

function safeJsonArray(s: string): any[] {
  try { return JSON.parse(s || "[]"); } catch { return []; }
}

// Parses release date in either "DD-MM-YYYY" or "YYYY-MM-DD" form
function parseYear(s: string): number | null {
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = s.match(/-(\d{4})$/);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

// ---------- Deterministic hashed pseudo-embedding (768-dim, L2-normalized) ----------
// Lovable AI Gateway has no embeddings endpoint, so we use a lexical hash
// embedding. Must stay in sync with analyse-script/index.ts so vectors align.
const EMBED_DIM = 768;
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function embedOne(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
  for (const tok of tokens) {
    const h1 = hashStr(tok);
    const h2 = hashStr("salt:" + tok);
    v[h1 % EMBED_DIM] += 1;
    v[h2 % EMBED_DIM] += 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm;
  return v;
}
async function embedBatch(texts: string[]): Promise<number[][]> {
  return texts.map(embedOne);
}

// ---------- Background worker ----------
async function runIngest(jobId: string, limit: number) {
  const update = (patch: Record<string, unknown>) =>
    supabase.from("ingest_jobs").update(patch).eq("id", jobId);

  try {
    await update({ status: "running", message: "Fetching CSV…" });

    // 1. Existing tmdb_ids (resumable)
    const { data: existing } = await supabase
      .from("films_corpus")
      .select("tmdb_id")
      .not("tmdb_id", "is", null);
    const haveIds = new Set((existing ?? []).map((r: any) => r.tmdb_id));

    // 2. Stream CSV and normalise rows on the fly (file is ~23MB)
    const csvRes = await fetch(TMDB_CSV_URL);
    if (!csvRes.ok) throw new Error(`TMDB CSV fetch failed: ${csvRes.status}`);

    const films: {
      tmdb_id: number; title: string; year: number | null;
      genres: string[]; overview: string; popularity: number;
    }[] = [];

    for await (const r of streamCsvRecords(csvRes)) {
      const tmdb_id = parseInt(r.Movie_ID ?? r.id, 10);
      const overview = (r.Movie_Overview ?? r.overview ?? "").trim();
      const title = (r.Movie_Title ?? r.title ?? r.original_title ?? "").trim();
      if (!tmdb_id || !overview || !title) continue;
      if (haveIds.has(tmdb_id)) continue;
      const rawGenres = r.Movie_Genre ?? r.genres ?? "";
      let genres: string[] = [];
      if (rawGenres.trim().startsWith("[")) {
        genres = safeJsonArray(rawGenres).map((g: any) => g.name).filter(Boolean);
      } else {
        genres = rawGenres
          .split(/\s+/)
          .flatMap((tok: string) => tok.split(/(?=[A-Z])/))
          .map((g: string) => g.trim())
          .filter(Boolean);
      }
      const year = parseYear(r.Movie_Release_Date ?? r.release_date ?? "");
      const popularity = parseFloat(r.Movie_Popularity ?? r.popularity ?? "0") || 0;
      films.push({ tmdb_id, title, year, genres, overview, popularity });
    }

    films.sort((a, b) => b.popularity - a.popularity);
    if (films.length > limit) films.length = limit;

    if (films.length === 0) {
      await update({
        status: "done",
        message: "Corpus already up-to-date.",
        total: 0,
        finished_at: new Date().toISOString(),
      });
      return;
    }

    await update({ total: films.length, message: "Embedding & inserting…" });

    // 4. Batch embed + insert
    const batchSize = 50;
    let inserted = 0;
    let processed = 0;

    for (let i = 0; i < films.length; i += batchSize) {
      const chunk = films.slice(i, i + batchSize);
      const inputs = chunk.map(
        (f) => `${f.title} (${f.year ?? "n/a"}) — Genres: ${f.genres.join(", ")}. ${f.overview}`,
      );
      try {
        const embeddings = await embedBatch(inputs);
        // Fetch posters in parallel for this batch
        const posters = await Promise.all(chunk.map((f) => fetchPosterPath(f.tmdb_id)));
        const rowsToInsert = chunk.map((f, idx) => ({
          tmdb_id: f.tmdb_id,
          title: f.title,
          year: f.year,
          genres: f.genres,
          overview: f.overview,
          popularity: f.popularity,
          is_gold: false,
          poster_path: posters[idx],
          embedding: embeddings[idx] as any,
        }));
        const { error } = await supabase
          .from("films_corpus")
          .upsert(rowsToInsert, { onConflict: "tmdb_id" });
        if (!error) inserted += rowsToInsert.length;
        else console.error("Insert error:", error.message);
      } catch (e: any) {
        console.error(`Embedding batch ${i} failed:`, e.message);
      }
      processed += chunk.length;
      await update({ processed, inserted });
    }

    await update({
      status: "done",
      message: `Inserted ${inserted} of ${films.length}.`,
      finished_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("runIngest fatal:", e);
    await supabase
      .from("ingest_jobs")
      .update({
        status: "failed",
        error: e?.message ?? String(e),
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}

// ---------- HTTP entry: queue a background job and return immediately ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(body?.limit ?? 5000, 5000);

    const { data: job, error: jobErr } = await supabase
      .from("ingest_jobs")
      .insert({ status: "queued", limit_requested: limit })
      .select()
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message ?? "Failed to create job");

    // Run in background — function returns immediately, worker keeps going
    // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
    EdgeRuntime.waitUntil(runIngest(job.id, limit));

    return new Response(
      JSON.stringify({ ok: true, job_id: job.id, status: "queued", limit }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("ingest-tmdb error", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
