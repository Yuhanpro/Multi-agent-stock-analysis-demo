"use client";

import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { Snapshot } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { companyShortName } from "@/lib/company-names";
import { cn, fmtNumber, fmtPct, fmtPrice } from "@/lib/format";

interface Props { snapshot: Snapshot }

type Stat = { label: string; value: string; present: boolean };

function stat(label: string, raw: number | null | undefined, fmt: (v: number) => string): Stat {
  return { label, value: raw == null || Number.isNaN(raw) ? "" : fmt(raw), present: raw != null && !Number.isNaN(raw) };
}

function compactGroups(groups: Array<{ title: string; stats: Stat[] }>) {
  return groups
    .map((g) => ({ ...g, stats: g.stats.filter((s) => s.present) }))
    .filter((g) => g.stats.length > 0);
}

export function SnapshotCard({ snapshot }: Props) {
  const { t, lang } = useT();
  const { fundamentals: f, ohlcv } = snapshot;
  const positive = (snapshot.change_pct ?? 0) >= 0;
  const shortName = companyShortName(snapshot.ticker, snapshot.market, f.name);
  const displayName = shortName || f.name || snapshot.ticker;

  const chartData = useMemo(() => ohlcv.map((c) => ({ date: c.date.slice(5), close: c.close })), [ohlcv]);

  const rt = snapshot.realtime;
  const groups = compactGroups([
    {
      title: lang === "zh" ? "实时" : "Realtime",
      stats: [
        stat(lang === "zh" ? "现价" : "Last", rt?.current_price, (v) => fmtPrice(v, f.currency)),
        stat(lang === "zh" ? "今开" : "Open", rt?.open, (v) => fmtPrice(v, f.currency)),
        stat(lang === "zh" ? "最高" : "High", rt?.day_high, (v) => fmtPrice(v, f.currency)),
        stat(lang === "zh" ? "最低" : "Low", rt?.day_low, (v) => fmtPrice(v, f.currency)),
        stat(lang === "zh" ? "成交额" : "Amount", rt?.amount, (v) => fmtNumber(v, 2)),
        stat(lang === "zh" ? "涨跌幅" : "Change", rt?.change_pct, fmtPct),
      ],
    },
    {
      title: lang === "zh" ? "估值" : "Valuation",
      stats: [
        stat(t("snap.marketcap"), f.market_cap, (v) => fmtNumber(v, 2)),
        stat(t("snap.pe"), f.pe, (v) => fmtNumber(v, 2)),
        stat(t("snap.pb"), f.pb, (v) => fmtNumber(v, 2)),
      ],
    },
    {
      title: lang === "zh" ? "盈利" : "Profitability",
      stats: [
        stat(t("snap.eps"), f.eps, (v) => fmtNumber(v, 2)),
        stat("ROE", f.roe, fmtPct),
        stat("ROA", f.roa, fmtPct),
      ],
    },
    {
      title: lang === "zh" ? "增长" : "Growth",
      stats: [
        stat(t("snap.revenue_yoy"), f.revenue_yoy, fmtPct),
        stat(lang === "zh" ? "净利增长" : "Net Income Growth", f.net_income_yoy, fmtPct),
      ],
    },
    {
      title: lang === "zh" ? "质量" : "Quality",
      stats: [
        stat(lang === "zh" ? "毛利率" : "Gross Margin", f.gross_margin, fmtPct),
        stat(lang === "zh" ? "净利率" : "Net Margin", f.net_margin, fmtPct),
        stat(lang === "zh" ? "负债率" : "Debt/Assets", f.debt_asset_ratio, fmtPct),
      ],
    },
  ]);

  return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold text-heading">
              {snapshot.ticker}{displayName && displayName !== snapshot.ticker ? ` · ${displayName}` : ""}
            </h2>
            <span className="text-sm text-muted font-mono">{snapshot.market}</span>
          </div>
          {f.sector && <div className="text-xs text-muted mt-0.5">{f.sector}</div>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-heading">{fmtPrice(snapshot.price, f.currency)}</div>
          <div className={cn("text-sm tabular-nums", positive ? "text-bull" : "text-bear")}>{fmtPct(snapshot.change_pct)}</div>
        </div>
      </div>

      <div className="h-48 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g-close" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={positive ? "hsl(var(--theme-bull))" : "hsl(var(--theme-bear))"} stopOpacity={0.5} />
                <stop offset="100%" stopColor={positive ? "hsl(var(--theme-bull))" : "hsl(var(--theme-bear))"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
            <Tooltip contentStyle={{ background: "hsl(var(--theme-chart-tooltip))", border: "1px solid hsl(var(--theme-chart-grid))", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "hsl(var(--theme-heading))" }} formatter={(v: number) => [fmtPrice(v, f.currency), "Close"]} />
            <Area type="monotone" dataKey="close" stroke={positive ? "hsl(var(--theme-bull))" : "hsl(var(--theme-bear))"} strokeWidth={2} fill="url(#g-close)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {groups.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-4">
          {groups.map((g) => (
            <div key={g.title} className="rounded-lg border border-border/70 bg-bg/25 p-3">
              <div className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">{g.title}</div>
              <div className="space-y-1.5">
                {g.stats.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">{s.label}</span>
                    <span className="text-sm font-medium tabular-nums text-body">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border/70 bg-bg/25 p-3 text-xs text-muted">
          {lang === "zh" ? "暂无可用估值/财务指标,仅显示价格与 K 线。" : "No valuation/fundamental fields available yet; showing price and OHLCV only."}
        </div>
      )}

      <div className="space-y-1 text-[10px] text-subtle font-mono">
        <div>{t("snap.source")}: {snapshot.source} · {ohlcv.length} {t("snap.bars")}{f.source_detail ? ` · ${f.source_detail}` : ""}</div>
        {groups.some((g) => g.title === (lang === "zh" ? "增长" : "Growth")) && (
          <div>{lang === "zh" ? "口径:A股/美股增长为同比(A股取最新报告期),港股为滚动增长;估值/盈利/质量为最新时点或最新报告期。" : "Basis: CN/US growth is YoY (CN uses the latest reporting period); HK growth is rolling. Valuation/profitability/quality are latest point-in-time or latest reporting period."}</div>
        )}
      </div>
    </div>
  );
}
