"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchFund, type Fund } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtPct } from "@/lib/format";

type Col = { code: string; fund?: Fund; err?: boolean };

export function FundCompare({ codes, onRemove }: { codes: string[]; onRemove: (code: string) => void }) {
  const { t, lang } = useT();
  const zh = lang === "zh";
  const [cols, setCols] = useState<Col[]>([]);
  const [loading, setLoading] = useState(true);

  const sig = codes.join(",");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setCols(codes.map((c) => ({ code: c })));
    Promise.all(
      codes.map((c) => fetchFund(c).then((fund) => ({ code: c, fund })).catch(() => ({ code: c, err: true })))
    ).then((res) => { if (alive) { setCols(res); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // rows: [label, accessor, better-direction]. Returns + drawdown: higher is better.
  const rows: { label: string; get: (f: Fund) => number | null; pct?: boolean; better: boolean }[] = [
    { label: zh ? "最新净值" : "Latest NAV", get: (f) => f.nav?.length ? f.nav[f.nav.length - 1].nav : null, pct: false, better: false },
    { label: zh ? "近1月" : "1M", get: (f) => f.returns?.["1m"] ?? null, pct: true, better: true },
    { label: zh ? "近3月" : "3M", get: (f) => f.returns?.["3m"] ?? null, pct: true, better: true },
    { label: zh ? "近半年" : "6M", get: (f) => f.returns?.["6m"] ?? null, pct: true, better: true },
    { label: zh ? "近1年" : "1Y", get: (f) => f.returns?.["1y"] ?? null, pct: true, better: true },
    { label: zh ? "今年来" : "YTD", get: (f) => f.returns?.["ytd"] ?? null, pct: true, better: true },
    { label: zh ? "成立来" : "Since", get: (f) => f.returns?.["since"] ?? null, pct: true, better: true },
    { label: zh ? "最大回撤" : "Max DD", get: (f) => f.max_drawdown ?? null, pct: true, better: true },
  ];

  if (codes.length < 2) return null;

  function bestIdx(row: (typeof rows)[number]): number | null {
    let bi: number | null = null, bv: number | null = null;
    cols.forEach((c, i) => {
      const v = c.fund ? row.get(c.fund) : null;
      if (v == null) return;
      if (bv == null || (row.better ? v > bv : false)) { bv = v; bi = i; }
    });
    return row.better ? bi : null;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-10 bg-surface px-3 py-3 text-left text-xs font-medium text-muted">{t("cmp.metric")}</th>
            {cols.map((c) => (
              <th key={c.code} className="min-w-[120px] px-3 py-3 text-right align-top">
                <div className="flex items-start justify-end gap-1">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-heading">{c.fund?.name || c.code}</div>
                    <div className="font-mono text-[11px] font-normal text-muted">{c.code}</div>
                    {c.fund?.type && <div className="truncate text-[10px] font-normal text-muted/80">{c.fund.type}</div>}
                  </div>
                  <button onClick={() => onRemove(c.code)} className="shrink-0 text-muted/60 hover:text-bear" aria-label="remove">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const bi = bestIdx(row);
            return (
              <tr key={row.label} className="border-b border-border/40">
                <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs text-muted">{row.label}</td>
                {cols.map((c, i) => {
                  const v = c.fund ? row.get(c.fund) : null;
                  const signColor = row.pct && v != null ? (v >= 0 ? "text-bull" : "text-bear") : "";
                  return (
                    <td key={i} className={cn("px-3 py-2 text-right tabular-nums",
                      i === bi ? "font-semibold text-accent" : signColor || "text-body")}>
                      {c.err ? "—" : v == null ? (loading && !c.fund ? "·" : "—") : row.pct ? fmtPct(v) : v.toFixed(4)}
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
    </div>
  );
}
