// Agentic Script DNA pipeline using LangGraph.js
// Nodes: planner -> retriever (vector RAG) -> beat_annotator (lazy) -> beat_critic -> risk_scorer -> prescriber -> note_writer
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { StateGraph, END, START, Annotation } from "npm:@langchain/langgraph@0.2.74";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------- LLM helper (tool-calling) ----------
async function callLLM(opts: {
  system: string;
  user: string;
  tool: { name: string; description: string; parameters: any };
  model?: string;
}): Promise<any> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      tools: [{ type: "function", function: opts.tool }],
      tool_choice: { type: "function", function: { name: opts.tool.name } },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err: any = new Error(`AI gateway ${res.status}: ${t}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const tc = json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) throw new Error("Model returned no tool call");
  return JSON.parse(tc.function.arguments);
}

// ---------- Embedding helper ----------
// Lovable AI Gateway has no embeddings endpoint, so we use a deterministic
// hashed bag-of-words pseudo-embedding (768-dim, L2-normalized). Lexical, not
// semantic — but consistent between ingest and query so cosine retrieval works.
const EMBED_DIM = 768;
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function embed(text: string): number[] {
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

// ---------- Graph state ----------
const State = Annotation.Root({
  title: Annotation<string>(),
  genre: Annotation<string>(),
  logline: Annotation<string>(),
  outline: Annotation<string>(),
  plan: Annotation<{ search_genres: string[]; structural_keywords: string[]; reasoning: string }>(),
  candidates: Annotation<any[]>(),
  newly_annotated: Annotation<number>(),
  cached_annotations: Annotation<number>(),
  matches: Annotation<any[]>(),
  beat_heatmap: Annotation<any[]>(),
  midpoint_risk_score: Annotation<number>(),
  midpoint_diagnosis: Annotation<string>(),
  act3_prescription: Annotation<string[]>(),
  development_note: Annotation<string>(),
  headline: Annotation<string>(),
  trace: Annotation<{ node: string; ms: number; summary: string }[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
});
type S = typeof State.State;

const trace = (node: string, started: number, summary: string) => ({
  trace: [{ node, ms: Date.now() - started, summary }],
});

// ---------- NODE 1: Planner ----------
async function planner(state: S) {
  const t0 = Date.now();
  const plan = await callLLM({
    system:
      "You are the planning node of an agentic story-analysis pipeline. Given a writer's project, decide which genres to search and which structural keywords matter most for retrieval. Be precise and concise.",
    user: `TITLE: ${state.title || "(untitled)"}\nGENRE: ${state.genre}\nLOGLINE: ${state.logline}\nOUTLINE:\n${state.outline || "(none)"}`,
    tool: {
      name: "make_plan",
      description: "Decide retrieval strategy for the RAG step.",
      parameters: {
        type: "object",
        properties: {
          search_genres: {
            type: "array",
            items: { type: "string" },
            description: "Capitalized genre tokens, e.g. ['Thriller','Crime']. Match TMDB genre names.",
            minItems: 1,
            maxItems: 6,
          },
          structural_keywords: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 8,
          },
          reasoning: { type: "string" },
        },
        required: ["search_genres", "structural_keywords", "reasoning"],
        additionalProperties: false,
      },
    },
  });
  return {
    plan,
    ...trace("planner", t0, `Genres: ${plan.search_genres.join(", ")} · ${plan.reasoning}`),
  };
}

// ---------- NODE 2: Retriever (vector RAG with optional genre filter) ----------
async function retriever(state: S) {
  const t0 = Date.now();
  const query = `${state.genre}. ${state.logline}\n${state.outline ?? ""}`.trim();
  const queryEmbedding = embed(query);

  // First try with genre filter; fall back to no filter if too few results
  let { data: matched } = await supabase.rpc("match_films", {
    query_embedding: queryEmbedding as any,
    match_count: 40,
    filter_genres: state.plan.search_genres,
  });

  if (!matched || matched.length < 15) {
    const { data: broader } = await supabase.rpc("match_films", {
      query_embedding: queryEmbedding as any,
      match_count: 40,
      filter_genres: null,
    });
    matched = broader ?? matched ?? [];
  }

  const candidates = matched ?? [];
  return {
    candidates,
    ...trace(
      "retriever",
      t0,
      `Vector RAG: ${candidates.length} films · top sim ${candidates[0]?.similarity?.toFixed(3) ?? "—"}`,
    ),
  };
}

// ---------- NODE 3: Beat Annotator (lazy, cached) ----------
async function beatAnnotator(state: S) {
  const t0 = Date.now();
  const needAnnotation = state.candidates.filter((c) => !c.beats || Object.keys(c.beats || {}).length === 0);
  let newly = 0;
  let cached = state.candidates.length - needAnnotation.length;

  // Annotate up to 15 to keep latency bounded; the rest will be annotated on later queries
  const toDo = needAnnotation.slice(0, 15);

  for (const film of toDo) {
    try {
      const out = await callLLM({
        model: "google/gemini-2.5-flash",
        system: `You are a story structure analyst. Given a film's plot overview, infer its 7-beat structure (setup, inciting incident, plot point 1, midpoint, all-is-lost, climax, resolution) plus midpoint outcome and act-3 outcome. Return concise one-line descriptions per beat. If the overview is too short to infer a beat, write "(unclear)".`,
        user: `TITLE: ${film.title} (${film.year ?? "n/a"})
GENRES: ${(film.genres ?? []).join(", ")}
OVERVIEW: ${film.overview}`,
        tool: {
          name: "annotate_beats",
          description: "Extract beat-by-beat structure of a film.",
          parameters: {
            type: "object",
            properties: {
              beats: {
                type: "object",
                properties: {
                  setup: { type: "string" },
                  inciting: { type: "string" },
                  pp1: { type: "string" },
                  midpoint: { type: "string" },
                  low: { type: "string" },
                  climax: { type: "string" },
                  resolution: { type: "string" },
                },
                required: ["setup", "inciting", "pp1", "midpoint", "low", "climax", "resolution"],
                additionalProperties: false,
              },
              strengths: { type: "array", items: { type: "string" }, maxItems: 4 },
              weaknesses: { type: "array", items: { type: "string" }, maxItems: 4 },
              midpoint_outcome: { type: "string" },
              act3_outcome: { type: "string" },
            },
            required: ["beats", "strengths", "weaknesses", "midpoint_outcome", "act3_outcome"],
            additionalProperties: false,
          },
        },
      });

      // Cache to DB
      await supabase
        .from("films_corpus")
        .update({
          beats: out.beats,
          strengths: out.strengths,
          weaknesses: out.weaknesses,
          midpoint_outcome: out.midpoint_outcome,
          act3_outcome: out.act3_outcome,
          beats_annotated_at: new Date().toISOString(),
        })
        .eq("id", film.id);

      // Mutate in-memory copy so downstream nodes see it
      film.beats = out.beats;
      film.strengths = out.strengths;
      film.weaknesses = out.weaknesses;
      film.midpoint_outcome = out.midpoint_outcome;
      film.act3_outcome = out.act3_outcome;
      newly++;
    } catch (e: any) {
      console.error(`annotate failed for ${film.title}:`, e.message);
    }
  }

  return {
    newly_annotated: newly,
    cached_annotations: cached,
    ...trace(
      "beat_annotator",
      t0,
      `Annotated ${newly} new films · ${cached} pre-cached · ${needAnnotation.length - toDo.length} deferred`,
    ),
  };
}

// ---------- NODE 4: Beat Critic ----------
async function beatCritic(state: S) {
  const t0 = Date.now();
  // Only feed candidates that have beat data
  const annotated = state.candidates.filter((f) => f.beats && Object.keys(f.beats).length);
  const corpus = annotated.slice(0, 30).map((f) => ({
    title: f.title,
    year: f.year,
    genres: f.genres,
    overview: f.overview,
    beats: f.beats,
    strengths: f.strengths,
    weaknesses: f.weaknesses,
    midpoint_outcome: f.midpoint_outcome,
    act3_outcome: f.act3_outcome,
    similarity: f.similarity,
  }));

  const out = await callLLM({
    model: "google/gemini-2.5-pro",
    system: `You are the structural critic node. Match the writer's project to films in the FILM_CORPUS by BEAT ARCHITECTURE — not theme or genre alone. Select the 10 closest structural ancestors and rate the writer's outline beat-by-beat.

Beats: setup, inciting, pp1, midpoint, low, climax, resolution.
For each beat give a confidence 0-100 and a one-line risk_note. Cite only films present in the corpus.`,
    user: `PROJECT
Genre: ${state.genre}
Logline: ${state.logline}
Outline:
${state.outline || "(infer from logline)"}

PLANNER KEYWORDS: ${state.plan.structural_keywords.join(", ")}

FILM_CORPUS (vector-retrieved + beat-annotated):
${JSON.stringify(corpus)}`,
    tool: {
      name: "deliver_critique",
      description: "Return matches and beat heatmap.",
      parameters: {
        type: "object",
        properties: {
          matches: {
            type: "array",
            minItems: 5,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "EXACT title as it appears in FILM_CORPUS." },
                year: { type: "number", description: "Release year from FILM_CORPUS — required to disambiguate remakes." },
                similarity: { type: "number", minimum: 0, maximum: 100 },
                why: { type: "string" },
                did_right: { type: "string" },
                risk: { type: "string" },
              },
              required: ["title", "year", "similarity", "why", "did_right", "risk"],
              additionalProperties: false,
            },
          },
          beat_heatmap: {
            type: "array",
            minItems: 7,
            maxItems: 7,
            items: {
              type: "object",
              properties: {
                beat: {
                  type: "string",
                  enum: ["setup", "inciting", "pp1", "midpoint", "low", "climax", "resolution"],
                },
                confidence: { type: "number", minimum: 0, maximum: 100 },
                risk_note: { type: "string" },
              },
              required: ["beat", "confidence", "risk_note"],
              additionalProperties: false,
            },
          },
        },
        required: ["matches", "beat_heatmap"],
        additionalProperties: false,
      },
    },
  });

  // Enrich each match with poster_path + tmdb_id from the candidate corpus.
  // The model returns titles (and usually years); collisions like "The Mummy"
  // (1999) vs (2017) mean a title-only lookup attaches the wrong poster. We
  // key by title+year first, fall back to title-only, and as a last resort
  // do a normalised/fuzzy match. Misses return null instead of a wrong poster.
  const norm = (s: string) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an)\b/g, "").trim();
  const byTitleYear = new Map<string, any>();
  const byTitle = new Map<string, any[]>();
  const byNorm = new Map<string, any[]>();
  for (const c of state.candidates) {
    const t = (c.title || "").toLowerCase();
    if (c.year) byTitleYear.set(`${t}|${c.year}`, c);
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t)!.push(c);
    const n = norm(c.title || "");
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n)!.push(c);
  }
  const enriched = (out.matches as any[]).map((m) => {
    const t = (m.title || "").toLowerCase();
    let c: any = m.year ? byTitleYear.get(`${t}|${m.year}`) : undefined;
    if (!c) {
      const list = byTitle.get(t);
      if (list && list.length === 1) c = list[0];
      else if (list && m.year) {
        // pick the title-match with closest year
        c = list.reduce((best: any, cur: any) =>
          !best ? cur : Math.abs((cur.year ?? 0) - m.year) < Math.abs((best.year ?? 0) - m.year) ? cur : best,
          null);
      }
    }
    if (!c) {
      const list = byNorm.get(norm(m.title || ""));
      if (list && list.length) {
        c = m.year
          ? list.reduce((best: any, cur: any) =>
              !best ? cur : Math.abs((cur.year ?? 0) - m.year) < Math.abs((best.year ?? 0) - m.year) ? cur : best,
              null)
          : list[0];
      }
    }
    return {
      ...m,
      // If we couldn't confidently resolve the candidate, prefer the model's
      // title/year as-is and return null poster rather than mislabelling.
      title: c?.title ?? m.title,
      year: c?.year ?? m.year,
      poster_path: c?.poster_path ?? null,
      tmdb_id: c?.tmdb_id ?? null,
    };
  });

  return {
    matches: enriched,
    beat_heatmap: out.beat_heatmap,
    ...trace(
      "beat_critic",
      t0,
      `Selected ${enriched.length} ancestors · top: ${enriched[0]?.title} (${enriched[0]?.similarity})`,
    ),
  };
}

// ---------- NODE 5: Risk Scorer ----------
async function riskScorer(state: S) {
  const t0 = Date.now();
  const out = await callLLM({
    system: `You are the midpoint-risk node. Predict probability (0-100) the writer's draft will collapse at the midpoint. High = likely collapse. Justify in one sentence citing patterns from matched films.`,
    user: `OUTLINE:
${state.outline || state.logline}

ANCESTORS' MIDPOINT OUTCOMES:
${state.matches.map((m) => `- ${m.title}: ${m.why}`).join("\n")}

CURRENT MIDPOINT BEAT CONFIDENCE: ${state.beat_heatmap.find((b) => b.beat === "midpoint")?.confidence}`,
    tool: {
      name: "score_midpoint_risk",
      description: "Score and diagnose midpoint risk.",
      parameters: {
        type: "object",
        properties: {
          midpoint_risk_score: { type: "number", minimum: 0, maximum: 100 },
          midpoint_diagnosis: { type: "string" },
        },
        required: ["midpoint_risk_score", "midpoint_diagnosis"],
        additionalProperties: false,
      },
    },
  });
  return {
    midpoint_risk_score: out.midpoint_risk_score,
    midpoint_diagnosis: out.midpoint_diagnosis,
    ...trace("risk_scorer", t0, `Midpoint risk: ${out.midpoint_risk_score}/100`),
  };
}

// ---------- NODE 6: Prescriber ----------
async function prescriber(state: S) {
  const t0 = Date.now();
  const out = await callLLM({
    system: `You are the prescription node. Produce exactly 3 concrete, scene-level act-3 moves. Each must be specific, not generic.`,
    user: `LOGLINE: ${state.logline}
OUTLINE: ${state.outline || "(none)"}
ANCESTORS:
${state.matches.slice(0, 5).map((m) => `- ${m.title}: ${m.risk}`).join("\n")}
MIDPOINT DIAGNOSIS: ${state.midpoint_diagnosis}`,
    tool: {
      name: "prescribe",
      description: "Three act-3 moves.",
      parameters: {
        type: "object",
        properties: {
          act3_prescription: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string" },
          },
        },
        required: ["act3_prescription"],
        additionalProperties: false,
      },
    },
  });
  return {
    act3_prescription: out.act3_prescription,
    ...trace("prescriber", t0, `Drafted 3 act-3 moves`),
  };
}

// ---------- NODE 7: Note Writer ----------
async function noteWriter(state: S) {
  const t0 = Date.now();
  const out = await callLLM({
    model: "google/gemini-2.5-pro",
    system: `You are the development-note writer. Voice: a sharp, candid producer. Open with a punchy comparison: "Your X has the same structural DNA as Y — here's what that means for act three." Then 180-260 words of specific, scene-level notes. End with one declarative sentence the writer should pin above their desk.`,
    user: `PROJECT
Logline: ${state.logline}
Genre: ${state.genre}

TOP ANCESTORS: ${state.matches.slice(0, 3).map((m) => `${m.title} (${m.similarity})`).join(", ")}
MIDPOINT RISK: ${state.midpoint_risk_score}/100 — ${state.midpoint_diagnosis}
ACT 3 MOVES:
${state.act3_prescription.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
    tool: {
      name: "write_note",
      description: "Headline + development note.",
      parameters: {
        type: "object",
        properties: {
          headline: { type: "string" },
          development_note: { type: "string" },
        },
        required: ["headline", "development_note"],
        additionalProperties: false,
      },
    },
  });
  return {
    headline: out.headline,
    development_note: out.development_note,
    ...trace("note_writer", t0, `Note written (${out.development_note.length} chars)`),
  };
}

// ---------- Build the graph ----------
const graph = new StateGraph(State)
  .addNode("planner", planner)
  .addNode("retriever", retriever)
  .addNode("beat_annotator", beatAnnotator)
  .addNode("beat_critic", beatCritic)
  .addNode("risk_scorer", riskScorer)
  .addNode("prescriber", prescriber)
  .addNode("note_writer", noteWriter)
  .addEdge(START, "planner")
  .addEdge("planner", "retriever")
  .addEdge("retriever", "beat_annotator")
  .addEdge("beat_annotator", "beat_critic")
  .addEdge("beat_critic", "risk_scorer")
  .addEdge("risk_scorer", "prescriber")
  .addEdge("prescriber", "note_writer")
  .addEdge("note_writer", END)
  .compile();

// ---------- HTTP entry ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    if (!body?.logline || !body?.genre) {
      return new Response(JSON.stringify({ error: "logline and genre are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const final = await graph.invoke({
      title: body.title ?? "",
      genre: body.genre,
      logline: body.logline,
      outline: body.outline ?? "",
    });

    const report = {
      headline: final.headline,
      matches: final.matches,
      beat_heatmap: final.beat_heatmap,
      midpoint_risk_score: final.midpoint_risk_score,
      midpoint_diagnosis: final.midpoint_diagnosis,
      act3_prescription: final.act3_prescription,
      development_note: final.development_note,
    };

    return new Response(
      JSON.stringify({
        report,
        trace: final.trace,
        plan: final.plan,
        corpus_size: final.candidates?.length ?? 0,
        newly_annotated: final.newly_annotated ?? 0,
        cached_annotations: final.cached_annotations ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("analyse-script error", e);
    const status = e?.status === 429 || e?.status === 402 ? e.status : 500;
    const message =
      status === 429
        ? "Rate limit reached. Please wait a moment and try again."
        : status === 402
        ? "AI credits exhausted. Add credits in Settings → Workspace → Usage."
        : e?.message ?? "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
