import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  MessageSquare,
  Scissors,
  Binary,
  Database,
  Layers,
  Sparkles,
  Loader2,
  ChevronRight,
  Play,
} from "lucide-react";

/**
 * RAG Pipeline Visualizer — a live, interactive demonstration of the
 * Retrieval-Augmented Generation architecture used by this project.
 *
 * 6 stages: Query → Chunk → Embed → Vector Search (pgvector) → Context → LLM
 *
 * It uses a deterministic 768-dim hashed bag-of-words embedding that mirrors
 * the one running inside the `analyse-script` edge function, so the retrieval
 * results match what the real pipeline would see.
 */

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
    v[hashStr(tok) % EMBED_DIM] += 1;
    v[hashStr("salt:" + tok) % EMBED_DIM] += 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm;
  return v;
}

interface Match {
  id: string;
  title: string;
  year: number | null;
  genres: string[];
  overview: string;
  poster_path: string | null;
  similarity: number;
}

const STAGES = [
  { key: "query", label: "Query", sub: "User logline", icon: MessageSquare },
  { key: "chunk", label: "Tokenize", sub: "Words → tokens", icon: Scissors },
  { key: "embed", label: "Embed", sub: "768-dim vector", icon: Binary },
  { key: "search", label: "Retrieve", sub: "pgvector cosine", icon: Database },
  { key: "context", label: "Context", sub: "Top-K assembly", icon: Layers },
  { key: "llm", label: "Generate", sub: "Gemini 2.5", icon: Sparkles },
] as const;

const SAMPLE_QUERY =
  "A retired forger is blackmailed into joining her ex-husband's crew to steal back a painting that could expose them all.";

export const RagPipelineVisualizer = () => {
  const [query, setQuery] = useState(SAMPLE_QUERY);
  const [stage, setStage] = useState(-1);
  const [running, setRunning] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [searchMs, setSearchMs] = useState(0);
  const [corpusSize, setCorpusSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("films_corpus")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => setCorpusSize(count ?? 0));
  }, []);

  const tokens = useMemo(
    () => (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2),
    [query],
  );
  const vector = useMemo(() => (query ? embed(query) : []), [query]);
  // pick 64 dims with the largest magnitude for a representative sparkline preview
  const vectorPreview = useMemo(() => {
    if (!vector.length) return [] as number[];
    const indexed = vector.map((v, i) => ({ v: Math.abs(v), i }));
    indexed.sort((a, b) => b.v - a.v);
    const top = indexed.slice(0, 64).sort((a, b) => a.i - b.i);
    return top.map((t) => vector[t.i]);
  }, [vector]);

  const run = async () => {
    if (!query.trim() || running) return;
    setRunning(true);
    setError(null);
    setMatches([]);
    setStage(-1);

    const advance = (i: number, delay: number) =>
      new Promise<void>((res) => setTimeout(() => { setStage(i); res(); }, delay));

    await advance(0, 200);
    await advance(1, 600);
    await advance(2, 700);
    await advance(3, 700);

    try {
      const t0 = performance.now();
      const queryEmbedding = embed(query);
      const { data, error: rpcErr } = await supabase.rpc("match_films", {
        query_embedding: queryEmbedding as any,
        match_count: 6,
        filter_genres: null,
      });
      const ms = Math.round(performance.now() - t0);
      if (rpcErr) throw rpcErr;
      setMatches((data ?? []) as Match[]);
      setSearchMs(ms);
    } catch (e: any) {
      setError(e?.message ?? "Retrieval failed");
      setRunning(false);
      return;
    }

    await advance(4, 600);
    await advance(5, 700);
    setTimeout(() => setRunning(false), 500);
  };

  const isActive = (i: number) => running && stage === i;
  const isDone = (i: number) => stage > i || (!running && stage >= i);

  return (
    <section className="bg-paper-warm border-y border-ink/15">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="flex items-baseline justify-between flex-wrap gap-4 mb-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-oxblood mb-2">
              RAG · Live Architecture
            </div>
            <h2 className="font-display text-4xl md:text-5xl text-ink leading-tight">
              How retrieval-augmented generation works here.
            </h2>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft text-right">
            Corpus: <span className="text-oxblood">{corpusSize?.toLocaleString() ?? "—"}</span> films
            <br />
            pgvector · 768-dim · cosine
          </div>
        </div>
        <p className="max-w-2xl text-ink-soft leading-relaxed">
          Type any logline and watch it travel through the six stages of the pipeline. The retrieve
          step hits the live database — these are real nearest neighbors.
        </p>

        {/* Query input */}
        <div className="mt-8 rounded-sm border border-ink/20 bg-card p-5 shadow-print">
          <label className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-soft">
            Query
          </label>
          <div className="mt-2 flex gap-3 flex-wrap md:flex-nowrap">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={2}
              disabled={running}
              className="flex-1 min-w-0 bg-paper border border-ink/15 rounded-sm focus:border-oxblood focus:outline-none p-3 text-ink text-sm leading-relaxed resize-none disabled:opacity-60"
              placeholder="Paste a logline…"
            />
            <button
              type="button"
              onClick={run}
              disabled={running || !query.trim()}
              className="self-stretch md:self-auto inline-flex items-center justify-center gap-2 bg-ink text-paper px-5 py-3 rounded-sm font-mono text-[11px] uppercase tracking-[0.25em] hover:bg-oxblood transition-colors disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
            >
              {running ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</>
              ) : (
                <><Play className="h-3.5 w-3.5" /> Run pipeline</>
              )}
            </button>
          </div>
        </div>

        {/* Pipeline diagram */}
        <div className="mt-8 rounded-sm border border-ink/15 bg-card p-6 md:p-8 shadow-print overflow-hidden">
          <div className="relative">
            {/* track */}
            <div className="absolute left-0 right-0 top-7 h-[2px] bg-ink/10 rounded-full" />
            <div
              className="absolute left-0 top-7 h-[2px] bg-gradient-to-r from-oxblood via-amber to-oxblood rounded-full transition-all duration-500"
              style={{ width: `${Math.max(0, ((stage + 1) / STAGES.length) * 100)}%` }}
            />
            <ol className="relative grid grid-cols-6 gap-1">
              {STAGES.map((s, i) => {
                const Icon = s.icon;
                const active = isActive(i);
                const done = isDone(i);
                return (
                  <li key={s.key} className="flex flex-col items-center text-center">
                    <div
                      className={[
                        "relative h-14 w-14 rounded-full flex items-center justify-center border-2 transition-all duration-500 z-10",
                        done
                          ? "bg-oxblood border-oxblood text-paper"
                          : active
                          ? "bg-paper-warm border-amber text-oxblood scale-110 shadow-[0_0_0_6px_hsl(var(--amber)/0.18)]"
                          : "bg-paper border-ink/20 text-ink-soft/60 scale-95",
                      ].join(" ")}
                    >
                      {active ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="mt-3">
                      <div
                        className={[
                          "font-mono text-[10px] uppercase tracking-[0.18em]",
                          done ? "text-oxblood" : active ? "text-ink" : "text-ink-soft/60",
                        ].join(" ")}
                      >
                        {String(i + 1).padStart(2, "0")} · {s.label}
                      </div>
                      <div className="text-[10px] mt-0.5 leading-tight text-ink-soft/70 hidden md:block">
                        {s.sub}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Stage details — three panels animate in as the run progresses */}
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {/* Tokens */}
            <StagePanel
              n="02"
              label="Tokenize"
              hint="Lowercased words ≥ 3 chars"
              dim={!isDone(1) && !isActive(1)}
            >
              <div className="flex flex-wrap gap-1.5">
                {tokens.length === 0 && (
                  <span className="text-ink-soft/50 text-xs italic">— enter a query —</span>
                )}
                {tokens.slice(0, 60).map((t, i) => (
                  <span
                    key={i}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-ink/5 text-ink border border-ink/10"
                  >
                    {t}
                  </span>
                ))}
                {tokens.length > 60 && (
                  <span className="font-mono text-[10px] text-ink-soft">
                    +{tokens.length - 60}
                  </span>
                )}
              </div>
              <div className="mt-3 font-mono text-[10px] text-ink-soft tabular-nums">
                {tokens.length} tokens
              </div>
            </StagePanel>

            {/* Embedding sparkline */}
            <StagePanel
              n="03"
              label="Embed"
              hint="Hashed BoW · L2-normalized"
              dim={!isDone(2) && !isActive(2)}
            >
              <div className="flex items-end gap-[2px] h-16">
                {(vectorPreview.length ? vectorPreview : new Array(64).fill(0)).map((v, i) => {
                  const h = Math.min(100, Math.abs(v) * 800);
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-[1px] transition-all"
                      style={{
                        height: `${Math.max(4, h)}%`,
                        background:
                          v >= 0
                            ? "hsl(var(--oxblood) / 0.85)"
                            : "hsl(var(--amber) / 0.85)",
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-3 font-mono text-[10px] text-ink-soft tabular-nums">
                vector ∈ ℝ<sup>768</sup> · showing top-64 by magnitude
              </div>
            </StagePanel>

            {/* Retrieval stats */}
            <StagePanel
              n="04"
              label="Retrieve"
              hint="SELECT … ORDER BY embedding <=> query"
              dim={!isDone(3) && !isActive(3)}
            >
              {matches.length > 0 ? (
                <>
                  <div className="font-display text-3xl text-oxblood tabular-nums leading-none">
                    {matches.length}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft mt-1">
                    nearest neighbors · {searchMs}ms
                  </div>
                  <div className="mt-3 space-y-1">
                    {matches.slice(0, 3).map((m, i) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-ink truncate">
                          <span className="font-mono text-[10px] text-amber mr-1.5">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {m.title}
                        </span>
                        <span className="font-mono text-[10px] text-oxblood tabular-nums">
                          {(m.similarity * 100).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-ink-soft/50 text-xs italic">
                  — run the pipeline to query pgvector —
                </div>
              )}
            </StagePanel>
          </div>

          {error && (
            <div className="mt-6 border-l-2 border-oxblood bg-oxblood/5 p-3 text-sm text-ink">
              {error}
            </div>
          )}

          {/* Retrieved context — shown after stage 4 */}
          {matches.length > 0 && stage >= 4 && (
            <div className="mt-10 animate-fade-in">
              <div className="flex items-baseline gap-3 mb-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber">
                  05
                </span>
                <h4 className="font-display text-xl text-ink">Context assembly</h4>
                <div className="flex-1 h-px bg-ink/10" />
                <span className="font-mono text-[10px] text-ink-soft">
                  → injected into LLM prompt
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {matches.map((m, i) => (
                  <div
                    key={m.id}
                    className="border border-ink/15 bg-paper rounded-sm p-3 flex gap-3 hover:border-oxblood/40 transition-colors"
                  >
                    <div className="flex-shrink-0 w-12 aspect-[2/3] bg-ink/5 rounded-sm overflow-hidden">
                      {m.poster_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w92${m.poster_path}`}
                          alt={`${m.title} poster`}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-mono text-[8px] text-ink-soft/40 text-center px-1">
                          {m.title.slice(0, 8)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[9px] text-amber tabular-nums">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="font-display text-sm text-ink truncate">
                          {m.title}
                        </span>
                        <span className="font-mono text-[9px] text-ink-soft tabular-nums ml-auto">
                          {(m.similarity * 100).toFixed(1)}
                        </span>
                      </div>
                      <div className="font-mono text-[9px] text-ink-soft mt-0.5">
                        {m.year ?? "—"} · {(m.genres ?? []).slice(0, 2).join(", ")}
                      </div>
                      <p className="text-[11px] text-ink-soft mt-1 leading-snug line-clamp-3">
                        {m.overview}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LLM final stage callout */}
          {stage >= 5 && (
            <div className="mt-10 animate-fade-in border-l-2 border-amber bg-paper-warm/40 p-5 rounded-sm">
              <div className="flex items-center gap-3">
                <Sparkles className="h-4 w-4 text-oxblood" />
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-oxblood">
                  06 · Generate
                </span>
              </div>
              <p className="mt-2 text-sm text-ink leading-relaxed">
                The 6 retrieved films above are formatted into a structured prompt and sent to
                Gemini 2.5 Pro, which grounds its analysis in this evidence — no hallucinated
                ancestors. To run the full multi-agent flow (planner → critic → risk → prescriber →
                note), submit a project in the form above.
                <ChevronRight className="inline h-3 w-3 ml-1 text-oxblood" />
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const StagePanel = ({
  n,
  label,
  hint,
  dim,
  children,
}: {
  n: string;
  label: string;
  hint: string;
  dim?: boolean;
  children: React.ReactNode;
}) => (
  <div
    className={[
      "border border-ink/10 bg-paper rounded-sm p-4 transition-opacity",
      dim ? "opacity-50" : "opacity-100",
    ].join(" ")}
  >
    <div className="flex items-baseline justify-between gap-2 mb-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-oxblood">
        {n} · {label}
      </div>
      <div className="font-mono text-[9px] text-ink-soft/70">{hint}</div>
    </div>
    {children}
  </div>
);
