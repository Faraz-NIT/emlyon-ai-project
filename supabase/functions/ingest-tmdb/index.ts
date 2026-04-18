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

// ---------- Main ingestion ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(body?.limit ?? 5000, 5000);
    const batchSize = 50; // embedding batch
    const startedAt = Date.now();

    // 1. Find which tmdb_ids we already have (resumable)
    const { data: existing } = await supabase
      .from("films_corpus")
      .select("tmdb_id")
      .not("tmdb_id", "is", null);
    const haveIds = new Set((existing ?? []).map((r: any) => r.tmdb_id));

    // 2. Download CSV
    const csvRes = await fetch(TMDB_CSV_URL);
    if (!csvRes.ok) throw new Error(`TMDB CSV fetch failed: ${csvRes.status}`);
    const csv = await csvRes.text();
    const rows = parseCsv(csv);

    // 3. Normalise rows (YBI schema: Movie_ID, Movie_Title, Movie_Genre, Movie_Overview, Movie_Popularity, Movie_Release_Date)
    const films = rows
      .map((r) => {
        const tmdb_id = parseInt(r.Movie_ID ?? r.id, 10);
        const overview = (r.Movie_Overview ?? r.overview ?? "").trim();
        const title = (r.Movie_Title ?? r.title ?? r.original_title ?? "").trim();
        if (!tmdb_id || !overview || !title) return null;
        // Genres column is a space-separated string in this dataset, fallback to TMDB JSON if present
        const rawGenres = r.Movie_Genre ?? r.genres ?? "";
        let genres: string[] = [];
        if (rawGenres.trim().startsWith("[")) {
          genres = safeJsonArray(rawGenres).map((g: any) => g.name).filter(Boolean);
        } else {
          // Split CamelCase tokens "CrimeComedy" → ["Crime","Comedy"], or split on whitespace
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
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Corpus already up-to-date.",
          inserted: 0,
          already_present: haveIds.size,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Batch embed + insert
    let inserted = 0;
    for (let i = 0; i < films.length; i += batchSize) {
      const chunk = films.slice(i, i + batchSize);
      const inputs = chunk.map(
        (f) => `${f.title} (${f.year ?? "n/a"}) — Genres: ${f.genres.join(", ")}. ${f.overview}`,
      );
      let embeddings: number[][];
      try {
        embeddings = await embedBatch(inputs);
      } catch (e: any) {
        console.error(`Embedding batch ${i} failed:`, e.message);
        // Skip this batch but keep going
        continue;
      }

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
      if (error) {
        console.error("Insert error:", error.message);
        continue;
      }
      inserted += rowsToInsert.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        inserted,
        skipped_already_present: haveIds.size,
        total_in_csv: rows.length,
        ms: Date.now() - startedAt,
      }),
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
