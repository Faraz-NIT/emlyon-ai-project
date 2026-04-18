import { motion } from "framer-motion";

/**
 * Editorial hero graphic — a stylised "story DNA" double helix
 * crossed with a film strip. Pure SVG + framer-motion, themed
 * with semantic tokens (oxblood, amber, ink, paper).
 */
export const HeroDNA = () => {
  const rungs = Array.from({ length: 14 });
  const sprockets = Array.from({ length: 18 });

  return (
    <div className="relative w-full aspect-[4/5] max-h-[640px] select-none" aria-hidden>
      {/* paper backdrop with crosshair registration marks */}
      <div className="absolute inset-0 rounded-sm border border-ink/15 bg-paper-warm overflow-hidden">
        {/* corner registration marks */}
        {[
          "top-2 left-2",
          "top-2 right-2",
          "bottom-2 left-2",
          "bottom-2 right-2",
        ].map((pos) => (
          <div key={pos} className={`absolute ${pos} h-3 w-3`}>
            <div className="absolute inset-x-0 top-1/2 h-px bg-ink/40" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-ink/40" />
          </div>
        ))}

        {/* faint grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--ink)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--ink)) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* editorial label top */}
        <div className="absolute top-4 left-4 right-4 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.3em] text-ink-soft">
          <span>Fig. 01 — Structural Helix</span>
          <span className="text-oxblood">N = 10⁴</span>
        </div>

        {/* film strip — left rail */}
        <div className="absolute top-12 bottom-12 left-4 w-6 bg-ink rounded-sm overflow-hidden">
          <motion.div
            className="absolute inset-x-0 flex flex-col gap-2 py-2"
            animate={{ y: ["0%", "-50%"] }}
            transition={{ duration: 14, ease: "linear", repeat: Infinity }}
          >
            {sprockets.concat(sprockets).map((_, i) => (
              <div key={i} className="mx-auto h-2 w-3 rounded-[1px] bg-paper" />
            ))}
          </motion.div>
        </div>

        {/* film strip — right rail */}
        <div className="absolute top-12 bottom-12 right-4 w-6 bg-ink rounded-sm overflow-hidden">
          <motion.div
            className="absolute inset-x-0 flex flex-col gap-2 py-2"
            animate={{ y: ["-50%", "0%"] }}
            transition={{ duration: 14, ease: "linear", repeat: Infinity }}
          >
            {sprockets.concat(sprockets).map((_, i) => (
              <div key={i} className="mx-auto h-2 w-3 rounded-[1px] bg-paper" />
            ))}
          </motion.div>
        </div>

        {/* central helix */}
        <svg
          viewBox="0 0 200 500"
          preserveAspectRatio="none"
          className="absolute inset-y-12 left-14 right-14 h-[calc(100%-6rem)] w-[calc(100%-7rem)]"
        >
          <defs>
            <linearGradient id="strandA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--oxblood))" stopOpacity="0.2" />
              <stop offset="50%" stopColor="hsl(var(--oxblood))" stopOpacity="1" />
              <stop offset="100%" stopColor="hsl(var(--oxblood))" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="strandB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--ink))" stopOpacity="0.2" />
              <stop offset="50%" stopColor="hsl(var(--ink))" stopOpacity="1" />
              <stop offset="100%" stopColor="hsl(var(--ink))" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {/* two sinusoidal strands */}
          <motion.path
            d={buildSineWave(200, 500, 60, 14, 0)}
            fill="none"
            stroke="url(#strandA)"
            strokeWidth="2.5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2.4, ease: "easeInOut" }}
          />
          <motion.path
            d={buildSineWave(200, 500, 60, 14, Math.PI)}
            fill="none"
            stroke="url(#strandB)"
            strokeWidth="2.5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2.4, ease: "easeInOut", delay: 0.2 }}
          />

          {/* rungs connecting the strands — beat markers */}
          {rungs.map((_, i) => {
            const t = (i + 1) / (rungs.length + 1);
            const y = t * 500;
            const phase = (y / 500) * Math.PI * 2 * 2;
            const x1 = 100 + Math.sin(phase) * 60;
            const x2 = 100 + Math.sin(phase + Math.PI) * 60;
            const isMidpoint = i === Math.floor(rungs.length / 2);
            return (
              <motion.g
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 + i * 0.07, duration: 0.4 }}
              >
                <line
                  x1={x1}
                  y1={y}
                  x2={x2}
                  y2={y}
                  stroke={
                    isMidpoint ? "hsl(var(--amber))" : "hsl(var(--ink))"
                  }
                  strokeOpacity={isMidpoint ? 1 : 0.35}
                  strokeWidth={isMidpoint ? 2 : 1}
                />
                <circle cx={x1} cy={y} r="3" fill="hsl(var(--oxblood))" />
                <circle cx={x2} cy={y} r="3" fill="hsl(var(--ink))" />
              </motion.g>
            );
          })}

          {/* midpoint pulse */}
          <motion.circle
            cx="100"
            cy="250"
            r="14"
            fill="none"
            stroke="hsl(var(--amber))"
            strokeWidth="1.5"
            animate={{ r: [14, 28, 14], opacity: [0.8, 0, 0.8] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
          />
        </svg>

        {/* beat labels overlay */}
        <div className="pointer-events-none absolute inset-y-12 left-14 right-14 flex flex-col justify-between py-2 font-mono text-[9px] uppercase tracking-[0.25em] text-ink-soft">
          {["Setup", "Inciting", "PP1", "Midpoint", "All Is Lost", "Climax", "Resolution"].map(
            (label, i) => (
              <div
                key={label}
                className={`flex items-center justify-between ${
                  label === "Midpoint" ? "text-oxblood" : ""
                }`}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <span>{label}</span>
              </div>
            )
          )}
        </div>

        {/* footer label */}
        <div className="absolute bottom-4 left-4 right-4 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.3em] text-ink-soft">
          <span>Story DNA · Sequence A‑01</span>
          <span>Helix · 2π · λ‑structural</span>
        </div>
      </div>
    </div>
  );
};

/* helper: construct an SVG sinusoidal path */
function buildSineWave(
  width: number,
  height: number,
  amplitude: number,
  steps: number,
  phase: number
) {
  const cx = width / 2;
  const points: string[] = [];
  for (let i = 0; i <= steps * 4; i++) {
    const t = i / (steps * 4);
    const y = t * height;
    const x = cx + Math.sin(t * Math.PI * 2 * 2 + phase) * amplitude;
    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}
