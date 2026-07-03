"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Flame, Loader2, RefreshCw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchHotspot, type Hotspot } from "@/lib/api";
import { streamSSE } from "@/lib/sse";
import { useT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/format";

const HOT = "text-[#ef4444]"; // A股红涨
const yi = (v: number | null) => (v == null ? "—" : `${(v / 1e8).toFixed(1)}亿`);
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

// 市场情绪判定(0 弱势 … 4 强势):涨停家数 + 炸板率 + 连板高度
function moodIdx(d: Hotspot): number {
  const denom = d.zt_count + d.broke_count;
  const broke = denom ? d.broke_count / denom : 0;
  if (d.zt_count >= 60 && broke < 0.35 && d.max_boards >= 4) return 4;
  if (d.zt_count >= 40 && broke < 0.45) return 3;
  if (d.zt_count >= 20) return 2;
  if (d.zt_count >= 8) return 1;
  return 0;
}
const MOODS = ["cold", "weak", "neutral", "warm", "strong"] as const;

export default function HotspotPage() {
  const { t, lang } = useT();
  const [d, setD] = useState<Hotspot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [reviewOn, setReviewOn] = useState(0);
  useEffect(() => {
    setErr(null);
    fetchHotspot().then(setD).catch((e) => setErr(e.message));
  }, [nonce]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-accent">
            <Flame className="h-4 w-4" />
            <span className="text-sm font-semibold">{t("nav.hotspot")}</span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-body">{t("hot.lead")}</p>
          <Link
            href="/overview"
            className="group flex max-w-xl items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 shadow-sm transition-colors hover:bg-accent/15"
          >
            <Flame className="h-5 w-5 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-accent">{t("hot.toOverview")}</span>
              <span className="block text-[11px] leading-4 text-muted">{t("hot.toOverviewDesc")}</span>
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <button onClick={() => setNonce((n) => n + 1)} className="mt-1 shrink-0 text-muted hover:text-heading" aria-label="refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      {!d && !err && <div className="mt-8 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("hot.loading")}</div>}
      {err && <div className="mt-6 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{err}</div>}

      {d && (
        <div className="mt-5 space-y-4">
          {/* 结论 */}
          {(() => {
            const mi = moodIdx(d);
            const tone = mi >= 3 ? HOT : mi <= 1 ? "text-bull" : "text-muted";
            const border = mi >= 3 ? "border-[#ef4444]/40" : mi <= 1 ? "border-bull/40" : "border-border";
            const denom = d.zt_count + d.broke_count;
            const rate = denom ? Math.round((d.broke_count / denom) * 100) : 0;
            const hotSectors = d.directions.slice(0, 5);
            return (
              <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-heading">{t("hot.conclusion")}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", tone, border)}>{t(`hot.mood.${MOODS[mi]}` as never)}</span>
                  <span className="ml-auto text-[11px] text-muted">{d.date} · {t("hot.updated")} {d.updated}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-body">
                  {t("hot.verdictTpl").replace("{zt}", String(d.zt_count)).replace("{boards}", String(d.max_boards)).replace("{rate}", String(rate))}
                </p>
                {hotSectors.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted">{t("hot.hotIn")}</span>
                    {hotSectors.map((x) => (
                      <span key={x.name} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs">
                        <span className="text-heading">{x.name}</span> <b className={HOT}>{x.limit_ups}</b>
                        {x.days >= 2 && <span className="ml-1 text-[10px] text-accent">{t("hot.streak").replace("{n}", String(x.days))}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* summary */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <span className="text-muted">{d.date} · {t("hot.updated")} {d.updated}</span>
            <span className="text-body"><b className={HOT}>{d.zt_count}</b> {t("hot.zt")}</span>
            <span className="text-body"><b className="text-heading">{d.broke_count}</b> {t("hot.broke")}</span>
            <span className="text-body">{t("hot.maxBoards")} <b className={HOT}>{d.max_boards}</b></span>
            <span className="flex basis-full flex-wrap gap-1.5 sm:ml-auto sm:basis-auto">
              {[...d.ladder].reverse().map((l) => (
                <span key={l.boards} className="rounded-md border border-border bg-bg/40 px-2 py-0.5 text-xs">
                  <b className={HOT}>{l.boards >= 2 ? `${l.boards}板` : "首板"}</b> <span className="text-muted">{l.count}</span>
                </span>
              ))}
            </span>
          </div>

          {/* 资金方向 */}
          <Panel title={t("hot.directions")} hint={t("hot.directionsHint")}>
            <div className="space-y-2">
              {d.directions.map((x) => {
                const max = d.directions[0]?.limit_ups || 1;
                return (
                  <div key={x.name} className="flex items-center gap-3 text-xs">
                    <span className="flex w-24 shrink-0 items-center gap-1 truncate">
                      <span className="truncate text-heading">{x.name}</span>
                      {x.days >= 2 && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">{t("hot.streak").replace("{n}", String(x.days))}</span>}
                    </span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-bg/40">
                      <div className="h-full rounded bg-[#ef4444]/70" style={{ width: `${(x.limit_ups / max) * 100}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right"><b className={HOT}>{x.limit_ups}</b> <span className="text-muted">{t("hot.zt")}</span></span>
                    <span className="hidden w-14 shrink-0 text-right text-muted sm:inline">{yi(x.seal_fund)}</span>
                    <span className="hidden min-w-0 flex-[2] truncate text-muted lg:block">{x.leaders.join("、")}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* 封板资金榜 + 放量涨幅榜 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("hot.sealRank")} hint={t("hot.sealHint")}>
              <div className="space-y-1.5">
                {d.seal_rank.map((s, i) => (
                  <div key={s.code} className="flex items-center gap-2 text-xs">
                    <span className="w-4 shrink-0 text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-heading">
                      {s.name}
                      {s.boards != null && s.boards >= 2 && <span className={cn("ml-1 rounded px-1 text-[10px]", "bg-[#ef4444]/15", HOT)}>{s.boards}板</span>}
                    </span>
                    <span className="hidden w-16 shrink-0 truncate text-muted sm:inline">{s.industry}</span>
                    <span className={cn("w-14 shrink-0 text-right font-semibold", HOT)}>{yi(s.seal_fund)}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={t("hot.movers")} hint={t("hot.moversHint")}>
              <div className="space-y-1.5">
                {d.movers.map((m, i) => (
                  <div key={m.code} className="flex items-center gap-2 text-xs">
                    <span className="w-4 shrink-0 text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-heading">{m.name}</span>
                    <span className={cn("w-12 shrink-0 text-right font-semibold", HOT)}>+{pct(m.change_pct)}</span>
                    <span className="w-14 shrink-0 text-right text-muted">{yi(m.amount)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* 量能加速榜 */}
          <Panel title={t("hot.accel")} hint={t("hot.accelHint")}>
            {d.accel.length === 0 ? (
              <div className="text-xs text-muted">{t("hot.accelBoot").replace("{n}", String(d.accel_days))}</div>
            ) : (
              <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {d.accel.map((a, i) => (
                  <div key={a.code} className="flex items-center gap-2 text-xs">
                    <span className="w-4 shrink-0 text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-heading">{a.name}</span>
                    <span className={cn("w-12 shrink-0 text-right font-semibold", (a.change_pct ?? 0) >= 0 ? HOT : "text-bull")}>
                      {(a.change_pct ?? 0) >= 0 ? "+" : ""}{pct(a.change_pct)}
                    </span>
                    <span className="w-12 shrink-0 text-right font-semibold text-accent">×{a.ratio}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* AI 复盘 */}
          <div>
            <button
              onClick={() => setReviewOn(Date.now())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/85"
            >
              <Sparkles className="h-4 w-4" /> {t("hot.review")}
            </button>
            <p className="mt-1.5 text-[11px] text-muted/60">{t("hot.reviewNote")}</p>
          </div>
          {reviewOn > 0 && <HotspotReview nonce={reviewOn} language={lang} />}

          <p className="text-[11px] leading-4 text-muted/60">⚠️ {d.note}。{t("hot.proxyNote")}</p>
        </div>
      )}
    </main>
  );
}

function HotspotReview({ nonce, language }: { nonce: number; language: Lang }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<{ abort: () => void } | null>(null);
  useEffect(() => {
    setText(""); setDone(false); setError(null);
    const ctl = streamSSE("/api/hotspot-review", { language }, {
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
        {t("hot.review")}
      </div>
      {error ? <div className="text-sm text-bear">{error}</div>
        : <div className="prose-tight max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-heading">{title}</div>
      {hint && <p className="mb-3 mt-0.5 text-[11px] leading-4 text-muted">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}
