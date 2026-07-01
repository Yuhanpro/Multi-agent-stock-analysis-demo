"use client";

import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { fetchGold, type GoldData, type GoldSeries } from "@/lib/api";
import { streamSSE } from "@/lib/sse";
import { useT, type Lang } from "@/lib/i18n";
import { cn, fmtPct } from "@/lib/format";

export function GoldPanel({ lang }: { lang: Lang }) {
  const { t } = useT();
  const [data, setData] = useState<GoldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState<"domestic" | "intl">("domestic");
  const [reviewOn, setReviewOn] = useState(0);

  useEffect(() => {
    fetchGold().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mt-6 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("gold.loading")}</div>;
  if (error || !data) return <div className="mt-6 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>;

  const series = which === "domestic" ? data.domestic : data.intl;
  const chart = downsample(series.history, 160);

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
        <div className="mb-2 text-sm font-semibold text-heading">{series.name} · {t("gold.trend")}</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gold-g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d4a017" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#d4a017" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} width={52} />
              <Tooltip contentStyle={{ background: "hsl(var(--theme-chart-tooltip))", border: "1px solid hsl(var(--theme-chart-grid))", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "hsl(var(--theme-heading))" }} />
              <Area dataKey="close" name={series.unit} stroke="#d4a017" strokeWidth={2} fill="url(#gold-g)" />
            </AreaChart>
          </ResponsiveContainer>
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
  );
}

function downsample(pts: { date: string; close: number | null }[], target: number) {
  const clean = pts.filter((p) => p.close != null).map((p) => ({ date: p.date.slice(5), close: p.close }));
  if (clean.length <= target) return clean;
  const step = Math.ceil(clean.length / target);
  return clean.filter((_, i) => i % step === 0 || i === clean.length - 1);
}
