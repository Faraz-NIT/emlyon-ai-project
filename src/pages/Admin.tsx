import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database, Loader2, ArrowLeft, Sparkles } from "lucide-react";

interface CorpusStats {
  total: number;
  embedded: number;
  annotated: number;
  gold: number;
}

interface Job {
  id: string;
  status: string;
  total: number;
  processed: number;
  inserted: number;
  message: string | null;
  error: string | null;
}

const Admin = () => {
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadStats = async () => {
    const [{ count: total }, { count: embedded }, { count: annotated }, { count: gold }] = await Promise.all([
      supabase.from("films_corpus").select("*", { count: "exact", head: true }),
      supabase.from("films_corpus").select("*", { count: "exact", head: true }).not("embedding", "is", null),
      supabase.from("films_corpus").select("*", { count: "exact", head: true }).not("beats", "is", null),
      supabase.from("films_corpus").select("*", { count: "exact", head: true }).eq("is_gold", true),
    ]);
    setStats({
      total: total ?? 0,
      embedded: embedded ?? 0,
      annotated: annotated ?? 0,
      gold: gold ?? 0,
    });
  };

  useEffect(() => {
    loadStats();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = (jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from("ingest_jobs")
        .select("id,status,total,processed,inserted,message,error")
        .eq("id", jobId)
        .maybeSingle();
      if (data) {
        setJob(data as Job);
        loadStats();
        if (data.status === "done" || data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          if (data.status === "done") toast.success(data.message ?? "Ingestion complete.");
          else toast.error(`Ingestion failed: ${data.error ?? "unknown"}`);
        }
      }
    }, 2000);
  };

  const ingest = async (limit: number) => {
    setQueueing(true);
    setJob(null);
    try {
      const { data, error } = await supabase.functions.invoke("ingest-tmdb", { body: { limit } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const jobId = (data as any).job_id;
      toast.message(`Queued. Limit: ${limit}.`);
      startPolling(jobId);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to queue ingestion");
    } finally {
      setQueueing(false);
    }
  };

  const pct = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <main className="min-h-screen bg-paper grain">
      <header className="border-b border-ink/15 bg-paper-warm">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-ink hover:text-oxblood transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em]">Back</span>
          </Link>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-oxblood" strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
              Corpus Admin
            </span>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-oxblood mb-4">
          Corpus · Management
        </div>
        <h1 className="font-display font-black text-5xl text-ink leading-tight">
          Build the <em className="text-oxblood not-italic" style={{ fontStyle: "italic" }}>RAG corpus</em>.
        </h1>
        <p className="mt-4 max-w-2xl text-ink-soft">
          Ingest the TMDB top-5,000 films. Each film's plot is embedded with Gemini text-embedding-004
          and stored in pgvector. Beats are filled in lazily as queries hit them, then cached forever.
        </p>

        {/* Stats */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ["Total films", stats?.total],
            ["With embeddings", stats?.embedded],
            ["Beats annotated", stats?.annotated],
            ["Gold-standard", stats?.gold],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-sm border border-ink/15 bg-card p-5 shadow-print">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft mb-2">
                {label}
              </div>
              <div className="font-display font-black text-4xl text-ink tabular-nums">
                {value === undefined ? "—" : value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Ingestion controls */}
        <div className="mt-12 rounded-sm border border-ink/20 bg-paper-warm p-8 shadow-print">
          <h2 className="font-display text-2xl text-ink mb-2">Ingest TMDB 5,000</h2>
          <p className="text-ink-soft text-sm mb-6">
            Runs in the background. Resumable: re-running skips films already in the corpus.
          </p>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "Test (200 films)", limit: 200 },
              { label: "Medium (1,000)", limit: 1000 },
              { label: "Full (5,000)", limit: 5000 },
            ].map(({ label, limit }) => (
              <button
                key={limit}
                disabled={queueing || !!running}
                onClick={() => ingest(limit)}
                className="inline-flex items-center gap-2 bg-ink text-paper px-5 py-3 rounded-sm font-mono text-[11px] uppercase tracking-[0.25em] hover:bg-oxblood transition-colors disabled:opacity-60 disabled:cursor-wait"
              >
                {queueing || running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {label}
              </button>
            ))}
          </div>

          {job && (
            <div className="mt-6 rounded-sm border border-ink/15 bg-paper p-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-oxblood">
                  Job · {job.status}
                </span>
                <span className="font-mono text-xs text-ink-soft tabular-nums">
                  {job.processed} / {job.total || "?"} · {job.inserted} inserted
                </span>
              </div>
              <div className="h-1.5 bg-ink/10 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-oxblood transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {job.message && (
                <p className="mt-3 text-xs text-ink-soft">{job.message}</p>
              )}
              {job.error && (
                <p className="mt-3 text-xs text-oxblood">{job.error}</p>
              )}
            </div>
          )}
        </div>

        <p className="mt-8 text-xs font-mono text-ink-soft">
          The function queues a background worker (EdgeRuntime.waitUntil) and returns instantly.
          Stats above refresh as the worker progresses.
        </p>
      </section>
    </main>
  );
};

export default Admin;
