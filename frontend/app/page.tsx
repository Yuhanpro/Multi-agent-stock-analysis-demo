"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart2, Network, Sparkles, Users } from "lucide-react";
import { StockInput } from "@/components/stock-input";
import { SnapshotCard } from "@/components/snapshot-card";
import { FinancialsPanel } from "@/components/financials-panel";
import { QuickResult } from "@/components/quick-result";
import { DebateStream } from "@/components/debate-stream";
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
  const [inputDefault, setInputDefault] = useState<{ ticker: string; market: Market }>({ ticker: "AAPL", market: "US" });

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticker = params.get("ticker");
    const market = (params.get("market") || "US") as Market;
    const modeParam = params.get("mode") as Mode | null;
    const runNow = params.get("run") === "1";
    const nextMode: Mode = modeParam && ["snapshot", "quick", "serenity", "debate"].includes(modeParam)
      ? modeParam
      : mode;
    if (modeParam) setMode(nextMode);
    if (ticker && (market === "US" || market === "CN" || market === "HK")) {
      setInputDefault({ ticker: ticker.toUpperCase(), market });
    }
    if (ticker && (market === "US" || market === "CN" || market === "HK") && runNow) {
      handleSubmit(ticker, market, nextMode);
    }
    // Only parse the initial URL once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(ticker: string, market: Market, modeOverride: Mode = mode) {
    setSnapshotLoading(true);
    setSnapshotError(null);
    setSnapshot(null);
    setRun(null);

    try {
      const s = await fetchSnapshot(ticker, market);
      setSnapshot(s);
      setRun({ ticker, market, mode: modeOverride, nonce: Date.now() });
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
        <div className="flex items-center gap-2 text-accent">
          <Activity className="h-4 w-4" />
          <span className="text-sm font-semibold text-accent">{t("hero.eyebrow")}</span>
        </div>

        <div className="max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-heading sm:text-5xl sm:leading-[1.05]">
            {t("hero.h1")}
          </h1>
          <ul className="max-w-2xl space-y-1 text-sm leading-6 text-body sm:text-base">
            {t("hero.lead").split("\n").map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
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
                    : "text-muted hover:bg-border/40 hover:text-heading"
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
              <span className="font-medium text-heading">{t(selectedMode.labelKey as any)}</span>
              <span className="mx-1 text-muted/50">/</span>
              {t(selectedMode.hintKey as any)}
            </span>
          </div>
        </section>

        <StockInput
          key={`${inputDefault.market}:${inputDefault.ticker}`}
          defaultTicker={inputDefault.ticker}
          defaultMarket={inputDefault.market}
          onSubmit={(ticker, market) => handleSubmit(ticker, market)}
          loading={snapshotLoading}
        />
      </header>

      <section className="mt-6 space-y-6">
        {snapshotError && (
          <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">
            {snapshotError}
          </div>
        )}

        {snapshot && <SnapshotCard snapshot={snapshot} />}

        {snapshot && <FinancialsPanel ticker={snapshot.ticker} market={snapshot.market} />}

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
