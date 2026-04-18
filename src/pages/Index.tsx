import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Film, Sparkles, AlertTriangle, ChevronRight, Quote } from "lucide-react";
import { AgentPipeline } from "@/components/AgentPipeline";
import { TechStack } from "@/components/TechStack";
import heroDna from "@/assets/hero-dna.jpg";

type Beat = "setup" | "inciting" | "pp1" | "midpoint" | "low" | "climax" | "resolution";
const BEAT_LABEL: Record<Beat, string> = {
  setup: "Setup",
  inciting: "Inciting Incident",
  pp1: "Plot Point 1",
  midpoint: "Midpoint",
  low: "All Is Lost",
  climax: "Climax",
  resolution: "Resolution",
};

interface DnaReport {
  headline: string;
  matches: { title: string; year?: number; similarity: number; why: string; did_right: string; risk: string; poster_path?: string | null; tmdb_id?: number | null }[];
  beat_heatmap: { beat: Beat; confidence: number; risk_note: string }[];
  midpoint_risk_score: number;
  midpoint_diagnosis: string;
  act3_prescription: string[];
  development_note: string;
}

const SAMPLE = {
  title: "The Last Vault",
  genre: "Heist, Thriller",
  logline:
    "A retired forger is blackmailed into joining her ex-husband's crew to steal back a painting that could expose them all.",
  outline:
    "Act 1: Mira lives quietly restoring art. Her ex Daniel reappears with proof of her old crimes. She agrees to one job.\nAct 2A: The crew assembles, scouts the museum, plans the lift around a charity gala.\nMidpoint: The painting they're stealing is a forgery — Mira's own.\nAct 2B: Daniel was working a side angle. Mira goes off-script.\nAct 3: Confrontation in the vault. Mira walks out with the real piece, leaves Daniel for the law.",
};

interface TraceStep { node: string; ms: number; summary: string }

const ScriptDNA = () => {
  const [form, setForm] = useState({ title: "", genre: "", logline: "", outline: "" });
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DnaReport | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [plan, setPlan] = useState<{ search_genres: string[]; structural_keywords: string[]; reasoning: string } | null>(null);
  const [corpusSize, setCorpusSize] = useState<number | null>(null);
  const [annotated, setAnnotated] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [{ count: total }, { count: ann }] = await Promise.all([
        supabase.from("films_corpus").select("*", { count: "exact", head: true }),
        supabase.from("films_corpus").select("*", { count: "exact", head: true }).not("beats", "is", null),
      ]);
      setCorpusSize(total ?? 0);
      setAnnotated(ann ?? 0);
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.logline.trim() || !form.genre.trim()) {
      toast.error("Logline and genre are required.");
      return;
    }
    setLoading(true);
    setReport(null);
    setTrace([]);
    setPlan(null);
    try {
      const { data, error } = await supabase.functions.invoke("analyse-script", { body: form });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const d = data as any;
      setReport(d.report as DnaReport);
      setTrace((d.trace as TraceStep[]) ?? []);
      setPlan(d.plan ?? null);
      setTimeout(() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err: any) {
      toast.error(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-paper grain">
      {/* Masthead */}
      <header className="border-b border-ink/15 bg-paper-warm">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film className="h-5 w-5 text-oxblood" strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
              Vol. I · Issue 01 · The Story Lab
            </span>
          </div>
          <div className="flex items-center gap-5">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
              LangGraph · pgvector RAG over{" "}
              <span className="text-oxblood">{corpusSize?.toLocaleString() ?? "—"}</span> films
              {annotated !== null && (
                <span className="text-ink-soft/70"> · {annotated.toLocaleString()} beat-annotated</span>
              )}
            </span>
            <Link
              to="/admin"
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft hover:text-oxblood underline underline-offset-4"
            >
              Admin
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pt-16 pb-12">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-oxblood mb-6">
              Script · DNA · Analyser
            </div>
            <h1 className="font-display font-black text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.95] text-ink">
              Your screenplay has a{" "}
              <em className="text-oxblood not-italic" style={{ fontStyle: "italic" }}>
                structural ancestor.
              </em>{" "}
              Find out which one.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft leading-relaxed">
              Paste your logline, genre, and a rough outline. We RAG over a curated reference set of films,
              find the ten closest structural matches, and deliver a development note that predicts where
              your draft will collapse — and how to save it.
            </p>
          </div>
          <aside className="lg:col-span-5">
            <img
              src={heroDna}
              alt="Story DNA helix entwined with a film strip — editorial illustration"
              width={1024}
              height={1280}
              className="w-full h-auto rounded-sm border border-ink/15 shadow-print"
            />
          </aside>
        </div>
      </section>

      {/* Form */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <form
          onSubmit={submit}
          className="rounded-sm border border-ink/20 bg-paper-warm p-6 md:p-10 shadow-print"
        >
          <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
            <h2 className="font-display text-3xl text-ink">Submit your project</h2>
            <button
              type="button"
              onClick={() => setForm(SAMPLE)}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-oxblood hover:text-oxblood-deep underline underline-offset-4"
            >
              Load sample script →
            </button>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Working title" optional>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="The Last Vault"
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-oxblood focus:outline-none py-2 text-ink placeholder:text-ink/30 font-display text-xl"
              />
            </Field>
            <Field label="Genre">
              <input
                value={form.genre}
                onChange={(e) => setForm({ ...form, genre: e.target.value })}
                placeholder="Heist, Thriller"
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-oxblood focus:outline-none py-2 text-ink placeholder:text-ink/30 font-display text-xl"
              />
            </Field>
          </div>

          <div className="mt-6">
            <Field label="Logline">
              <textarea
                value={form.logline}
                onChange={(e) => setForm({ ...form, logline: e.target.value })}
                rows={2}
                placeholder="A one-sentence pitch with protagonist, want, and obstacle."
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-oxblood focus:outline-none py-2 text-ink placeholder:text-ink/30 font-display text-xl leading-snug resize-none"
              />
            </Field>
          </div>

          <div className="mt-6">
            <Field label="Rough outline" optional>
              <textarea
                value={form.outline}
                onChange={(e) => setForm({ ...form, outline: e.target.value })}
                rows={6}
                placeholder="Beat sheet or paragraph per act — whatever you have."
                className="w-full bg-paper border border-ink/15 rounded-sm focus:border-oxblood focus:outline-none p-4 text-ink placeholder:text-ink/30 text-sm leading-relaxed"
              />
            </Field>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-ink/15 pt-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
              Gemini 2.5 Pro · RAG corpus
            </p>
            <button
              type="submit"
              disabled={loading}
              className="group inline-flex items-center gap-3 bg-ink text-paper px-6 py-3 rounded-sm font-mono text-[11px] uppercase tracking-[0.25em] hover:bg-oxblood transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sequencing DNA…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" /> Sequence the DNA
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Animated agent pipeline — visible while running and after */}
        {(loading || trace.length > 0) && (
          <div className="mt-8 animate-fade-in">
            <AgentPipeline active={loading} trace={trace} />
          </div>
        )}
      </section>

      {/* Agent trace */}
      {trace.length > 0 && (
        <section className="bg-ink text-paper border-t border-ink/40">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <div className="flex items-baseline justify-between flex-wrap gap-3 mb-6">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber mb-2">
                  LangGraph Trace
                </div>
                <h3 className="font-display text-2xl text-paper">Agent execution</h3>
              </div>
              {plan && (
                <div className="text-xs text-paper/60 font-mono max-w-md text-right">
                  Planner → genres: <span className="text-amber">{plan.search_genres.join(", ")}</span>
                </div>
              )}
            </div>
            <ol className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {trace.map((s, i) => (
                <li
                  key={i}
                  className="border border-paper/10 bg-paper/[0.03] rounded-sm p-4 hover:bg-paper/[0.06] transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber">
                      {String(i + 1).padStart(2, "0")} · {s.node}
                    </span>
                    <span className="font-mono text-[10px] text-paper/50 tabular-nums">{s.ms}ms</span>
                  </div>
                  <p className="mt-2 text-sm text-paper/85 leading-snug">{s.summary}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* Report */}
      {report && (
        <section id="report" className="bg-celluloid text-paper border-t border-ink/40">
          <div className="mx-auto max-w-7xl px-6 py-20">
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-amber mb-4">
              Development Note · Confidential
            </div>
            <h2 className="font-display font-black text-[clamp(2rem,5vw,4rem)] leading-[1.05] max-w-4xl">
              <Quote className="inline h-6 w-6 text-amber mr-2 -mt-3" />
              {report.headline}
            </h2>

            {/* Top 10 matches */}
            <div className="mt-16 grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <SectionTitle n="01" title="Structural Ancestors" />

                {/* Poster wall — TMDB w185 thumbnails for the 10 matches */}
                {report.matches.some((m) => m.poster_path) && (
                  <div className="mt-6 grid grid-cols-5 gap-3 sm:gap-4">
                    {report.matches.map((m, i) => (
                      <div
                        key={`poster-${i}`}
                        className="group relative aspect-[2/3] overflow-hidden rounded-sm border border-paper/15 bg-paper/[0.04]"
                        title={`${m.title}${m.year ? ` (${m.year})` : ""}`}
                      >
                        {m.poster_path ? (
                          <img
                            src={`https://image.tmdb.org/t/p/w185${m.poster_path}`}
                            alt={`${m.title} poster`}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-2 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-paper/40">
                            {m.title}
                          </div>
                        )}
                        <div className="absolute left-1 top-1 rounded-sm bg-ink/80 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-amber">
                          {String(i + 1).padStart(2, "0")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <ul className="mt-8 divide-y divide-paper/10 border-y border-paper/10">
                  {report.matches.map((m, i) => (
                    <li key={i} className="py-5 grid grid-cols-12 gap-4 items-baseline">
                      <span className="col-span-1 font-mono text-xs text-amber tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="col-span-8">
                        <div className="font-display text-2xl text-paper">
                          {m.title} <span className="text-paper/50 text-base">{m.year ? `(${m.year})` : ""}</span>
                        </div>
                        <p className="text-sm text-paper/70 mt-1">{m.why}</p>
                        <div className="mt-2 grid sm:grid-cols-2 gap-2 text-xs">
                          <span className="text-paper/80">
                            <span className="text-amber font-mono">+ </span>
                            {m.did_right}
                          </span>
                          <span className="text-paper/80">
                            <span className="text-oxblood font-mono">⚠ </span>
                            {m.risk}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-3 text-right">
                        <div className="font-display text-3xl text-amber tabular-nums">{m.similarity}</div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper/50">match</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right column: midpoint risk + heatmap */}
              <div className="lg:col-span-5 space-y-10">
                <div>
                  <SectionTitle n="02" title="Midpoint Collapse Risk" />
                  <div className="mt-6 rounded-sm border border-paper/15 bg-paper/[0.03] p-6">
                    <div className="flex items-end gap-4">
                      <div
                        className="font-display font-black text-7xl tabular-nums leading-none"
                        style={{
                          color:
                            report.midpoint_risk_score >= 65
                              ? "hsl(var(--oxblood))"
                              : report.midpoint_risk_score >= 35
                              ? "hsl(var(--amber))"
                              : "hsl(36 22% 94%)",
                        }}
                      >
                        {report.midpoint_risk_score}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper/50 pb-3">
                        / 100
                      </div>
                    </div>
                    <div className="mt-4 h-1 bg-paper/10 rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-oxblood"
                        style={{ width: `${report.midpoint_risk_score}%` }}
                      />
                    </div>
                    <p className="mt-5 text-sm text-paper/80 leading-relaxed">
                      <AlertTriangle className="inline h-4 w-4 text-amber mr-1 -mt-1" />
                      {report.midpoint_diagnosis}
                    </p>
                  </div>
                </div>

                <div>
                  <SectionTitle n="03" title="Beat Heatmap" />
                  <div className="mt-6 space-y-2.5">
                    {report.beat_heatmap.map((b) => (
                      <div key={b.beat} className="grid grid-cols-12 items-center gap-3">
                        <div className="col-span-4 font-mono text-[11px] uppercase tracking-wider text-paper/70">
                          {BEAT_LABEL[b.beat]}
                        </div>
                        <div className="col-span-6 h-2 bg-paper/10 rounded-sm overflow-hidden">
                          <div
                            className="h-full"
                            style={{
                              width: `${b.confidence}%`,
                              background:
                                b.confidence >= 65
                                  ? "hsl(var(--amber))"
                                  : b.confidence >= 35
                                  ? "hsl(38 60% 45%)"
                                  : "hsl(var(--oxblood))",
                            }}
                          />
                        </div>
                        <div className="col-span-2 text-right font-mono text-xs text-paper/80 tabular-nums">
                          {b.confidence}
                        </div>
                        <div className="col-span-12 col-start-1 ml-[calc(33.333%+0.75rem)] text-[11px] text-paper/55 -mt-1">
                          {b.risk_note}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Act 3 prescription */}
            <div className="mt-20">
              <SectionTitle n="04" title="Act III Prescription" />
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {report.act3_prescription.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-sm border border-paper/15 bg-paper/[0.03] p-6 hover:bg-paper/[0.06] transition-colors"
                  >
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber mb-3">
                      Move {String(i + 1).padStart(2, "0")}
                    </div>
                    <p className="font-display text-lg leading-snug text-paper">{p}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Dev note */}
            <div className="mt-20 max-w-3xl">
              <SectionTitle n="05" title="The Note" />
              <article className="mt-6 font-display text-xl md:text-2xl leading-[1.5] text-paper/95 first-letter:font-black first-letter:text-6xl first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:text-amber">
                {report.development_note}
              </article>
              <div className="mt-8 rule-edge h-px" />
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-paper/40">
                — Script DNA · Generated for development purposes only
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-ink/15 bg-paper-warm">
        <div className="mx-auto max-w-7xl px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-soft">
          <span className="font-mono uppercase tracking-[0.2em]">
            Generative AI Final Project · 2026
          </span>
          <span className="font-mono uppercase tracking-[0.2em]">RAG · LLM · Tool-Calling</span>
        </div>
      </footer>
    </main>
  );
};

const Field = ({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-soft">
      {label}
      {optional && <span className="text-ink/30"> · optional</span>}
    </span>
    <div className="mt-1">{children}</div>
  </label>
);

const SectionTitle = ({ n, title }: { n: string; title: string }) => (
  <div className="flex items-baseline gap-4">
    <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber">{n}</span>
    <h3 className="font-display text-2xl text-paper">{title}</h3>
    <div className="flex-1 h-px bg-paper/10" />
  </div>
);

export default ScriptDNA;
