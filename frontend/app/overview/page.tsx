"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, LineChart, Loader2, Newspaper, TrendingUp } from "lucide-react";
import { fetchMarketOverview, type Market, type MarketOverview } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtPct } from "@/lib/format";

const MARKETS: Market[] = ["CN", "US", "HK"];

type OvModule = "market" | "news";
const MODULES: { id: OvModule; icon: typeof Flame; key: string }[] = [
  { id: "market", icon: LineChart, key: "ov.mod.market" },
  { id: "news", icon: Newspaper, key: "ov.mod.news" },
];

function yi(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
}

// Color by local market convention. bull=green, bear=red.
// A股:红涨绿跌(涨→bear/红,跌→bull/绿)。美股/港股:绿涨红跌(默认)。
function tone(v: number | null, market: Market): string {
  if (v == null) return "text-muted";
  const up = v >= 0;
  if (market === "CN") return up ? "text-bear" : "text-bull";
  return up ? "text-bull" : "text-bear";
}

export default function OverviewPage() {
  const { t } = useT();
  const [market, setMarket] = useState<Market>("CN");
  const [mod, setMod] = useState<OvModule>("market");
  const [data, setData] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    fetchMarketOverview(market)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [market]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-accent">
          <Flame className="h-4 w-4" />
          <span className="text-sm font-semibold">{t("ov.title")}</span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-body">{t(`ov.lead.${market}` as never)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
            {MARKETS.map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  market === m ? "bg-accent text-white" : "text-muted hover:text-heading"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {MODULES.map((mo) => {
              const Icon = mo.icon;
              const active = mod === mo.id;
              return (
                <button
                  key={mo.id}
                  onClick={() => setMod(mo.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-accent bg-accent text-white"
                      : "border-border bg-surface text-muted hover:text-heading"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(mo.key as never)}
                </button>
              );
            })}
          </div>
        </div>
        {mod === "market" && (
          <p className="text-[11px] leading-4 text-muted/70">{market === "CN" ? t("ov.proxy") : t("ov.ushkNote")}</p>
        )}
      </header>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("ov.loading")}
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>
      ) : data ? (
        <div className="mt-6 space-y-8">
          {/* Index strip (CN) */}
          {mod === "market" && data.indices.length > 0 && (
            <section>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {data.indices.map((ix) => (
                  <div key={ix.code} className="rounded-lg border border-border bg-surface/70 px-3 py-2">
                    <div className="truncate text-[11px] text-muted">{ix.name}</div>
                    <div className="mt-0.5 text-base font-semibold tabular-nums text-heading">
                      {ix.price != null ? ix.price.toFixed(2) : "—"}
                    </div>
                    <div className={cn("text-xs font-semibold tabular-nums", tone(ix.change_pct, "CN"))}>
                      {fmtPct(ix.change_pct)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Breadth (CN): advancers / decliners / limit-up. CN convention: up=red. */}
          {mod === "market" && data.breadth && (data.breadth.advancers != null || data.breadth.limit_up != null) && (
            <section>
              <div className="flex flex-wrap gap-2">
                {data.breadth.advancers != null && (
                  <div className="rounded-lg border border-border bg-surface/70 px-4 py-2 text-center">
                    <div className="text-[11px] text-muted">{t("ov.adv")}</div>
                    <div className="text-lg font-semibold tabular-nums text-bear">{data.breadth.advancers}</div>
                  </div>
                )}
                {data.breadth.decliners != null && (
                  <div className="rounded-lg border border-border bg-surface/70 px-4 py-2 text-center">
                    <div className="text-[11px] text-muted">{t("ov.dec")}</div>
                    <div className="text-lg font-semibold tabular-nums text-bull">{data.breadth.decliners}</div>
                  </div>
                )}
                {data.breadth.flat != null && (
                  <div className="rounded-lg border border-border bg-surface/70 px-4 py-2 text-center">
                    <div className="text-[11px] text-muted">{t("ov.flat")}</div>
                    <div className="text-lg font-semibold tabular-nums text-muted">{data.breadth.flat}</div>
                  </div>
                )}
                {data.breadth.limit_up != null && (
                  <div className="rounded-lg border border-border bg-surface/70 px-4 py-2 text-center">
                    <div className="text-[11px] text-muted">{t("ov.zt")}</div>
                    <div className="text-lg font-semibold tabular-nums text-bear">{data.breadth.limit_up}</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Hot industries (CN only) */}
          {mod === "market" && data.hot_industries.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-heading">{t("ov.industries")}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.hot_industries.map((ind, i) => (
                  <div key={ind.name + i} className="rounded-lg border border-border bg-surface/70 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold text-heading">{ind.name}</span>
                      <span className={cn("font-semibold tabular-nums", tone(ind.change_pct, market))}>{fmtPct(ind.change_pct)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span>{t("ov.amount")} {yi(ind.amount)}{ind.num_companies ? ` · ${ind.num_companies}家` : ""}</span>
                      {ind.leader_name && (
                        <span className="truncate">{t("ov.leader")}: {ind.leader_name} <span className={tone(ind.leader_change, market)}>{fmtPct(ind.leader_change)}</span></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Most-active companies */}
          {mod === "market" && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-heading">{market === "CN" ? t("ov.companies") : t("ov.companiesMajor")}</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="divide-y divide-border/60">
                {data.hot_companies.map((c, i) => (
                  <Link
                    key={c.code + i}
                    href={`/?ticker=${encodeURIComponent(c.code)}&market=${c.market}&run=1`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-border/20"
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-heading">{c.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-muted">{c.code}</span>
                    </div>
                    <span className="shrink-0 text-right text-xs text-muted">{t("ov.amount")} {yi(c.amount)}</span>
                    <span className={cn("w-16 shrink-0 text-right text-sm font-semibold tabular-nums", tone(c.change_pct, c.market))}>{fmtPct(c.change_pct)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
          )}

          {/* Market news feed (news module) */}
          {mod === "news" && data.news.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-heading">
                <Newspaper className="h-4 w-4 text-accent" />
                {t("ov.news")}
              </h2>
              <div className="space-y-2">
                {data.news.map((n, i) => {
                  const tm = n.time && n.time.length >= 16 ? n.time.slice(5, 16) : n.time;
                  const body = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-heading">{n.title}</span>
                        {tm && <span className="shrink-0 font-mono text-[11px] text-muted">{tm}</span>}
                      </div>
                      {n.summary && <p className="mt-1 truncate text-xs text-muted">{n.summary}</p>}
                    </>
                  );
                  return n.url ? (
                    <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                      className="block rounded-lg border border-border bg-surface/70 p-3 transition-colors hover:border-accent/50">
                      {body}
                    </a>
                  ) : (
                    <div key={i} className="rounded-lg border border-border bg-surface/70 p-3">{body}</div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted/60">{t("ov.newsSrc")}</p>
            </section>
          )}

          {/* On-site top */}
          {mod === "market" && data.site_top.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-heading">
                <TrendingUp className="h-4 w-4 text-accent" />
                {t("ov.siteTop")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {data.site_top.map((s) => (
                  <Link
                    key={`${s.market}:${s.ticker}`}
                    href={`/?ticker=${encodeURIComponent(s.ticker)}&market=${s.market}&run=1`}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-body hover:text-heading"
                  >
                    <span className="font-mono font-semibold">{s.ticker}</span>
                    <span className="rounded border border-border px-1 text-[10px] text-muted">{s.market}</span>
                    <span className="text-accent">{s.count} {t("ov.analyzed")}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {mod === "news" && data.news.length === 0 && (
            <p className="text-sm text-muted">{t("ov.empty")}</p>
          )}
        </div>
      ) : null}
    </main>
  );
}
