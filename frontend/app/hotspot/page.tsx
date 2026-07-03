"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Flame, Loader2, RefreshCw } from "lucide-react";
import { fetchHotspot, type Hotspot } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";

const HOT = "text-[#ef4444]"; // A股红涨
const yi = (v: number | null) => (v == null ? "—" : `${(v / 1e8).toFixed(1)}亿`);
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function HotspotPage() {
  const { t } = useT();
  const [d, setD] = useState<Hotspot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    setErr(null);
    fetchHotspot().then(setD).catch((e) => setErr(e.message));
  }, [nonce]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-accent">
            <Flame className="h-4 w-4" />
            <span className="text-sm font-semibold">{t("nav.hotspot")}</span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-body">{t("hot.lead")}</p>
        </div>
        <button onClick={() => setNonce((n) => n + 1)} className="mt-1 shrink-0 text-muted hover:text-heading" aria-label="refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      {!d && !err && <div className="mt-8 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("hot.loading")}</div>}
      {err && <div className="mt-6 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{err}</div>}

      {d && (
        <div className="mt-5 space-y-4">
          {/* summary */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <span className="text-muted">{d.date} · {t("hot.updated")} {d.updated}</span>
            <span className="text-body"><b className={HOT}>{d.zt_count}</b> {t("hot.zt")}</span>
            <span className="text-body"><b className="text-heading">{d.broke_count}</b> {t("hot.broke")}</span>
            <span className="text-body">{t("hot.maxBoards")} <b className={HOT}>{d.max_boards}</b></span>
            <span className="ml-auto flex flex-wrap gap-1.5">
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
                    <span className="w-20 shrink-0 truncate text-heading">{x.name}</span>
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

          {/* 领涨行业 */}
          <Panel title={t("hot.sectors")}>
            <div className="flex flex-wrap gap-2">
              {d.sectors.map((s) => (
                <span key={s.name} className="rounded-lg border border-border bg-bg/40 px-2.5 py-1 text-xs">
                  <span className="text-heading">{s.name}</span> <span className={HOT}>+{pct(s.change_pct)}</span>
                  {s.leaders[0] && <span className="text-muted"> · {s.leaders[0]}</span>}
                </span>
              ))}
            </div>
          </Panel>

          <p className="text-[11px] leading-4 text-muted/60">⚠️ {d.note}。{t("hot.proxyNote")}</p>
        </div>
      )}
    </main>
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
