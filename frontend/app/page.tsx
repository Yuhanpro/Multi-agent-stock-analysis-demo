"use client";

import { useState } from "react";
import { Activity, Sparkles, Users, BarChart2 } from "lucide-react";
import { StockInput } from "@/components/stock-input";
import { SnapshotCard } from "@/components/snapshot-card";
import { QuickResult } from "@/components/quick-result";
import { DebateStream } from "@/components/debate-stream";
import { LanguageSwitcher } from "@/components/language-switcher";
import { fetchSnapshot, type Market, type Snapshot } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";

type Mode = "snapshot" | "quick" | "debate";

interface Run {
  ticker: string;
  market: Market;
  mode: Mode;
  /** Bumped each Analyze click so child components re-trigger. */
  nonce: number;
}

const MODE_DEFS: { id: Mode; icon: JSX.Element; labelKey: string; hintKey: string }[] = [
  { id: "snapshot", icon: <BarChart2 className="h-4 w-4" />, labelKey: "mode.snapshot.label", hintKey: "mode.snapshot.hint" },
  { id: "quick",    icon: <Sparkles className="h-4 w-4" />,  labelKey: "mode.quick.label",    hintKey: "mode.quick.hint" },
  { id: "debate",   icon: <Users className="h-4 w-4" />,     labelKey: "mode.debate.label",   hintKey: "mode.debate.hint" },
];

export default function Page() {
  const { t, lang } = useT();
  const [mode, setMode] = useState<Mode>("snapshot");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  async function handleSubmit(ticker: string, market: Market) {
    setSnapshotLoading(true);
    setSnapshotError(null);
    setSnapshot(null);
    setRun(null);

    try {
      const s = await fetchSnapshot(ticker, market);
      setSnapshot(s);
      setRun({ ticker, market, mode, nonce: Date.now() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setSnapshotError(msg);
    } finally {
      setSnapshotLoading(false);
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-accent">
            <Activity className="h-5 w-5" />
            <span className="text-xs font-mono tracking-wide uppercase">
              {t("hero.eyebrow")}
            </span>
          </div>
          <LanguageSwitcher />
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          {t("hero.h1")}
        </h1>
        <p className="text-sm text-muted max-w-2xl">{t("hero.lead")}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MODE_DEFS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-colors",
              mode === m.id
                ? "border-accent bg-accent/10 text-fg"
                : "border-border bg-surface text-muted hover:text-fg hover:border-border/80"
            )}
          >
            <span className={cn("mt-0.5", mode === m.id ? "text-accent" : "text-muted")}>
              {m.icon}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t(m.labelKey as any)}</div>
              <div className="text-xs text-muted/80 mt-0.5">{t(m.hintKey as any)}</div>
            </div>
          </button>
        ))}
      </div>

      <StockInput onSubmit={handleSubmit} loading={snapshotLoading} />

      {snapshotError && (
        <div className="bg-bear/10 border border-bear/40 text-bear rounded-lg px-4 py-3 text-sm">
          {snapshotError}
        </div>
      )}

      {snapshot && <SnapshotCard snapshot={snapshot} />}

      {run && run.mode === "quick" && (
        <QuickResult
          key={run.nonce}
          ticker={run.ticker}
          market={run.market}
          runId={run.nonce}
          language={lang}
        />
      )}

      {run && run.mode === "debate" && (
        <DebateStream
          key={run.nonce}
          ticker={run.ticker}
          market={run.market}
          runId={run.nonce}
          language={lang}
        />
      )}

      {!snapshot && !snapshotError && !snapshotLoading && (
        <div className="text-muted text-sm border border-dashed border-border rounded-xl p-8 text-center">
          {t("empty.hint")}
        </div>
      )}

      <footer className="pt-8 text-xs text-muted/60 border-t border-border/40">
        {t("footer.note")}
      </footer>
    </main>
  );
}
