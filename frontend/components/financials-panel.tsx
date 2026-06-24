"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2 } from "lucide-react";
import { fetchFinancials, type Financials, type FinPeriod, type Market } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Props {
  ticker: string;
  market: Market;
}

// McKinsey-inspired blue palette (deep blue + cyan/teal accents), tuned to stay
// visible on the dark graphite theme. Independent of bull/bear semantic colors.
const CHART = {
  revenue: "#1f57b8",   // McKinsey deep blue
  netIncome: "#00a9f4", // McKinsey cyan-blue
  gross: "#2251ff",     // electric blue
  net: "#00c2de",       // teal / cyan
  roe: "#7cb3ff",       // sky blue
};

function scaleInfo(currency: string | null, zh: boolean) {
  if (currency === "USD") return { div: 1e9, unit: zh ? "十亿" : "B" };
  return { div: 1e8, unit: zh ? "亿" : "×1e8" };
}

export function FinancialsPanel({ ticker, market }: Props) {
  const { t, lang } = useT();
  const zh = lang === "zh";
  const [fin, setFin] = useState<Financials | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setFin(null);
    fetchFinancials(ticker, market)
      .then((f) => { if (alive) setFin(f); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ticker, market]);

  const { div, unit } = scaleInfo(fin?.currency ?? null, zh);

  // Annual series oldest -> newest for the x-axis.
  const series = useMemo(() => {
    const rows = (fin?.annual ?? []).slice().reverse();
    return rows.map((p: FinPeriod) => {
      const gm = p.revenue && p.gross_profit != null ? (p.gross_profit / p.revenue) * 100 : null;
      const nm = p.revenue && p.net_income != null ? (p.net_income / p.revenue) * 100 : null;
      const roe = p.total_equity && p.net_income != null ? (p.net_income / p.total_equity) * 100 : null;
      return {
        period: p.period,
        revenue: p.revenue != null ? +(p.revenue / div).toFixed(2) : null,
        netIncome: p.net_income != null ? +(p.net_income / div).toFixed(2) : null,
        grossMargin: gm != null ? +gm.toFixed(1) : null,
        netMargin: nm != null ? +nm.toFixed(1) : null,
        roe: roe != null ? +roe.toFixed(1) : null,
      };
    });
  }, [fin, div]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 p-5 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {zh ? "加载财务数据…" : "Loading financials…"}
      </div>
    );
  }
  if (error || !fin || (fin.annual.length === 0 && fin.quarterly.length === 0)) {
    return null; // silently skip when no statements (don't clutter the page)
  }

  const tip = {
    background: "hsl(var(--theme-chart-tooltip))",
    border: "1px solid hsl(var(--theme-chart-grid))",
    borderRadius: 8,
    fontSize: 12,
  };
  const axis = { fill: "hsl(var(--theme-muted))", fontSize: 10 };

  const hasMargins = series.some((s) => s.grossMargin != null || s.netMargin != null || s.roe != null);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface/80 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-heading">
          {zh ? "财务趋势" : "Financial Trends"}
        </h3>
        <span className="font-mono text-[10px] text-subtle">
          {fin.currency || ""} · {unit} · {fin.source}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Revenue + net income bars */}
        <div>
          <div className="mb-1 flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: CHART.revenue }} />{zh ? "营收" : "Revenue"}</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: CHART.netIncome }} />{zh ? "净利" : "Net Income"}</span>
            <span className="ml-auto font-mono text-subtle">{unit}</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barGap={2}>
                <defs>
                  <linearGradient id="fin-rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.revenue} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={CHART.revenue} stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="fin-ni" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.netIncome} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={CHART.netIncome} stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
                <XAxis dataKey="period" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={tip} labelStyle={{ color: "hsl(var(--theme-heading))" }} cursor={{ fill: CHART.revenue, opacity: 0.08 }} />
                <Bar name={zh ? "营收" : "Revenue"} dataKey="revenue" fill="url(#fin-rev)" radius={[4, 4, 0, 0]} />
                <Bar name={zh ? "净利" : "Net Income"} dataKey="netIncome" fill="url(#fin-ni)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Margins + ROE lines */}
        {hasMargins && (
          <div>
            <div className="mb-1 flex items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CHART.gross }} />{zh ? "毛利率" : "Gross"}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CHART.net }} />{zh ? "净利率" : "Net"}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CHART.roe }} />ROE</span>
              <span className="ml-auto font-mono text-subtle">%</span>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
                  <XAxis dataKey="period" tick={axis} tickLine={false} axisLine={false} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} width={40} unit="%" />
                  <Tooltip contentStyle={tip} labelStyle={{ color: "hsl(var(--theme-heading))" }} />
                  <Line name={zh ? "毛利率" : "Gross"} dataKey="grossMargin" stroke={CHART.gross} strokeWidth={2.5} dot={{ r: 2.5, fill: CHART.gross, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
                  <Line name={zh ? "净利率" : "Net"} dataKey="netMargin" stroke={CHART.net} strokeWidth={2.5} dot={{ r: 2.5, fill: CHART.net, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
                  <Line name="ROE" dataKey="roe" stroke={CHART.roe} strokeWidth={2.5} dot={{ r: 2.5, fill: CHART.roe, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Key line-items table (annual, newest first) */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-right text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-3 text-left font-medium">{zh ? "年报" : "Annual"}</th>
              {fin.annual.map((p) => (
                <th key={p.period} className="px-2 py-1 font-mono font-medium text-heading">{p.period}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-body">
            {([
              [zh ? "营收" : "Revenue", (p: FinPeriod) => p.revenue],
              [zh ? "净利" : "Net Income", (p: FinPeriod) => p.net_income],
              [zh ? "经营现金流" : "Op. Cash Flow", (p: FinPeriod) => p.operating_cash_flow],
              [zh ? "总资产" : "Total Assets", (p: FinPeriod) => p.total_assets],
              [zh ? "股东权益" : "Equity", (p: FinPeriod) => p.total_equity],
            ] as [string, (p: FinPeriod) => number | null][]).map(([label, get]) => (
              <tr key={label} className="border-t border-border/40">
                <td className="py-1 pr-3 text-left text-muted">{label}</td>
                {fin.annual.map((p) => {
                  const v = get(p);
                  return (
                    <td key={p.period} className="px-2 py-1 font-semibold text-heading">
                      {v != null ? (v / div).toFixed(1) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
