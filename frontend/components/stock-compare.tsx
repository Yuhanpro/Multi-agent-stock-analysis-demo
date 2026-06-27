"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchSnapshot, type Market, type Snapshot, type WatchlistItem } from "@/lib/api";
import { companyShortName } from "@/lib/company-names";
import { useT } from "@/lib/i18n";
import { cn, fmtPct } from "@/lib/format";

type Col = { ticker: string; market: Market; label: string; snap?: Snapshot; err?: boolean };

function compactMoney(v: number | null | undefined, cur?: string | null): string {
  if (v == null) return "—";
  const suffix = cur && cur !== "CNY" ? ` ${cur}` : "";
  if (Math.abs(v) >= 1e12) return `${(v / 1e8).toFixed(0)}亿${suffix}`;
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}亿${suffix}`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}万${suffix}`;
  return `${v.toFixed(0)}${suffix}`;
}

// row config: how to read + format each metric, and which direction is "better".
type RowDir = "high" | "low" | null;
const ROWS: { key: string; get: (s: Snapshot) => number | null; fmt: (v: number, s: Snapshot) => string; better: RowDir; sign?: boolean }[] = [
  { key: "cmp.price", get: (s) => s.price, fmt: (v, s) => `${v.toFixed(2)}${s.fundamentals.currency && s.fundamentals.currency !== "CNY" ? " " + s.fundamentals.currency : ""}`, better: null },
  { key: "cmp.change", get: (s) => s.change_pct, fmt: (v) => fmtPct(v), better: null, sign: true },
  { key: "cmp.mktcap", get: (s) => s.fundamentals.market_cap, fmt: (v, s) => compactMoney(v, s.fundamentals.currency), better: null },
  { key: "cmp.pe", get: (s) => s.fundamentals.pe, fmt: (v) => v.toFixed(1), better: "low" },
  { key: "cmp.pb", get: (s) => s.fundamentals.pb, fmt: (v) => v.toFixed(2), better: "low" },
  { key: "cmp.divy", get: (s) => s.fundamentals.dividend_yield, fmt: (v) => fmtPct(v), better: "high" },
  { key: "cmp.roe", get: (s) => s.fundamentals.roe, fmt: (v) => fmtPct(v), better: "high" },
  { key: "cmp.gross", get: (s) => s.fundamentals.gross_margin, fmt: (v) => fmtPct(v), better: "high" },
  { key: "cmp.net", get: (s) => s.fundamentals.net_margin, fmt: (v) => fmtPct(v), better: "high" },
  { key: "cmp.revyoy", get: (s) => s.fundamentals.revenue_yoy, fmt: (v) => fmtPct(v), better: "high", sign: true },
  { key: "cmp.niyoy", get: (s) => s.fundamentals.net_income_yoy, fmt: (v) => fmtPct(v), better: "high", sign: true },
  { key: "cmp.debt", get: (s) => s.fundamentals.debt_asset_ratio, fmt: (v) => fmtPct(v), better: "low" },
  { key: "cmp.eps", get: (s) => s.fundamentals.eps, fmt: (v) => v.toFixed(2), better: null },
  { key: "cmp.rev", get: (s) => s.fundamentals.revenue, fmt: (v, s) => compactMoney(v, s.fundamentals.currency), better: null },
];

export function StockCompare({ items }: { items: WatchlistItem[] }) {
  const { t } = useT();
  const [cols, setCols] = useState<Col[]>([]);
  const [loading, setLoading] = useState(true);

  // Limit columns for readability.
  const picks = items.slice(0, 8);
  const sig = picks.map((i) => `${i.market}:${i.ticker}`).join(",");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const base: Col[] = picks.map((i) => ({
      ticker: i.ticker, market: i.market,
      label: companyShortName(i.ticker, i.market, i.note) || i.ticker,
    }));
    setCols(base);
    Promise.all(
      base.map((c) =>
        fetchSnapshot(c.ticker, c.market).then((snap) => ({ ...c, snap })).catch(() => ({ ...c, err: true }))
      )
    ).then((res) => {
      if (alive) { setCols(res); setLoading(false); }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (picks.length === 0) {
    return <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">{t("cmp.empty")}</div>;
  }

  // best value per row (for highlightable directions)
  function bestIdx(row: (typeof ROWS)[number]): number | null {
    if (!row.better) return null;
    let bi: number | null = null, bv: number | null = null;
    cols.forEach((c, i) => {
      const v = c.snap ? row.get(c.snap) : null;
      if (v == null) return;
      if (bv == null || (row.better === "high" ? v > bv : v < bv)) { bv = v; bi = i; }
    });
    return bi;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-10 bg-surface px-3 py-3 text-left text-xs font-medium text-muted">{t("cmp.metric")}</th>
            {cols.map((c) => (
              <th key={`${c.market}:${c.ticker}`} className="min-w-[110px] px-3 py-3 text-right">
                <div className="font-mono text-sm font-semibold text-heading">{c.ticker}</div>
                <div className="truncate text-[11px] font-normal text-muted">{c.label}</div>
                <span className="mt-0.5 inline-block rounded border border-border px-1 text-[9px] text-muted">{c.market}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const bi = bestIdx(row);
            return (
              <tr key={row.key} className="border-b border-border/40">
                <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs text-muted">{t(row.key as never)}</td>
                {cols.map((c, i) => {
                  const v = c.snap ? row.get(c.snap) : null;
                  const signColor = row.sign && v != null
                    ? (c.market === "CN" ? (v >= 0 ? "text-bear" : "text-bull") : (v >= 0 ? "text-bull" : "text-bear"))
                    : "";
                  return (
                    <td key={i} className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      i === bi ? "font-semibold text-accent" : signColor || "text-body"
                    )}>
                      {c.err ? "—" : v == null || c.snap == null ? (loading && !c.snap ? "·" : "—") : row.fmt(v, c.snap!)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading && (
        <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />{t("cmp.loading")}
        </div>
      )}
      {items.length > 8 && (
        <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted/70">{t("cmp.cap")}</div>
      )}
    </div>
  );
}
