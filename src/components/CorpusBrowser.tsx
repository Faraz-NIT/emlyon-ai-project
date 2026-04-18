// CorpusBrowser — a dialog that paginates the films_corpus RAG store so the
// writer can see exactly what films we're matching them against. Searchable
// by title, with a badge indicating whether each row has beat annotations
// cached. Reads only — the table is publicly readable via RLS.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Database, Search, Loader2, X, Check } from "lucide-react";

interface FilmRow {
  id: string;
  title: string;
  year: number | null;
  genres: string[];
  poster_path: string | null;
  popularity: number | null;
  beats: any | null;
  overview: string;
}

const PAGE_SIZE = 24;

export const CorpusBrowser = () => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FilmRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when search changes
  useEffect(() => setPage(0), [debounced]);

  // Fetch on open / page / search change
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("films_corpus")
        .select("id,title,year,genres,poster_path,popularity,beats,overview", { count: "exact" })
        .order("popularity", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (debounced) q = q.ilike("title", `%${debounced}%`);
      const { data, count, error } = await q;
      if (cancelled) return;
      if (!error) {
        setRows((data ?? []) as FilmRow[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, page, debounced]);

  // Lock body scroll while dialog open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft hover:text-oxblood underline underline-offset-4"
        title="Browse the films_corpus RAG store"
      >
        <Database className="h-3 w-3" strokeWidth={1.6} />
        Inspect corpus
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/70 backdrop-blur-sm p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-6xl max-h-[90vh] flex flex-col rounded-sm border border-ink/30 bg-paper-warm shadow-print overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 border-b border-ink/15 px-5 py-4">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-oxblood">
                  RAG Store · films_corpus
                </div>
                <h3 className="font-display text-xl text-ink truncate">
                  {total.toLocaleString()} films · pgvector index
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative hidden sm:block">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-soft" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search titles…"
                    className="w-56 bg-paper border border-ink/20 rounded-sm pl-8 pr-3 py-1.5 text-sm focus:border-oxblood focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-sm border border-ink/20 hover:border-oxblood hover:text-oxblood transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Mobile search */}
            <div className="sm:hidden border-b border-ink/15 px-5 py-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-soft" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search titles…"
                  className="w-full bg-paper border border-ink/20 rounded-sm pl-8 pr-3 py-1.5 text-sm focus:border-oxblood focus:outline-none"
                />
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="flex items-center justify-center py-20 text-ink-soft">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <div className="text-center py-20 font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">
                  No films match.
                </div>
              ) : (
                <ul className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {rows.map((f) => {
                    const annotated = f.beats && Object.keys(f.beats || {}).length > 0;
                    return (
                      <li key={f.id} className="group">
                        <div className="relative aspect-[2/3] overflow-hidden rounded-sm border border-ink/15 bg-paper">
                          {f.poster_path ? (
                            <img
                              src={`https://image.tmdb.org/t/p/w185${f.poster_path}`}
                              alt={`${f.title} poster`}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center px-2 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-ink-soft">
                              {f.title}
                            </div>
                          )}
                          {annotated && (
                            <div
                              className="absolute right-1 top-1 flex items-center gap-1 rounded-sm bg-ink/80 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.15em] text-amber"
                              title="Beat-annotated · cached"
                            >
                              <Check className="h-2.5 w-2.5" />
                              beats
                            </div>
                          )}
                        </div>
                        <div className="mt-1.5 font-display text-sm text-ink leading-tight line-clamp-2">
                          {f.title}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                          {f.year ?? "—"}
                          {f.genres?.[0] && <span className="text-ink-soft/60"> · {f.genres[0]}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer / pagination */}
            <div className="flex items-center justify-between border-t border-ink/15 px-5 py-3 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                {showingFrom}–{showingTo} of {total.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 0 || loading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] border border-ink/20 rounded-sm hover:border-oxblood hover:text-oxblood disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="font-mono text-[10px] tabular-nums text-ink-soft">
                  {page + 1} / {totalPages}
                </span>
                <button
                  disabled={page + 1 >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] border border-ink/20 rounded-sm hover:border-oxblood hover:text-oxblood disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
