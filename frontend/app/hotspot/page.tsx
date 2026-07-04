"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Flame, Loader2, RefreshCw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sankey, Layer, Rectangle, Tooltip as RTooltip, ResponsiveContainer } from "recharts";
import { fetchFlowDrill, fetchGlobalFlow, fetchHotspot, type FlowDrill, type FundFlow, type GlobalFlow, type Hotspot, type UsSectorFlow } from "@/lib/api";
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
  const [gf, setGf] = useState<GlobalFlow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [reviewOn, setReviewOn] = useState(0);
  const [drill, setDrill] = useState<FlowDrill | null>(null);
  useEffect(() => {
    setErr(null);
    fetchHotspot().then(setD).catch((e) => setErr(e.message));
    fetchGlobalFlow().then(setGf).catch(() => setGf(null)); // best-effort, never blocks the CN page
    fetchFlowDrill().then(setDrill).catch(() => setDrill(null));
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

          {/* 资金流向(真实净流入,同花顺) */}
          {(d.flow_industry.length > 0 || d.flow_concept.length > 0) && (
            <Panel title={t("hot.flow")} hint={t("hot.flowHint")}>
              <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
                <FlowList title={t("hot.flowIndustry")} rows={d.flow_industry} />
                <FlowList title={t("hot.flowConcept")} rows={d.flow_concept} />
              </div>
            </Panel>
          )}

          {/* 桑基下钻:今日资金流入/流出 → 行业 → 个股(真实净流入) */}
          {d.sankey_in && d.sankey_in.links.length > 0 && (
            <Panel title={t("hot.sankeyIn")} hint={t("hot.sankeyHint")}>
              <HotspotSankey data={d.sankey_in} />
            </Panel>
          )}
          {d.sankey_out && d.sankey_out.links.length > 0 && (
            <Panel title={t("hot.sankeyOut")} hint={t("hot.sankeyHintOut")}>
              <HotspotSankey data={d.sankey_out} out />
            </Panel>
          )}

          {/* 资金下钻:点击行业 → 该行业个股真实净流入 */}
          {drill && drill.industries.length > 0 && (
            <Panel title={`${t("hot.drill")} · ${drill.updated}`} hint={t("hot.drillHint")}>
              <FlowDrillView data={drill} ofLabel={t("hot.drillOf")} netLabel={t("hot.drillNet")} />
            </Panel>
          )}

          {/* 美股板块资金方向(近似) + 港股南向资金(真实) */}
          {gf && gf.us.length > 0 && (
            <Panel title={`${t("hot.us")}${gf.us_date ? ` · ${gf.us_date}` : ""}`} hint={t("hot.usHint")}>
              {gf.us_bench.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted">{t("hot.usBench")}</span>
                  {gf.us_bench.map((b) => (
                    <span key={b.symbol} className="rounded-md border border-border bg-bg/40 px-2 py-0.5 text-xs">
                      <span className="text-heading">{b.name}</span>{" "}
                      <b className={(b.change_pct ?? 0) >= 0 ? HOT : "text-bull"}>
                        {(b.change_pct ?? 0) >= 0 ? "+" : ""}{pct(b.change_pct)}
                      </b>
                    </span>
                  ))}
                </div>
              )}
              <UsFlowList rows={gf.us} volLabel={t("hot.volRatio")} />
            </Panel>
          )}
          {gf && gf.hk.length > 0 && (
            <Panel title={`${t("hot.hk")}${gf.hk_date ? ` · ${gf.hk_date}` : ""}`} hint={t("hot.hkHint")}>
              <div className="flex flex-wrap gap-3">
                {gf.hk.map((h) => (
                  <div key={h.board} className="min-w-[9rem] flex-1 rounded-lg border border-border/70 bg-bg/25 px-3 py-2.5">
                    <div className="text-[11px] text-muted">{h.board}</div>
                    <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", (h.net_buy ?? 0) >= 0 ? HOT : "text-bull")}>
                      {(h.net_buy ?? 0) >= 0 ? "+" : ""}{(h.net_buy ?? 0).toFixed(1)}亿
                    </div>
                  </div>
                ))}
                <div className="min-w-[9rem] flex-1 rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2.5">
                  <div className="text-[11px] text-muted">{t("hot.hkTotal")}</div>
                  <div className={cn("mt-0.5 text-lg font-semibold tabular-nums",
                    gf.hk.reduce((s, h) => s + (h.net_buy ?? 0), 0) >= 0 ? HOT : "text-bull")}>
                    {gf.hk.reduce((s, h) => s + (h.net_buy ?? 0), 0) >= 0 ? "+" : ""}
                    {gf.hk.reduce((s, h) => s + (h.net_buy ?? 0), 0).toFixed(1)}亿
                  </div>
                </div>
              </div>
            </Panel>
          )}

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

function SankeyNodeShape(props: any) {
  const { x, y, width, height, index, payload, containerWidth, out } = props;
  const hot = out ? "#22c55e" : "#ef4444";
  const fill = payload.kind === "root" ? "hsl(var(--theme-accent))" : payload.kind === "industry" ? hot : out ? "#86efac" : "#6f89f6";
  const isRight = x + width + 6 > containerWidth;
  return (
    <Layer key={`n${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.9} />
      <text x={isRight ? x - 6 : x + width + 6} y={y + height / 2} textAnchor={isRight ? "end" : "start"}
        dominantBaseline="middle" fontSize={11} fill="hsl(var(--theme-body))">
        {payload.name}{payload.value ? ` ${Number(payload.value).toFixed(1)}亿` : ""}
      </text>
    </Layer>
  );
}

function HotspotSankey({ data, out }: { data: { nodes: { name: string; kind: string }[]; links: { source: number; target: number; value: number }[] }; out?: boolean }) {
  const leaves = data.nodes.filter((n) => n.kind === "stock").length || 6;
  const height = Math.max(320, leaves * 26 + 24);
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 540 }}>
        <ResponsiveContainer width="100%" height={height}>
          <Sankey data={data} node={<SankeyNodeShape out={out} />} nodePadding={16} nodeWidth={10}
            link={{ stroke: out ? "#22c55e" : "#ef4444", strokeOpacity: 0.18 }} margin={{ top: 10, bottom: 10, left: 6, right: 76 }}>
            <RTooltip contentStyle={{ background: "hsl(var(--theme-chart-tooltip))", border: "1px solid hsl(var(--theme-chart-grid))", borderRadius: 8, fontSize: 12 }} />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FlowList({ title, rows }: { title: string; rows: FundFlow[] }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.net ?? 0)), 1);
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-muted">{title}</div>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const pos = (r.net ?? 0) >= 0;
          return (
            <div key={r.name} className="flex items-center gap-2 text-xs">
              <span className="w-4 shrink-0 text-muted">{i + 1}</span>
              <span className="w-24 shrink-0 truncate text-heading" title={r.name}>{r.name}</span>
              <div className="relative h-4 flex-1 overflow-hidden rounded bg-bg/40">
                <div className={cn("h-full rounded", pos ? "bg-[#ef4444]/70" : "bg-bull/60")} style={{ width: `${(Math.abs(r.net ?? 0) / max) * 100}%` }} />
              </div>
              <span className={cn("w-16 shrink-0 text-right font-semibold tabular-nums", pos ? HOT : "text-bull")}>
                {pos ? "+" : ""}{(r.net ?? 0).toFixed(1)}亿
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlowDrillView({ data, ofLabel, netLabel }: { data: FlowDrill; ofLabel: string; netLabel: string }) {
  const [sel, setSel] = useState(data.industries[0]?.name ?? "");
  const cur = data.industries.find((i) => i.name === sel) ?? data.industries[0];
  const maxInd = Math.max(...data.industries.map((i) => Math.abs(i.net)), 0.01);
  const maxStk = Math.max(...(cur?.stocks.map((s) => Math.abs(s.net ?? 0)) ?? []), 0.01);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* 行业列表(可点击) */}
      <div className="max-h-80 space-y-0.5 overflow-y-auto pr-1">
        {data.industries.map((i) => {
          const pos = i.net >= 0;
          const active = i.name === cur?.name;
          return (
            <button
              key={i.name}
              onClick={() => setSel(i.name)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                active ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-border/30"
              )}
            >
              <span className={cn("w-20 shrink-0 truncate", active ? "font-semibold text-heading" : "text-heading")}>{i.name}</span>
              <div className="relative h-3 flex-1 overflow-hidden rounded bg-bg/40">
                <div className={cn("h-full rounded", pos ? "bg-[#ef4444]/70" : "bg-bull/60")} style={{ width: `${(Math.abs(i.net) / maxInd) * 100}%` }} />
              </div>
              <span className={cn("w-14 shrink-0 text-right font-semibold tabular-nums", pos ? HOT : "text-bull")}>
                {pos ? "+" : ""}{i.net.toFixed(1)}亿
              </span>
            </button>
          );
        })}
      </div>
      {/* 选中行业的个股明细 */}
      {cur && (
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-sm font-semibold text-heading">{cur.name}</span>
            <span className="text-muted">{netLabel} <b className={cn("tabular-nums", cur.net >= 0 ? HOT : "text-bull")}>{cur.net >= 0 ? "+" : ""}{cur.net.toFixed(1)}亿</b></span>
            <span className="text-muted">{cur.count} {ofLabel}</span>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {cur.stocks.map((s) => {
              const pos = (s.net ?? 0) >= 0;
              return (
                <div key={s.code} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 truncate text-heading" title={s.code}>{s.name}</span>
                  <span className="hidden w-12 shrink-0 font-mono text-[10px] text-muted sm:inline">{s.code}</span>
                  <span className={cn("w-12 shrink-0 text-right tabular-nums", (s.change_pct ?? 0) >= 0 ? HOT : "text-bull")}>
                    {(s.change_pct ?? 0) >= 0 ? "+" : ""}{pct(s.change_pct)}
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded bg-bg/40">
                    <div className={cn("h-full rounded", pos ? "bg-[#ef4444]/70" : "bg-bull/60")} style={{ width: `${(Math.abs(s.net ?? 0) / maxStk) * 100}%` }} />
                  </div>
                  <span className={cn("w-14 shrink-0 text-right font-semibold tabular-nums", pos ? HOT : "text-bull")}>
                    {pos ? "+" : ""}{(s.net ?? 0).toFixed(2)}亿
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function UsFlowList({ rows, volLabel }: { rows: UsSectorFlow[]; volLabel: string }) {
  const max = Math.max(...rows.map((r) => r.amount ?? 0), 1);
  const usdYi = (v: number | null) => (v == null ? "—" : `${(v / 1e8).toFixed(0)}亿$`);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const pos = (r.change_pct ?? 0) >= 0;
        return (
          <div key={r.symbol} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 truncate text-heading" title={`${r.name} ${r.symbol}`}>{r.name}</span>
            <span className="hidden w-10 shrink-0 font-mono text-[10px] text-muted sm:inline">{r.symbol}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-bg/40">
              <div className={cn("h-full rounded", pos ? "bg-[#ef4444]/70" : "bg-bull/60")} style={{ width: `${((r.amount ?? 0) / max) * 100}%` }} />
            </div>
            <span className={cn("w-12 shrink-0 text-right font-semibold tabular-nums", pos ? HOT : "text-bull")}>
              {pos ? "+" : ""}{pct(r.change_pct)}
            </span>
            <span className="w-14 shrink-0 text-right text-muted tabular-nums">{usdYi(r.amount)}</span>
            {r.vol_ratio != null && r.vol_ratio >= 1.3 ? (
              <span className="w-14 shrink-0 text-right font-semibold text-accent">{volLabel}×{r.vol_ratio.toFixed(1)}</span>
            ) : (
              <span className="hidden w-14 shrink-0 sm:inline" />
            )}
          </div>
        );
      })}
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
