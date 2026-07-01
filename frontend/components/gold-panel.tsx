"use client";

import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { fetchGold, type GoldData, type GoldPoint, type GoldSeries } from "@/lib/api";
import { CandleChart, type Candle } from "@/components/candle-chart";
import { GoldChat } from "@/components/gold-chat";
import { streamSSE } from "@/lib/sse";
import { useT, type Lang } from "@/lib/i18n";
import { cn, fmtPct } from "@/lib/format";

type TF = "min" | "day" | "week" | "month";

export function GoldPanel({ lang }: { lang: Lang }) {
  const { t } = useT();
  const [data, setData] = useState<GoldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState<"domestic" | "intl">("domestic");
  const [tf, setTf] = useState<TF>("day");
  const [reviewOn, setReviewOn] = useState(0);

  useEffect(() => {
    fetchGold().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mt-6 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("gold.loading")}</div>;
  if (error || !data) return <div className="mt-6 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>;

  const series = which === "domestic" ? data.domestic : data.intl;
  const hasIntraday = series.intraday.length > 1;
  const tfs: TF[] = hasIntraday ? ["min", "day", "week", "month"] : ["day", "week", "month"];
  const eff: TF = tf === "min" && !hasIntraday ? "day" : tf;
  const candles: Candle[] =
    eff === "day" ? toCandles(series.history) :
    eff === "week" ? aggregate(series.history, "week") :
    eff === "month" ? aggregate(series.history, "month") : [];
  const intraday = series.intraday.filter((p) => p.price != null).map((p) => ({ label: p.time.slice(0, 5), price: p.price }));

  return (
    <div className="mt-6 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <GoldCard s={data.domestic} active={which === "domestic"} onClick={() => setWhich("domestic")} />
        <GoldCard s={data.intl} active={which === "intl"} onClick={() => setWhich("intl")} />
      </div>

      {data.premium != null && (
        <div className="rounded-lg border border-border bg-surface/70 px-4 py-2.5 text-xs">
          <span className="text-muted">{t("gold.spread")}:</span>
          <span className="ml-1.5 text-body">{t("gold.intlConv")} <b className="text-heading">{data.intl_in_cny} {t("gold.perg")}</b></span>
          <span className="ml-2 text-muted">·</span>
          <span className={cn("ml-2 font-semibold", data.premium >= 0 ? "text-bull" : "text-bear")}>
            {t("gold.domestic")}{data.premium >= 0 ? t("gold.premiumUp") : t("gold.premiumDown")} {data.premium >= 0 ? "+" : ""}{data.premium} {t("gold.perg")}
            {data.premium_pct != null && ` (${fmtPct(data.premium_pct)})`}
          </span>
          {data.usdcny != null && <span className="ml-2 text-muted/60">{t("gold.fx")} {data.usdcny}</span>}
        </div>
      )}

      {data.etf_total != null && (
        <p className="text-xs text-muted">
          {t("gold.etf")}:<b className="mx-1 text-heading">{data.etf_total.toFixed(1)} {t("gold.ton")}</b>
          {data.etf_change != null && (
            <span className={cn(data.etf_change >= 0 ? "text-bull" : "text-bear")}>
              ({data.etf_change >= 0 ? "+" : ""}{data.etf_change.toFixed(2)} {t("gold.ton")})
            </span>
          )}
          <span className="ml-1 text-muted/60">{data.etf_date}</span>
        </p>
      )}

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-heading">{series.name}</span>
          <div className="inline-flex gap-0.5 rounded-lg border border-border p-0.5">
            {tfs.map((o) => (
              <button key={o} onClick={() => setTf(o)}
                className={cn("rounded px-2 py-0.5 text-[11px] font-medium transition-colors", tf === o ? "bg-accent text-white" : "text-muted hover:text-heading")}>
                {t(`gold.tf.${o}` as never)}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          {eff === "min" ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={intraday} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gold-g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4a017" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#d4a017" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={44} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
                <Tooltip contentStyle={{ background: "hsl(var(--theme-chart-tooltip))", border: "1px solid hsl(var(--theme-chart-grid))", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "hsl(var(--theme-heading))" }} />
                <Area dataKey="price" name={series.unit} stroke="#d4a017" strokeWidth={2} fill="url(#gold-g)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <CandleChart candles={candles} unit={series.unit} />
          )}
        </div>
      </div>

      <div>
        <button
          onClick={() => setReviewOn(Date.now())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/85"
        >
          <Sparkles className="h-4 w-4" /> {t("gold.review")}
        </button>
        <p className="mt-1.5 text-[11px] text-muted/60">{t("gold.reviewNote")}</p>
      </div>

      {reviewOn > 0 && <GoldReview nonce={reviewOn} language={lang} />}
    </div>
  );
}

function GoldCard({ s, active, onClick }: { s: GoldSeries; active: boolean; onClick: () => void }) {
  const up = (s.change_pct ?? 0) >= 0;
  return (
    <button onClick={onClick} className={cn("rounded-xl border bg-surface p-4 text-left transition-colors", active ? "border-accent" : "border-border hover:border-accent/50")}>
      <div className="text-xs text-muted">{s.name}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-heading">{s.price ?? "—"}</span>
        <span className="text-xs text-muted">{s.unit}</span>
        <span className={cn("ml-auto text-sm font-semibold tabular-nums", up ? "text-bull" : "text-bear")}>{fmtPct(s.change_pct)}</span>
      </div>
    </button>
  );
}

function GoldReview({ nonce, language }: { nonce: number; language: Lang }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<{ abort: () => void } | null>(null);

  useEffect(() => {
    setText(""); setDone(false); setError(null);
    const ctl = streamSSE("/api/gold-review", { language }, {
      onEvent: (ev, d) => {
        if (ev === "token") setText((x) => x + (d?.text ?? ""));
        else if (ev === "done") setDone(true);
        else if (ev === "error") setError(d?.message ?? "error");
      },
      onError: (e) => setError(e.message),
    });
    ref.current = ctl;
    return () => ctl.abort();
  }, [nonce, language]);

  return (
    <>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          {done ? <CheckCircle2 className="h-4 w-4 text-bull" /> : error ? null : <Loader2 className="h-4 w-4 animate-spin text-accent" />}
          {t("gold.review")}
        </div>
        {error ? (
          <div className="text-sm text-bear">{error}</div>
        ) : text ? (
          <div className="prose-tight max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("gold.reviewing")}</div>
        )}
      </div>
      {done && text && !error && <GoldChat report={text} language={language} />}
    </>
  );
}

function toCandles(daily: GoldPoint[], n = 120): Candle[] {
  return daily.filter((p) => p.close != null).slice(-n).map((p) => ({
    label: p.date.slice(5),
    open: p.open ?? p.close!, high: p.high ?? p.close!, low: p.low ?? p.close!, close: p.close!,
  }));
}

function isoWeekKey(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function aggregate(daily: GoldPoint[], by: "week" | "month", n = 120): Candle[] {
  const groups: Record<string, GoldPoint[]> = {};
  const order: string[] = [];
  for (const p of daily) {
    if (p.close == null) continue;
    const key = by === "month" ? p.date.slice(0, 7) : isoWeekKey(p.date);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(p);
  }
  return order.map((k) => {
    const ps = groups[k];
    return {
      label: by === "month" ? k : ps[ps.length - 1].date.slice(5),
      open: ps[0].open ?? ps[0].close!,
      high: Math.max(...ps.map((x) => x.high ?? x.close!)),
      low: Math.min(...ps.map((x) => x.low ?? x.close!)),
      close: ps[ps.length - 1].close!,
    };
  }).slice(-n);
}
