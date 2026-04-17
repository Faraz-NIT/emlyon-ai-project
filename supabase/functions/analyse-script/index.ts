import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface ReqBody {
  title?: string;
  logline: string;
  genre: string;
  outline: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    if (!body?.logline || !body?.genre) {
      return new Response(JSON.stringify({ error: "logline and genre are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Genre-aware retrieval (RAG candidate set)
    const genreTokens = body.genre
      .split(/[,/&\s]+/)
      .map((g) => g.trim())
      .filter(Boolean);

    let candidates: any[] = [];
    if (genreTokens.length) {
      const { data } = await supabase
        .from("films")
        .select("*")
        .overlaps("genres", genreTokens)
        .limit(40);
      candidates = data ?? [];
    }
    if (candidates.length < 12) {
      // Broaden with a fallback set
      const { data } = await supabase.from("films").select("*").limit(60);
      const seen = new Set(candidates.map((c) => c.id));
      for (const f of data ?? []) if (!seen.has(f.id)) candidates.push(f);
    }

    // Trim payload size for the LLM
    const corpus = candidates.slice(0, 40).map((f) => ({
      id: f.id,
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

    // 2) LLM diagnostic via tool calling (structured output)
    const systemPrompt = `You are SCRIPT DNA, a development executive who diagnoses screenplay structure by comparing a writer's project to a curated corpus of films. You think like Robert McKee, John Truby, and Blake Snyder combined.

Your job:
1. Read the writer's logline + genre + outline.
2. From the provided FILM_CORPUS only, pick the 10 closest STRUCTURAL matches (not just thematic or genre matches — match by beat architecture, character pressure, escalation pattern). Rank by structural similarity 0-100.
3. For each chosen match, identify ONE thing that film did right and ONE thing that risks repeating its known weakness.
4. Build a beat heatmap: for each of [setup, inciting, pp1, midpoint, low, climax, resolution] estimate a confidence 0-100 that the writer's outline currently nails that beat, plus a one-line risk.
5. Compute a midpoint_risk_score 0-100 (high = likely to collapse at midpoint, based on patterns in matched films).
6. Provide an act3_prescription: 3 concrete, scene-level moves the writer should make to avoid the failure mode shared by their structural ancestors.
7. Write a development_note (180-260 words) in the voice of a sharp, candid producer who has read 10,000 scripts. Open with the punchiest comparison: "Your X has the same structural DNA as Y — here's what that means for act three."

Be specific. Cite the film titles you matched. Do not invent films outside the corpus.`;

    const userPrompt = `WRITER PROJECT
Title: ${body.title || "(untitled)"}
Genre: ${body.genre}
Logline: ${body.logline}

Outline:
${body.outline || "(not provided — infer reasonable structure from the logline)"}

FILM_CORPUS (JSON):
${JSON.stringify(corpus)}`;

    const tool = {
      type: "function" as const,
      function: {
        name: "deliver_dna_report",
        description: "Deliver the full Script DNA diagnostic report.",
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
                  why: { type: "string", description: "One sentence on the structural reason it matched." },
                  did_right: { type: "string" },
                  risk: { type: "string" },
                },
                required: ["title", "similarity", "why", "did_right", "risk"],
                additionalProperties: false,
              },
            },
            beat_heatmap: {
              type: "array",
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
            midpoint_risk_score: { type: "number", minimum: 0, maximum: 100 },
            midpoint_diagnosis: { type: "string" },
            act3_prescription: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: { type: "string" },
            },
            development_note: { type: "string" },
            headline: { type: "string", description: "One-sentence punchline opener." },
          },
          required: [
            "matches",
            "beat_heatmap",
            "midpoint_risk_score",
            "midpoint_diagnosis",
            "act3_prescription",
            "development_note",
            "headline",
          ],
          additionalProperties: false,
        },
      },
    };

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "deliver_dna_report" } },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached. Please wait a moment and try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await aiRes.text();
      console.error("AI gateway error", aiRes.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call returned", JSON.stringify(aiJson));
      return new Response(JSON.stringify({ error: "Model did not return a structured report." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let report: any;
    try {
      report = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool args", e, toolCall.function.arguments);
      return new Response(JSON.stringify({ error: "Malformed report from model." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ report, corpus_size: corpus.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("analyse-script error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
