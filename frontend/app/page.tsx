"use client";

import { useEffect, useState } from "react";
import { Activity, Sparkles, Users, BarChart2, Network } from "lucide-react";
import { StockInput } from "@/components/stock-input";
import { SnapshotCard } from "@/components/snapshot-card";
import { QuickResult } from "@/components/quick-result";
import { DebateStream } from "@/components/debate-stream";
import { LanguageSwitcher } from "@/components/language-switcher";
import { fetchSnapshot, type Market, type Snapshot } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";

type Mode = "snapshot" | "quick" | "serenity" | "debate";

interface Run {
  ticker: string;
  market: Market;
  mode: Mode;
  /** Bumped each Analyze click so child components re-trigger. */
  nonce: number;
}

const MODE_DEFS: { id: Mode; icon: JSX.Element; labelKey: string; hintKey: string }[] = [
  { id: "snapshot", icon: <BarChart2 className="h-3.5 w-3.5" />, labelKey: "mode.snapshot.label", hintKey: "mode.snapshot.hint" },
  { id: "quick",    icon: <Sparkles className="h-3.5 w-3.5" />,  labelKey: "mode.quick.label",    hintKey: "mode.quick.hint" },
  { id: "serenity", icon: <Network className="h-3.5 w-3.5" />,   labelKey: "mode.serenity.label", hintKey: "mode.serenity.hint" },
  { id: "debate",   icon: <Users className="h-3.5 w-3.5" />,     labelKey: "mode.debate.label",   hintKey: "mode.debate.hint" },
];

export default function Page() {
  const { t, lang } = useT();
  const [mode, setModeState] = useState<Mode>("snapshot");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("stock-web:mode") as Mode | null;
      if (saved && ["snapshot", "quick", "serenity", "debate"].includes(saved)) {
        setModeState(saved);
      }
    } catch {}
  }, []);

  const selectedMode = MODE_DEFS.find((m) => m.id === mode) ?? MODE_DEFS[0];

  function setMode(next: Mode) {
    setModeState(next);
    try { window.localStorage.setItem("stock-web:mode", next); } catch {}
  }

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
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-7">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-accent">
            <Activity className="h-4 w-4" />
            <span className="text-[11px] font-mono tracking-[0.18em] uppercase">
              {t("hero.eyebrow")}
            </span>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-5xl sm:leading-[1.05]">
            {t("hero.h1")}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted sm:text-base">
            {t("hero.lead")}
          </p>
        </div>

        <section className="rounded-xl border border-border bg-surface/80 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.18)]">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {MODE_DEFS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors sm:text-sm",
                  mode === m.id
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-border/40 hover:text-fg"
                )}
              >
                {m.icon}
                <span className="truncate">{t(m.labelKey as any)}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 border-t border-border/60 px-1.5 pt-3 text-xs leading-5 text-muted">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              <span className="font-medium text-fg">{t(selectedMode.labelKey as any)}</span>
              <span className="mx-1 text-muted/50">/</span>
              {t(selectedMode.hintKey as any)}
            </span>
          </div>
        </section>

        <StockInput onSubmit={handleSubmit} loading={snapshotLoading} />
      </header>

      <section className="mt-6 space-y-6">
        {snapshotError && (
          <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">
            {snapshotError}
          </div>
        )}

        {snapshot && <SnapshotCard snapshot={snapshot} />}

        {run && (run.mode === "quick" || run.mode === "serenity") && (
          <QuickResult
            key={run.nonce}
            ticker={run.ticker}
            market={run.market}
            runId={run.nonce}
            language={lang}
            skill={run.mode === "serenity" ? "serenity" : "buffett"}
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
          <div className="rounded-xl border border-border/70 bg-surface/35 px-5 py-7 text-center text-sm text-muted">
            {t("empty.hint")}
          </div>
        )}
      </section>

      <footer className="mt-10 border-t border-border/40 pt-6 text-xs text-muted/60">
        {t("footer.note")}
      </footer>
    </main>
  );
}
