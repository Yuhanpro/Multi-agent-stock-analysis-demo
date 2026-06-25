"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { StockInput } from "@/components/stock-input";
import { SnapshotCard } from "@/components/snapshot-card";
import { FinancialsPanel } from "@/components/financials-panel";
import { QuickResult } from "@/components/quick-result";
import { fetchSnapshot, type Market, type Snapshot } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { track } from "@/lib/track";
import { cn, fmtPct, fmtPrice } from "@/lib/format";

interface Run {
  ticker: string;
  market: Market;
  nonce: number;
  costBasis: number;
  shares?: number;
  buyDate?: string;
}

export default function DiagnosePage() {
  const { t, lang } = useT();
  const [costBasis, setCostBasis] = useState("");
  const [shares, setShares] = useState("");
  const [buyDate, setBuyDate] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(ticker: string, market: Market) {
    const cb = parseFloat(costBasis);
    if (!cb || cb <= 0) {
      setError(t("diag.needCost"));
      return;
    }
    track("run:diagnose");
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setRun(null);
    try {
      const s = await fetchSnapshot(ticker, market);
      setSnapshot(s);
      setRun({
        ticker, market, nonce: Date.now(), costBasis: cb,
        shares: parseFloat(shares) || undefined,
        buyDate: buyDate || undefined,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const cur = snapshot?.fundamentals.currency ?? undefined;
  const pl = run && snapshot?.price ? (snapshot.price - run.costBasis) / run.costBasis : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-4">
        <div className="flex items-center gap-2 text-accent">
          <Stethoscope className="h-4 w-4" />
          <span className="text-sm font-semibold">{t("diag.title")}</span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-body">{t("diag.lead")}</p>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">{t("diag.costBasis")}</span>
          <input
            type="number" step="any" inputMode="decimal"
            value={costBasis}
            onChange={(e) => setCostBasis(e.target.value)}
            placeholder="100.00"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">{t("diag.shares")}</span>
          <input
            type="number" step="any" inputMode="decimal"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="100"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">{t("diag.buyDate")}</span>
          <input
            type="date"
            value={buyDate}
            onChange={(e) => setBuyDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-body outline-none focus:border-accent/70"
          />
        </label>
      </section>

      <div className="mt-3">
        <StockInput onSubmit={handleSubmit} loading={loading} />
      </div>

      <section className="mt-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>
        )}

        {run && snapshot?.price != null && (
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t("diag.cost")} value={fmtPrice(run.costBasis, cur)} />
            <Stat label={t("diag.current")} value={fmtPrice(snapshot.price, cur)} />
            <Stat
              label={t("diag.pl")}
              value={fmtPct(pl)}
              tone={pl == null ? undefined : pl >= 0 ? "bull" : "bear"}
            />
          </div>
        )}

        {snapshot && <SnapshotCard snapshot={snapshot} />}
        {snapshot && <FinancialsPanel ticker={snapshot.ticker} market={snapshot.market} />}

        {run && (
          <QuickResult
            key={run.nonce}
            ticker={run.ticker}
            market={run.market}
            runId={run.nonce}
            language={lang}
            skill="buffett"
            costBasis={run.costBasis}
            shares={run.shares}
            buyDate={run.buyDate}
          />
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-lg border border-border bg-surface/70 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums text-heading", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>
        {value}
      </div>
    </div>
  );
}
