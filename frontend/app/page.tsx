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
import { track } from "@/lib/track";
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
  { id: "snapshot", icon: <BarChart2 className="h-4 w-4" />, labelKey: "mode.snapshot.label", hintKey: "mode.snapshot.hint" },
  { id: "quick",    icon: <Sparkles className="h-4 w-4" />,  labelKey: "mode.quick.label",    hintKey: "mode.quick.hint" },
  { id: "serenity", icon: <Network className="h-4 w-4" />,   labelKey: "mode.serenity.label", hintKey: "mode.serenity.hint" },
  { id: "debate",   icon: <Users className="h-4 w-4" />,     labelKey: "mode.debate.label",   hintKey: "mode.debate.hint" },
];

const MODE_INTROS: Record<Mode, { en: string; zh: string }> = {
  snapshot: {
    en: "Click Snapshot to view price, fundamentals, financials, and chart data without using the LLM.",
    zh: "点击行情快照：查看价格、基本面、财务指标和 K 线，不调用 LLM。",
  },
  quick: {
    en: "Click Buffett Quick for a value-style read on valuation, business quality, and risks.",
    zh: "点击巴菲特速评：从估值、企业质量和风险角度快速判断。",
  },
  serenity: {
    en: "Click Serenity Scan to look for supply-chain pressure, bottlenecks, and industry signals.",
    zh: "点击 Serenity 扫描：寻找供应链压力、瓶颈和产业信号。",
  },
  debate: {
    en: "Click Multi-Agent Debate to let analysts, bull/bear researchers, trader, and risk committee debate the final view.",
    zh: "点击多 agent 辩论：让分析师、多空研究员、交易员和风险委员会共同形成观点。",
  },
};

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
    track(`run:${modeOverride}`);
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
          <h1 className="text-2xl font-semibold tracking-tight text-heading sm:text-4xl sm:leading-[1.1]">
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

        <section className="space-y-2.5">
          <div className="text-sm font-bold tracking-wide text-heading sm:text-base">{t("mode.pick")}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODE_DEFS.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "group flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-all",
                    active
                      ? "border-accent bg-accent/10 ring-1 ring-accent/30 shadow-[0_10px_36px_rgba(0,0,0,0.16)]"
                      : "border-border bg-surface hover:border-accent/50"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                      active ? "bg-accent text-white" : "bg-border/40 text-accent group-hover:bg-accent/15"
                    )}
                  >
                    {m.icon}
                  </span>
                  <span className={cn("text-sm font-semibold", active ? "text-accent" : "text-heading")}>{t(m.labelKey as any)}</span>
                  <span className="text-[11px] leading-4 text-muted">{t(m.hintKey as any)}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2 text-xs leading-5 text-body">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{MODE_INTROS[mode][lang]}</span>
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

        {snapshot && mode === "snapshot" && (
          <FinancialsPanel ticker={snapshot.ticker} market={snapshot.market} />
        )}

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
