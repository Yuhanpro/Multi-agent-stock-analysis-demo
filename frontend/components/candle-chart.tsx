"use client";

import { Bar, CartesianGrid, ComposedChart, Customized, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Candle { label: string; open: number; high: number; low: number; close: number; }

const UP = "#22c55e";
const DOWN = "#ef4444";

/** Candlestick chart. Candles are drawn via <Customized> using the axis scales;
 *  a transparent Bar provides the band x-scale and hover tooltip. */
export function CandleChart({ candles, unit }: { candles: Candle[]; unit: string }) {
  if (candles.length === 0) return null;
  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  const pad = (max - min) * 0.06 || 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={candles} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={44} />
        <YAxis domain={[min - pad, max + pad]} tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
        <Tooltip content={<OhlcTip unit={unit} />} cursor={{ stroke: "hsl(var(--theme-chart-grid))" }} />
        <Bar dataKey="high" fill="transparent" isAnimationActive={false} />
        <Customized component={(p: any) => <Candles chart={p} candles={candles} />} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Candles({ chart, candles }: { chart: any; candles: Candle[] }) {
  const xAxis = chart?.xAxisMap?.[Object.keys(chart.xAxisMap || {})[0]];
  const yAxis = chart?.yAxisMap?.[Object.keys(chart.yAxisMap || {})[0]];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const xScale = xAxis.scale, yScale = yAxis.scale;
  const bw = typeof xScale.bandwidth === "function" ? xScale.bandwidth() : 0;
  const step = typeof xScale.step === "function" ? xScale.step() : bw || 8;
  const w = Math.max(1, Math.min((bw || step) * 0.6, 12));
  return (
    <g>
      {candles.map((c, i) => {
        const x0 = xScale(c.label);
        if (x0 == null) return null;
        const cx = x0 + bw / 2;
        const color = c.close >= c.open ? UP : DOWN;
        const yH = yScale(c.high), yL = yScale(c.low), yO = yScale(c.open), yC = yScale(c.close);
        const top = Math.min(yO, yC), h = Math.max(1, Math.abs(yO - yC));
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            <rect x={cx - w / 2} y={top} width={w} height={h} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

function OhlcTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload as Candle;
  const up = c.close >= c.open;
  return (
    <div className="rounded-lg border px-2.5 py-1.5 text-xs tabular-nums" style={{ background: "hsl(var(--theme-chart-tooltip))", borderColor: "hsl(var(--theme-chart-grid))" }}>
      <div className="mb-0.5 text-heading">{label}</div>
      <div className="text-muted">开 {c.open} · 高 {c.high}</div>
      <div className="text-muted">低 {c.low} · 收 <span style={{ color: up ? UP : DOWN }}>{c.close}</span></div>
      <div className="text-muted/60">{unit}</div>
    </div>
  );
}
