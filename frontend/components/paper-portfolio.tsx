"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, TrendingUp } from "lucide-react";
import {
  fetchPaper, placePaperOrder, resetPaper, searchSymbols,
  type Market, type Portfolio, type SymbolSuggestion,
} from "@/lib/api";
import { companyShortName } from "@/lib/company-names";
import { useT } from "@/lib/i18n";
import { cn, fmtPct } from "@/lib/format";

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}
// CN convention red-up; US/HK green-up.
function tone(v: number | null | undefined, market: Market): string {
  if (v == null || v === 0) return "text-body";
  const up = v > 0;
  if (market === "CN") return up ? "text-bear" : "text-bull";
  return up ? "text-bull" : "text-bear";
}

export function PaperPortfolio() {
  const { t } = useT();
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // order form
  const [tk, setTk] = useState("");
  const [market, setMarket] = useState<Market>("CN");
  const [shares, setShares] = useState("");
  const [sugs, setSugs] = useState<SymbolSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setPf(await fetchPaper()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const q = tk.trim();
    if (!q) { setSugs([]); return; }
    const id = window.setTimeout(async () => {
      try { const r = await searchSymbols(q, "ALL", 8); setSugs(r); setOpen(r.length > 0); }
      catch { setSugs([]); }
    }, 140);
    return () => window.clearTimeout(id);
  }, [tk]);

  async function order(side: "buy" | "sell", ticker: string, mk: Market, sh: number) {
    if (!ticker || !sh || sh <= 0) return;
    setBusy(true); setError(null);
    try {
      setPf(await placePaperOrder({ ticker, market: mk, side, shares: sh }));
      if (side === "buy") { setTk(""); setShares(""); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  async function reset() {
    if (!window.confirm(t("paper.resetConfirm"))) return;
    setBusy(true);
    try { setPf(await resetPaper()); setError(null); } catch {}
    setBusy(false);
  }

  if (loading && !pf) {
    return <div className="mt-6 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("paper.loading")}</div>;
  }
  if (!pf) return <div className="mt-6 text-sm text-bear">{error}</div>;

  return (
    <section className="mt-6 space-y-4">
      {/* summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("paper.total")} value={`¥${money(pf.total)}`} />
        <Stat label={t("paper.cash")} value={`¥${money(pf.cash)}`} />
        <Stat label={t("paper.mv")} value={`¥${money(pf.market_value)}`} />
        <Stat
          label={t("paper.pnl")}
          value={`${pf.total_pnl >= 0 ? "+" : ""}¥${money(pf.total_pnl)} · ${fmtPct(pf.total_pnl_pct)}`}
          tone={tone(pf.total_pnl, "CN")}
        />
      </div>
      <p className="text-[11px] text-muted/70">{t("paper.note")}</p>

      {/* order form */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_110px_120px_auto]">
          <div className="relative">
            <input
              value={tk}
              onChange={(e) => setTk(e.target.value.toUpperCase())}
              onFocus={() => setOpen(sugs.length > 0)}
              placeholder={t("paper.tickerPlaceholder")}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
            />
            {open && sugs.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl">
                {sugs.map((s) => (
                  <button
                    key={`${s.market}:${s.ticker}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setTk(s.ticker); setMarket(s.market); setOpen(false); }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-border/35"
                  >
                    <span className="font-mono text-heading">{s.ticker} · {s.name}</span>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{s.market}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={market} onChange={(e) => setMarket(e.target.value as Market)}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70">
            <option value="CN">CN</option><option value="US">US</option><option value="HK">HK</option>
          </select>
          <input value={shares} onChange={(e) => setShares(e.target.value)} inputMode="numeric"
            placeholder={t("paper.shares")}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm tabular-nums outline-none focus:border-accent/70" />
          <button onClick={() => order("buy", tk.trim(), market, parseFloat(shares))} disabled={busy || !tk.trim() || !shares}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-40">
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("paper.buy")}
          </button>
        </div>
        {error && <div className="mt-2 text-xs text-bear">{error}</div>}
      </div>

      {/* positions */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        {pf.positions.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">{t("paper.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="px-3 py-2 text-left font-medium">{t("paper.name")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("paper.shares")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("paper.avgCost")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("paper.price")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("paper.mv")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("paper.pnl")}</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {pf.positions.map((p) => {
                const short = companyShortName(p.ticker, p.market);
                return (
                  <tr key={`${p.market}:${p.ticker}`} className="border-b border-border/40">
                    <td className="px-3 py-2 text-left">
                      <span className="font-mono text-heading">{p.ticker}</span>
                      {short && <span className="ml-1.5 text-xs text-muted">{short}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{p.shares}</td>
                    <td className="px-3 py-2 text-right">{p.avg_cost.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{p.price != null ? p.price.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 text-right">{money(p.market_value)}</td>
                    <td className={cn("px-3 py-2 text-right font-medium", tone(p.pnl, p.market))}>
                      {p.pnl != null ? `${p.pnl >= 0 ? "+" : ""}${money(p.pnl)}` : "—"}
                      {p.pnl_pct != null && <span className="ml-1 text-xs">({fmtPct(p.pnl_pct)})</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => order("sell", p.ticker, p.market, p.shares)}
                        disabled={busy}
                        className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:border-bear/40 hover:text-bear disabled:opacity-40"
                      >
                        {t("paper.sellAll")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <TrendingUp className="h-3.5 w-3.5" />{t("paper.startCash")}: ¥{money(pf.start_cash)}
        </span>
        <button onClick={reset} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:border-bear/40 hover:text-bear">
          <RotateCcw className="h-3.5 w-3.5" />{t("paper.reset")}
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/70 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("mt-0.5 text-base font-semibold tabular-nums", tone || "text-heading")}>{value}</div>
    </div>
  );
}
