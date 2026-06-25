"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, Loader2, TrendingUp } from "lucide-react";
import { fetchMarketOverview, type Market, type MarketOverview } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtPct } from "@/lib/format";

const MARKETS: Market[] = ["CN", "US", "HK"];

function yi(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
}

function tone(v: number | null): string {
  if (v == null) return "text-muted";
  return v >= 0 ? "text-bull" : "text-bear";
}

export default function OverviewPage() {
  const { t } = useT();
  const [market, setMarket] = useState<Market>("CN");
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
        <p className="max-w-2xl text-sm leading-6 text-body">{t("ov.lead")}</p>
        <p className="text-[11px] leading-4 text-muted/70">{market === "CN" ? t("ov.proxy") : t("ov.ushkNote")}</p>
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
          {/* Hot industries (CN only) */}
          {data.hot_industries.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-heading">{t("ov.industries")}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.hot_industries.map((ind, i) => (
                  <div key={ind.name + i} className="rounded-lg border border-border bg-surface/70 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold text-heading">{ind.name}</span>
                      <span className={cn("font-semibold tabular-nums", tone(ind.change_pct))}>{fmtPct(ind.change_pct)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span>{t("ov.amount")} {yi(ind.amount)}{ind.num_companies ? ` · ${ind.num_companies}家` : ""}</span>
                      {ind.leader_name && (
                        <span className="truncate">{t("ov.leader")}: {ind.leader_name} <span className={tone(ind.leader_change)}>{fmtPct(ind.leader_change)}</span></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Most-active companies */}
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
                    <span className={cn("w-16 shrink-0 text-right text-sm font-semibold tabular-nums", tone(c.change_pct))}>{fmtPct(c.change_pct)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* On-site top */}
          {data.site_top.length > 0 && (
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
        </div>
      ) : null}
    </main>
  );
}
