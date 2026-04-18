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
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Public mirror of a TMDB-derived movies dataset (YBI Foundation, ~5k films)
const TMDB_CSV_URL =
  "https://raw.githubusercontent.com/YBI-Foundation/Dataset/main/Movies%20Recommendation.csv";

// ---------- minimal CSV parser (handles quoted fields with commas) ----------
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const header = rows.shift() ?? [];
  return rows.filter(r => r.length === header.length).map(r => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = r[i]));
    return o;
  });
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

// ---------- Embed a batch with Lovable AI Gateway (Gemini text-embedding-004) ----------
async function embedBatch(texts: string[]): Promise<number[][]> {
  // Lovable AI Gateway uses OpenAI-compatible /embeddings
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/text-embedding-004",
      input: texts,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embedding API ${res.status}: ${t}`);
  }
  const json = await res.json();
  return json.data.map((d: any) => d.embedding);
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

    // 2. Download + parse CSV
    const csvRes = await fetch(TMDB_CSV_URL);
    if (!csvRes.ok) throw new Error(`TMDB CSV fetch failed: ${csvRes.status}`);
    const csv = await csvRes.text();
    const rows = parseCsv(csv);

    // 3. Normalise
    const films = rows
      .map((r) => {
        const tmdb_id = parseInt(r.Movie_ID ?? r.id, 10);
        const overview = (r.Movie_Overview ?? r.overview ?? "").trim();
        const title = (r.Movie_Title ?? r.title ?? r.original_title ?? "").trim();
        if (!tmdb_id || !overview || !title) return null;
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
        return { tmdb_id, title, year, genres, overview, popularity };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, limit)
      .filter((f) => !haveIds.has(f.tmdb_id));

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
        const rowsToInsert = chunk.map((f, idx) => ({
          tmdb_id: f.tmdb_id,
          title: f.title,
          year: f.year,
          genres: f.genres,
          overview: f.overview,
          popularity: f.popularity,
          is_gold: false,
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
