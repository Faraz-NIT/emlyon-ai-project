// Agentic Script DNA pipeline using LangGraph.js
// Nodes: planner -> retriever -> beat_critic -> risk_scorer -> prescriber -> note_writer
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

// ---------- LLM helper (Lovable AI Gateway) ----------
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

// ---------- Graph state ----------
const State = Annotation.Root({
  // inputs
  title: Annotation<string>(),
  genre: Annotation<string>(),
  logline: Annotation<string>(),
  outline: Annotation<string>(),
  // working memory
  plan: Annotation<{ search_genres: string[]; structural_keywords: string[]; reasoning: string }>(),
  candidates: Annotation<any[]>(),
  matches: Annotation<any[]>(),
  beat_heatmap: Annotation<any[]>(),
  midpoint_risk_score: Annotation<number>(),
  midpoint_diagnosis: Annotation<string>(),
  act3_prescription: Annotation<string[]>(),
  development_note: Annotation<string>(),
  headline: Annotation<string>(),
  // observability
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
            description: "Capitalized genre tokens to use for filtering, e.g. ['Heist','Thriller','Crime']. Include adjacent genres.",
            minItems: 1,
            maxItems: 6,
          },
          structural_keywords: {
            type: "array",
            items: { type: "string" },
            description: "Beat-level signatures to look for: e.g. 'midpoint reversal', 'ensemble assembly', 'mentor death'.",
            minItems: 2,
            maxItems: 8,
          },
          reasoning: { type: "string", description: "One-sentence rationale." },
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

// ---------- NODE 2: Retriever (RAG) ----------
async function retriever(state: S) {
  const t0 = Date.now();
  const tokens = state.plan.search_genres;
  const { data: byGenre } = await supabase
    .from("films")
    .select("*")
    .overlaps("genres", tokens)
    .limit(40);
  let candidates = byGenre ?? [];
  if (candidates.length < 15) {
    const { data: extra } = await supabase.from("films").select("*").limit(60);
    const seen = new Set(candidates.map((c) => c.id));
    for (const f of extra ?? []) if (!seen.has(f.id)) candidates.push(f);
  }
  candidates = candidates.slice(0, 40);
  return {
    candidates,
    ...trace("retriever", t0, `Pulled ${candidates.length} candidate films from corpus`),
  };
}

// ---------- NODE 3: Beat Critic (selects 10 structural matches + per-beat critique) ----------
async function beatCritic(state: S) {
  const t0 = Date.now();
  const corpus = state.candidates.map((f) => ({
    title: f.title,
    year: f.year,
    genres: f.genres,
    logline: f.logline,
    beats: f.beats,
    strengths: f.strengths,
    weaknesses: f.weaknesses,
    midpoint_outcome: f.midpoint_outcome,
    act3_outcome: f.act3_outcome,
  }));

  const out = await callLLM({
    model: "google/gemini-2.5-pro",
    system: `You are the structural critic node. Match the writer's project to films in the FILM_CORPUS by BEAT ARCHITECTURE — not theme or genre alone. Select the 10 closest structural ancestors and rate the writer's outline beat-by-beat.

Beats: setup, inciting, pp1, midpoint, low, climax, resolution.
For each beat give a confidence 0-100 (how strong/clear that beat appears in the writer's outline) and a one-line risk_note. Cite only films present in the corpus.`,
    user: `PROJECT
Genre: ${state.genre}
Logline: ${state.logline}
Outline:
${state.outline || "(infer from logline)"}

PLANNER KEYWORDS: ${state.plan.structural_keywords.join(", ")}

FILM_CORPUS:
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
                title: { type: "string" },
                year: { type: "number" },
                similarity: { type: "number", minimum: 0, maximum: 100 },
                why: { type: "string" },
                did_right: { type: "string" },
                risk: { type: "string" },
              },
              required: ["title", "similarity", "why", "did_right", "risk"],
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

  return {
    matches: out.matches,
    beat_heatmap: out.beat_heatmap,
    ...trace(
      "beat_critic",
      t0,
      `Selected ${out.matches.length} ancestors · top match: ${out.matches[0]?.title} (${out.matches[0]?.similarity})`,
    ),
  };
}

// ---------- NODE 4: Risk Scorer ----------
async function riskScorer(state: S) {
  const t0 = Date.now();
  const out = await callLLM({
    system: `You are the midpoint-risk node. Given the writer's outline and the known midpoint outcomes of their structural ancestors, predict the probability (0-100) that the writer's draft will collapse at the midpoint. High = likely collapse. Justify with one sentence citing patterns from the matched films.`,
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
          midpoint_diagnosis: { type: "string", description: "One sentence; cite ancestor patterns." },
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

// ---------- NODE 5: Prescriber ----------
async function prescriber(state: S) {
  const t0 = Date.now();
  const out = await callLLM({
    system: `You are the prescription node. Produce exactly 3 concrete, scene-level act-3 moves the writer should make to avoid the failure mode shared by their structural ancestors. Each move must be specific (not generic advice) and reference what would change in the script.`,
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

// ---------- NODE 6: Note Writer ----------
async function noteWriter(state: S) {
  const t0 = Date.now();
  const out = await callLLM({
    model: "google/gemini-2.5-pro",
    system: `You are the development-note writer. Voice: a sharp, candid producer who has read 10,000 scripts. Open with a punchy comparison: "Your X has the same structural DNA as Y — here's what that means for act three." Then 180-260 words of specific, scene-level notes drawing on the ancestor analysis. End with one declarative sentence the writer should pin above their desk.`,
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
          headline: { type: "string", description: "One-sentence punchline opener." },
          development_note: { type: "string", description: "180-260 words." },
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
  .addNode("beat_critic", beatCritic)
  .addNode("risk_scorer", riskScorer)
  .addNode("prescriber", prescriber)
  .addNode("note_writer", noteWriter)
  .addEdge(START, "planner")
  .addEdge("planner", "retriever")
  .addEdge("retriever", "beat_critic")
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
