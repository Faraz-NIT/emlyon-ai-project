import { motion } from "framer-motion";

/* Decorative film-strip running vertically along the page edge */
export const FilmStrip = ({ side = "left" }: { side?: "left" | "right" }) => (
  <div
    className={`pointer-events-none fixed top-0 ${side}-0 h-full w-8 hidden lg:block z-0`}
    aria-hidden
  >
    <div className="h-full w-full bg-celluloid relative overflow-hidden">
      <motion.div
        className="absolute inset-x-0 flex flex-col gap-3 py-3"
        animate={{ y: ["0%", "-50%"] }}
        transition={{ duration: 30, ease: "linear", repeat: Infinity }}
      >
        {Array.from({ length: 60 }).map((_, i) => (
          <div
            key={i}
            className="mx-auto h-3 w-4 rounded-[1px] bg-paper/90"
          />
        ))}
      </motion.div>
    </div>
  </div>
);

/* Animated radial "scanning" graphic — feels like a film reel / radar */
export const ReelEmblem = () => (
  <div className="relative h-32 w-32">
    <motion.div
      className="absolute inset-0 rounded-full border border-ink/30"
      animate={{ rotate: 360 }}
      transition={{ duration: 24, ease: "linear", repeat: Infinity }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/40"
          style={{
            transform: `translate(-50%, -50%) rotate(${i * 30}deg) translateY(-58px)`,
          }}
        />
      ))}
    </motion.div>
    <motion.div
      className="absolute inset-4 rounded-full border-2 border-oxblood"
      animate={{ rotate: -360 }}
      transition={{ duration: 18, ease: "linear", repeat: Infinity }}
    >
      <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber" />
    </motion.div>
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="h-3 w-3 rounded-full bg-oxblood shadow-[0_0_0_4px_hsl(var(--paper))]" />
    </div>
    <motion.div
      className="absolute inset-0 rounded-full border border-amber/60"
      animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0, 0.6] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
    />
  </div>
);

/* Editorial section divider with center ornament */
export const OrnamentRule = ({ label }: { label?: string }) => (
  <div className="flex items-center gap-4 my-8" aria-hidden>
    <div className="h-px flex-1 bg-ink/20" />
    <div className="flex items-center gap-2">
      <span className="h-1 w-1 rounded-full bg-oxblood" />
      <span className="h-1.5 w-1.5 rounded-full bg-ink" />
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-soft px-2">
          {label}
        </span>
      )}
      <span className="h-1.5 w-1.5 rounded-full bg-ink" />
      <span className="h-1 w-1 rounded-full bg-oxblood" />
    </div>
    <div className="h-px flex-1 bg-ink/20" />
  </div>
);

/* Animated equalizer-style bars that hint at "processing" */
export const ProcessingBars = ({ active = false }: { active?: boolean }) => (
  <div className="flex items-end gap-1 h-8">
    {[0, 1, 2, 3, 4].map((i) => (
      <motion.div
        key={i}
        className="w-1.5 bg-oxblood rounded-sm"
        animate={
          active
            ? { height: ["20%", "100%", "40%", "80%", "30%"] }
            : { height: "20%" }
        }
        transition={{
          duration: 1.2,
          repeat: active ? Infinity : 0,
          delay: i * 0.1,
          ease: "easeInOut",
        }}
        style={{ height: "20%" }}
      />
    ))}
  </div>
);
