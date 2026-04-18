// Tech stack strip for the hero. Inline SVG logos so we stay asset-free and
// can theme strokes/fills with the editorial palette (ink / oxblood / amber).
// Logos are simplified marks — recognisable silhouettes, not pixel-perfect
// brand replicas — which keeps the newsprint aesthetic consistent.

type Logo = { name: string; tag: string; svg: JSX.Element };

const LOGOS: Logo[] = [
  {
    name: "LangGraph",
    tag: "agent orchestration",
    svg: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="8" cy="20" r="3.2" fill="currentColor" />
        <circle cx="20" cy="8" r="3.2" fill="currentColor" />
        <circle cx="20" cy="32" r="3.2" fill="currentColor" />
        <circle cx="32" cy="20" r="3.2" fill="currentColor" />
        <path d="M10.5 18 17.5 10M22.5 10l7 8M10.5 22l7 8M22.5 30l7-8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    name: "pgvector",
    tag: "vector RAG",
    svg: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <ellipse cx="20" cy="10" rx="12" ry="4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 10v20c0 2.2 5.4 4 12 4s12-1.8 12-4V10" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 20c0 2.2 5.4 4 12 4s12-1.8 12-4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    name: "Gemini 2.5",
    tag: "reasoning model",
    svg: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path
          d="M20 4 C20 13 27 20 36 20 C27 20 20 27 20 36 C20 27 13 20 4 20 C13 20 20 13 20 4 Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    name: "TMDB",
    tag: "film corpus",
    svg: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect x="3" y="10" width="34" height="20" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 14h4M3 18h4M3 22h4M3 26h4M33 14h4M33 18h4M33 22h4M33 26h4" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="20" cy="20" r="3.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "Supabase",
    tag: "edge + postgres",
    svg: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M22 4 L6 22 h14 L18 36 L34 18 H20 Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "React + Vite",
    tag: "frontend",
    svg: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="2.4" fill="currentColor" />
        <ellipse cx="20" cy="20" rx="14" ry="5.5" stroke="currentColor" strokeWidth="1.4" />
        <ellipse cx="20" cy="20" rx="14" ry="5.5" stroke="currentColor" strokeWidth="1.4" transform="rotate(60 20 20)" />
        <ellipse cx="20" cy="20" rx="14" ry="5.5" stroke="currentColor" strokeWidth="1.4" transform="rotate(120 20 20)" />
      </svg>
    ),
  },
];

export const TechStack = () => {
  return (
    <div className="mt-10 border-t border-ink/15 pt-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-soft mb-4">
        Built with
      </div>
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-4 sm:gap-x-8">
        {LOGOS.map((l) => (
          <li
            key={l.name}
            className="group flex items-center gap-2.5 text-ink-soft hover:text-oxblood transition-colors"
            title={`${l.name} — ${l.tag}`}
          >
            <span className="h-6 w-6 shrink-0 text-ink/70 group-hover:text-oxblood transition-colors">
              {l.svg}
            </span>
            <span className="leading-tight">
              <span className="block font-display text-sm text-ink group-hover:text-oxblood transition-colors">
                {l.name}
              </span>
              <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-soft/70">
                {l.tag}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
