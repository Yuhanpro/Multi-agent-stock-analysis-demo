"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, PieChart, Search } from "lucide-react";
import { fetchFund, type Fund } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { track } from "@/lib/track";
import { cn, fmtPct } from "@/lib/format";

export default function FundPage() {
  return (
    <Suspense fallback={null}>
      <FundInner />
    </Suspense>
  );
}

const RET_KEYS: [string, string, string][] = [
  ["1m", "近1月", "1M"], ["3m", "近3月", "3M"], ["6m", "近6月", "6M"],
  ["1y", "近1年", "1Y"], ["ytd", "今年来", "YTD"], ["since", "成立来", "All"],
];

function FundInner() {
  const { t, lang } = useT();
  const zh = lang === "zh";
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [fund, setFund] = useState<Fund | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(c: string) {
    const v = c.trim();
    if (!v) return;
    track("run:fund");
    setLoading(true);
    setError(null);
    setFund(null);
    try {
      setFund(await fetchFund(v));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("fund.notFound"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const c = params.get("code");
    if (c) { setCode(c); load(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navData = (() => {
    if (!fund?.nav?.length) return [];
    const step = Math.max(1, Math.ceil(fund.nav.length / 220));
    return fund.nav.filter((_, i) => i % step === 0 || i === fund.nav.length - 1)
      .map((p) => ({ date: p.date.slice(0, 7), nav: p.nav }));
  })();
  const maxPct = fund?.holdings?.reduce((a, h) => Math.max(a, h.pct ?? 0), 0) || 1;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-accent">
          <PieChart className="h-4 w-4" />
          <span className="text-sm font-semibold">{t("fund.title")}</span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-body">{t("fund.lead")}</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(code)}
            placeholder={t("fund.placeholder")}
            className="w-full max-w-xs rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
          />
          <button onClick={() => load(code)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/85">
            <Search className="h-4 w-4" /> {t("fund.search")}
          </button>
        </div>
      </header>

      <section className="mt-6 space-y-5">
        {error && <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("fund.loading")}</div>}

        {fund && (
          <>
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-xl font-semibold text-heading">{fund.name}</h2>
                <span className="font-mono text-xs text-muted">{fund.code}</span>
                {fund.type && <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{fund.type}</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                <Info label={t("fund.manager")} value={fund.manager} />
                <Info label={t("fund.scale")} value={fund.scale} />
                <Info label={t("fund.company")} value={fund.company} />
                <Info label={t("fund.inception")} value={fund.inception} />
              </div>
            </div>

            {Object.keys(fund.returns).length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {RET_KEYS.map(([k, zhL, enL]) => {
                  const v = fund.returns[k];
                  if (v == null) return null;
                  return (
                    <div key={k} className="rounded-lg border border-border bg-surface/70 px-3 py-2 text-center">
                      <div className="text-[11px] text-muted">{zh ? zhL : enL}</div>
                      <div className={cn("text-sm font-semibold tabular-nums", v >= 0 ? "text-bull" : "text-bear")}>{fmtPct(v)}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {navData.length > 1 && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 text-sm font-semibold text-heading">{t("fund.navTrend")}</div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={navData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fund-nav" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                      <YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip contentStyle={{ background: "hsl(var(--theme-chart-tooltip))", border: "1px solid hsl(var(--theme-chart-grid))", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "hsl(var(--theme-heading))" }} />
                      <Area name="NAV" dataKey="nav" stroke="#2563eb" strokeWidth={2} fill="url(#fund-nav)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {fund.holdings.length > 0 && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-heading">{t("fund.holdings")}</span>
                  {fund.holdings_quarter && <span className="text-[11px] text-muted">{fund.holdings_quarter}</span>}
                </div>
                <div className="space-y-2">
                  {fund.holdings.map((h, i) => (
                    <div key={h.ticker + i} className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{i + 1}</span>
                      <span className="w-28 shrink-0 truncate text-sm text-heading">{h.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg/50">
                        <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.min(100, ((h.pct ?? 0) / maxPct) * 100)}%` }} />
                      </div>
                      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-body">{h.pct != null ? `${h.pct.toFixed(2)}%` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(fund.benchmark || fund.strategy) && (
              <div className="rounded-xl border border-border bg-surface/60 p-4 text-xs leading-6 text-muted">
                {fund.benchmark && <div><span className="text-heading">{t("fund.benchmark")}:</span> {fund.benchmark}</div>}
                {fund.strategy && <div className="mt-1"><span className="text-heading">{t("fund.strategy")}:</span> {fund.strategy}</div>}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-2 sm:block">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-body sm:mt-0.5 sm:block">{value || "—"}</span>
    </div>
  );
}
