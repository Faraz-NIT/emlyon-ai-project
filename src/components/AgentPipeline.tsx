import { useEffect, useState } from "react";
import {
  Compass,
  Database,
  ScanLine,
  Microscope,
  Gauge,
  Stethoscope,
  PenTool,
  Check,
  Loader2,
} from "lucide-react";

const NODES = [
  { key: "planner", label: "Planner", sub: "Picks genres + keywords", icon: Compass },
  { key: "retriever", label: "Retriever", sub: "Vector RAG over corpus", icon: Database },
  { key: "beat_annotator", label: "Annotator", sub: "Lazy beat extraction", icon: ScanLine },
  { key: "beat_critic", label: "Critic", sub: "10 ancestors · heatmap", icon: Microscope },
  { key: "risk_scorer", label: "Risk", sub: "Midpoint collapse", icon: Gauge },
  { key: "prescriber", label: "Prescriber", sub: "3 act-3 moves", icon: Stethoscope },
  { key: "note_writer", label: "Notes", sub: "Final development note", icon: PenTool },
] as const;

interface TraceStep { node: string; ms: number; summary: string }

interface Props {
  active: boolean;
  trace: TraceStep[];
}

// Estimated weight per node for the simulated progress while waiting.
// Critic + Notes use Pro and dominate runtime.
const WEIGHTS: Record<string, number> = {
  planner: 1,
  retriever: 1,
  beat_annotator: 4,
  beat_critic: 5,
  risk_scorer: 1,
  prescriber: 1.5,
  note_writer: 4,
};
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
// ~25s end-to-end estimate (purely cosmetic; trace resolves it once it lands)
const ESTIMATE_MS = 25000;

export const AgentPipeline = ({ active, trace }: Props) => {
  // While `active` and no trace yet, advance currentIdx on a schedule.
  // Once trace arrives, mark all completed.
  const [simIdx, setSimIdx] = useState(-1);

  useEffect(() => {
    if (!active) {
      setSimIdx(-1);
      return;
    }
    let cancelled = false;
    let elapsed = 0;
    const tick = () => {
      if (cancelled) return;
      // Decide which node we should be on based on elapsed/estimate
      let acc = 0;
      let idx = 0;
      const target = (elapsed / ESTIMATE_MS) * TOTAL_WEIGHT;
      for (let i = 0; i < NODES.length; i++) {
        acc += WEIGHTS[NODES[i].key];
        if (target <= acc) { idx = i; break; }
        idx = i;
      }
      setSimIdx(Math.min(idx, NODES.length - 1));
      elapsed += 400;
      timer = window.setTimeout(tick, 400);
    };
    let timer = window.setTimeout(tick, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active]);

  const completedKeys = new Set(trace.map((t) => t.node));
  const allDone = !active && trace.length > 0;

  // For each node decide: done / active / pending
  const stateOf = (key: string, i: number): "done" | "active" | "pending" => {
    if (allDone || completedKeys.has(key)) return "done";
    if (active && i === simIdx) return "active";
    if (active && i < simIdx) return "done";
    return "pending";
  };

  // Overall progress for the connector fill
  const progress = allDone
    ? 100
    : active
    ? Math.min(100, ((simIdx + 1) / NODES.length) * 100)
    : 0;

  return (
    <div className="rounded-sm border border-ink/15 bg-card p-6 md:p-8 shadow-print overflow-hidden">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-oxblood mb-1">
            LangGraph · Live Pipeline
          </div>
          <h3 className="font-display text-xl text-ink">7 agents · sequential graph</h3>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft tabular-nums">
          {active ? "Sequencing…" : allDone ? "Complete" : "Idle"} · {Math.round(progress)}%
        </div>
      </div>

      {/* Track + nodes */}
      <div className="relative">
        {/* Background rail */}
        <div className="absolute left-0 right-0 top-7 h-[2px] bg-ink/10 rounded-full" />
        {/* Animated fill */}
        <div
          className="absolute left-0 top-7 h-[2px] bg-gradient-to-r from-oxblood via-amber to-oxblood rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
        {/* Pulse marker on the leading edge while running */}
        {active && (
          <div
            className="absolute top-7 h-[2px] w-16 bg-amber/60 blur-md rounded-full pointer-events-none transition-all duration-500"
            style={{ left: `calc(${progress}% - 4rem)` }}
          />
        )}

        <ol className="relative grid grid-cols-7 gap-1">
          {NODES.map((n, i) => {
            const st = stateOf(n.key, i);
            const Icon = n.icon;
            const traced = trace.find((t) => t.node === n.key);
            return (
              <li key={n.key} className="flex flex-col items-center text-center">
                <div
                  className={[
                    "relative h-14 w-14 rounded-full flex items-center justify-center border-2 transition-all duration-500 z-10",
                    st === "done"
                      ? "bg-oxblood border-oxblood text-paper scale-100"
                      : st === "active"
                      ? "bg-paper-warm border-amber text-oxblood scale-110 shadow-[0_0_0_6px_hsl(var(--amber)/0.18)]"
                      : "bg-paper border-ink/20 text-ink-soft/60 scale-95",
                  ].join(" ")}
                  style={st === "active" ? { animation: "agent-pulse 1.1s ease-in-out infinite" } : undefined}
                >
                  {st === "done" ? (
                    <Check className="h-5 w-5" strokeWidth={2.5} />
                  ) : st === "active" ? (
                    <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
                  ) : (
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  )}
                </div>
                <div className="mt-3 min-h-[2.5rem]">
                  <div
                    className={[
                      "font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                      st === "done"
                        ? "text-oxblood"
                        : st === "active"
                        ? "text-ink"
                        : "text-ink-soft/60",
                    ].join(" ")}
                  >
                    {String(i + 1).padStart(2, "0")} · {n.label}
                  </div>
                  <div
                    className={[
                      "text-[10px] mt-0.5 leading-tight transition-opacity hidden md:block",
                      st === "pending" ? "opacity-40" : "opacity-80",
                    ].join(" ")}
                  >
                    {n.sub}
                  </div>
                  {traced && (
                    <div className="font-mono text-[9px] text-ink-soft/70 mt-1 tabular-nums animate-fade-in">
                      {traced.ms}ms
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Live status line */}
      <div className="mt-6 min-h-[1.25rem] text-xs text-ink-soft font-mono">
        {active && simIdx >= 0 && (
          <span className="animate-fade-in">
            <span className="text-oxblood">▸</span> Running{" "}
            <span className="text-ink">{NODES[simIdx].label}</span> — {NODES[simIdx].sub.toLowerCase()}…
          </span>
        )}
        {allDone && (
          <span className="animate-fade-in">
            <span className="text-oxblood">✓</span> Pipeline complete · {trace.length} nodes ·{" "}
            {trace.reduce((a, b) => a + b.ms, 0)}ms total
          </span>
        )}
      </div>

      {/* Inline keyframes — pulse halo for the active node */}
      <style>{`
        @keyframes agent-pulse {
          0%, 100% { box-shadow: 0 0 0 6px hsl(var(--amber) / 0.18); }
          50%      { box-shadow: 0 0 0 14px hsl(var(--amber) / 0.05); }
        }
      `}</style>
    </div>
  );
};
