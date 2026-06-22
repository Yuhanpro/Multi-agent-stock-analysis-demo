"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { Snapshot } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtNumber, fmtPct, fmtPrice } from "@/lib/format";

interface Props {
  snapshot: Snapshot;
}

export function SnapshotCard({ snapshot }: Props) {
  const { t } = useT();
  const { fundamentals: f, ohlcv } = snapshot;
  const positive = (snapshot.change_pct ?? 0) >= 0;

  const chartData = useMemo(
    () =>
      ohlcv.map((c) => ({
        date: c.date.slice(5), // MM-DD
        close: c.close,
      })),
    [ohlcv]
  );

  const stats: Array<[string, string]> = [
    [t("snap.marketcap"),   fmtNumber(f.market_cap, 2)],
    [t("snap.pe"),          fmtNumber(f.pe, 2)],
    [t("snap.pb"),          fmtNumber(f.pb, 2)],
    [t("snap.dividend"),    fmtPct(f.dividend_yield)],
    [t("snap.eps"),         fmtNumber(f.eps, 2)],
    [t("snap.revenue_yoy"), fmtPct(f.revenue_yoy)],
  ];

  return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold text-heading">
              {f.name || snapshot.ticker}
            </h2>
            <span className="text-sm text-muted font-mono">
              {snapshot.ticker} · {snapshot.market}
            </span>
          </div>
          {f.sector && (
            <div className="text-xs text-muted mt-0.5">{f.sector}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">
            {fmtPrice(snapshot.price, f.currency)}
          </div>
          <div
            className={cn(
              "text-sm tabular-nums",
              positive ? "text-bull" : "text-bear"
            )}
          >
            {fmtPct(snapshot.change_pct)}
          </div>
        </div>
      </div>

      <div className="h-48 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g-close" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={positive ? "hsl(var(--theme-bull))" : "hsl(var(--theme-bear))"}
                  stopOpacity={0.5}
                />
                <stop
                  offset="100%"
                  stopColor={positive ? "hsl(var(--theme-bull))" : "hsl(var(--theme-bear))"}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--theme-chart-tooltip))",
                border: "1px solid hsl(var(--theme-chart-grid))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "hsl(var(--theme-heading))" }}
              formatter={(v: number) => [fmtPrice(v, f.currency), "Close"]}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={positive ? "hsl(var(--theme-bull))" : "hsl(var(--theme-bear))"}
              strokeWidth={2}
              fill="url(#g-close)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 pt-2">
        {stats.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted">{label}</div>
            <div className="text-sm font-medium tabular-nums mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-muted/60 font-mono">
        {t("snap.source")}: {snapshot.source} · {ohlcv.length} {t("snap.bars")}
      </div>
    </div>
  );
}
