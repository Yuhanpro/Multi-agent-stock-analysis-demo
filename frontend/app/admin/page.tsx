"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis,
} from "recharts";
import { Check, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  createInvites, fetchAdminFeedback, fetchAdminPaths, fetchAdminSettings, fetchAdminStats, fetchInvites,
  revokeInvite, updateAdminSettings,
  type AdminStats, type Feedback, type InviteCode, type ModeCount, type RateLimits, type SessionPath,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";
import { LoginPrompt } from "@/components/auth-widget";

const TABS = ["overview", "traffic", "usage", "feedback", "invites", "paths"] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const { t } = useT();
  const { user, loading } = useAuth();
  return (
    <div className="admin-light min-h-screen bg-[hsl(var(--theme-bg))] text-body">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-heading">{t("admin.title")}</h1>
        {loading ? null : !user ? (
          <LoginPrompt />
        ) : !user.is_admin ? (
          <p className="mt-6 rounded-lg border border-border/70 bg-surface/40 px-5 py-8 text-center text-sm text-muted">403 · admin only</p>
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  );
}

function modeLabel(mode: string, zh: boolean): string {
  const m: Record<string, [string, string]> = {
    snapshot: ["行情快照", "Snapshot"],
    quick: ["巴菲特速评", "Buffett"],
    serenity: ["Serenity", "Serenity"],
    debate: ["多智能体辩论", "Debate"],
    diagnose: ["持仓诊断", "Diagnosis"],
    fund: ["基金", "Fund"],
  };
  const hit = m[mode];
  return hit ? (zh ? hit[0] : hit[1]) : mode;
}

function Dashboard() {
  const { t, lang } = useT();
  const zh = lang === "zh";
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [paths, setPaths] = useState<SessionPath[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [s, inv, p, fb] = await Promise.all([
        fetchAdminStats(), fetchInvites(), fetchAdminPaths(), fetchAdminFeedback(),
      ]);
      setStats(s); setInvites(inv); setPaths(p); setFeedback(fb);
    } catch {}
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  if (loading && !stats) {
    return <div className="mt-6 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("admin.loading")}</div>;
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        {TABS.map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              tab === tb ? "bg-accent text-white" : "text-muted hover:text-heading")}>
            {tb === "invites" ? t("admin.invites") : t(`admin.tab.${tb}` as never)}
          </button>
        ))}
        <button onClick={refresh} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted hover:text-heading">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      <div className="mt-5">
        {tab === "overview" && stats && <Overview stats={stats} />}
        {tab === "traffic" && stats && <Traffic stats={stats} />}
        {tab === "usage" && stats && <Usage stats={stats} zh={zh} />}
        {tab === "feedback" && <FeedbackList items={feedback} zh={zh} />}
        {tab === "invites" && (
          <Invites stats={stats} invites={invites} setInvites={setInvites} />
        )}
        {tab === "paths" && <Paths paths={paths} />}
      </div>
    </div>
  );
}

// ---------- tabs ------------------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {hint && <span className="text-[11px] text-muted/60">{hint}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{children}</div>
    </div>
  );
}

type Period = "today" | "yesterday" | "7d" | "30d" | "total";
const PERIODS: { id: Period; key: string }[] = [
  { id: "today", key: "admin.today" }, { id: "yesterday", key: "admin.yesterday" },
  { id: "7d", key: "admin.last7" }, { id: "30d", key: "admin.last30" }, { id: "total", key: "admin.total" },
];

function wsum(daily: AdminStats["daily"], field: keyof AdminStats["daily"][number], start: number, len: number): number {
  let s = 0;
  for (let i = start; i < start + len && i < daily.length; i++) s += Number(daily[i]?.[field] || 0);
  return s;
}

function periodMetrics(stats: AdminStats, period: Period) {
  const d = stats.daily;
  const F = ["views", "visitors", "analyses", "runs", "runs_signed", "runs_anon", "signups", "cost"] as const;
  if (period === "total") {
    return {
      m: { views: stats.total_views, visitors: stats.total_visitors, analyses: stats.analyses_total, runs: stats.runs_total, runs_signed: stats.runs_signed_total, runs_anon: stats.runs_anon_total, signups: stats.total_users, cost: stats.cost_total },
      delta: {} as Record<string, number | null>, hasDelta: false,
    };
  }
  const cfg: Record<string, [number, number]> = { today: [0, 1], yesterday: [1, 1], "7d": [0, 7], "30d": [0, 30] };
  const [start, len] = cfg[period];
  const m: Record<string, number> = {};
  const delta: Record<string, number | null> = {};
  for (const f of F) {
    const cur = wsum(d, f, start, len);
    const prev = wsum(d, f, start + len, len);
    m[f] = cur;
    delta[f] = prev > 0 ? (cur - prev) / prev : null;
  }
  // Visitors over multi-day windows must be TRUE distinct (not summed daily
  // uniques, which double-count multi-day visitors). Today/yesterday are already
  // single-day = exact; no reliable prev-window distinct → drop the delta.
  if (period === "7d") { m.visitors = stats.visitors_7d; delta.visitors = null; }
  else if (period === "30d") { m.visitors = stats.visitors_30d; delta.visitors = null; }
  return { m, delta, hasDelta: true };
}

function Overview({ stats }: { stats: AdminStats }) {
  const { t, lang } = useT();
  const zh = lang === "zh";
  const [period, setPeriod] = useState<Period>("today");
  const { m, delta, hasDelta } = periodMetrics(stats, period);
  const per = (a: number, b: number) => (b ? a / b : 0);
  const topT = stats.top_tickers[0];
  const money = (v: number) => `$${(v || 0).toFixed(v < 1 ? 3 : 2)}`;

  return (
    <div className="space-y-5">
      {/* period selector */}
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
        {PERIODS.map((p) => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors",
              period === p.id ? "bg-accent text-white shadow-sm" : "text-muted hover:text-heading")}>
            {t(p.key as never)}
          </button>
        ))}
      </div>

      <Section title={t("admin.sec.traffic")}>
        <Kpi label={t("admin.views")} value={m.views} delta={delta.views} />
        <Kpi label={t("admin.visitors")} value={m.visitors} delta={delta.visitors} />
        <Kpi label={t("admin.perVisitor")} value={per(m.views, m.visitors).toFixed(1)} />
        <Kpi label={t("admin.new")} value={period === "total" ? stats.total_users : stats.new_today} muted={period !== "today"} />
        <Kpi label={t("admin.returning")} value={period === "today" ? stats.returning_today : "—"} muted={period !== "today"} />
      </Section>

      <Section title={t("admin.sec.users")}>
        <Kpi label={t("admin.signups")} value={m.signups} delta={delta.signups} />
        <Kpi label={t("admin.users")} value={stats.total_users} />
        <Kpi label={t("admin.conv")} value={`${(per(m.signups, m.visitors) * 100).toFixed(1)}%`} />
        <Kpi label={t("admin.invUsed")} value={`${stats.invites_used}/${stats.invites_total}`} note={`${stats.invites_active} ${t("admin.invActive")}`} />
      </Section>

      <Section title={t("admin.sec.usage")} hint={t("admin.usageHint")}>
        <Kpi label={t("admin.analyses")} value={m.analyses} delta={delta.analyses} />
        <Kpi label={t("admin.signedRuns")} value={m.runs_signed} delta={delta.runs_signed} />
        <Kpi label={t("admin.anonRuns")} value={m.runs_anon} delta={delta.runs_anon} />
        <Kpi label={t("admin.topTicker")} value={topT ? topT.ticker : "—"} note={topT ? `${topT.count} ${t("ov.analyzed")}` : ""} />
      </Section>
      {stats.clicks_by_mode.length > 0 && <ModeBar title={t("admin.byModeAll")} items={stats.clicks_by_mode} zh={zh} />}

      <Section title={t("admin.sec.cost")} hint={t("admin.costHint")}>
        <Kpi label={t("admin.cost")} value={money(m.cost)} delta={delta.cost} deltaNeutral />
        <Kpi label={t("admin.costPerRun")} value={`$${per(m.cost, m.runs_signed + m.runs_anon).toFixed(4)}`} />
        <Kpi label={t("admin.costPerUser")} value={`$${per(stats.cost_total, stats.total_users).toFixed(3)}`} />
      </Section>

      <PeriodTable stats={stats} />
      <TrendChart stats={stats} />
      {!hasDelta && <p className="text-[11px] text-muted/60">{t("admin.totalNote")}</p>}
    </div>
  );
}

function Kpi({ label, value, delta, note, accent, muted, deltaNeutral }: {
  label: string; value: number | string; delta?: number | null; note?: string;
  accent?: boolean; muted?: boolean; deltaNeutral?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums", muted ? "text-muted" : accent ? "text-accent" : "text-heading")}>{value}</span>
        {delta != null && <Delta v={delta} neutral={deltaNeutral} />}
      </div>
      {note && <div className="mt-0.5 text-[11px] text-muted">{note}</div>}
    </div>
  );
}

function Delta({ v, neutral }: { v: number; neutral?: boolean }) {
  const up = v >= 0;
  const cls = neutral ? "bg-border/40 text-muted" : up ? "bg-bull/12 text-bull" : "bg-bear/12 text-bear";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums", cls)}>
      {up ? "▲" : "▼"} {Math.abs(v * 100).toFixed(0)}%
    </span>
  );
}

// Monochromatic blue ramp (deep→pale) from the brand palette — now on a light
// dashboard surface, so the deep blues read strongly.
const MODE_COLORS = ["#092390", "#0c2fc0", "#0e3bf1", "#3f62f3", "#5776f5", "#6f89f6", "#879df7", "#9fb1f9"];

function ModeBar({ title, items, zh }: { title: string; items: ModeCount[]; zh: boolean }) {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const max = Math.max(...sorted.map((i) => i.count), 1);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 text-sm font-semibold text-heading">{title}</div>
      <div className="space-y-2">
        {sorted.map((m, i) => (
          <div key={m.mode} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 truncate text-muted">{modeLabel(m.mode, zh)}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-bg/40">
              <div className="h-full rounded" style={{ width: `${(m.count / max) * 100}%`, background: MODE_COLORS[i % MODE_COLORS.length] }} />
            </div>
            <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-heading">{m.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PeriodTable({ stats }: { stats: AdminStats }) {
  const { t } = useT();
  const d = stats.daily; // newest first, 30 days
  const win = (n: number, key: keyof (typeof d)[number]) => d.slice(0, n).reduce((a, x) => a + (Number(x[key]) || 0), 0);
  const at = (i: number, key: keyof (typeof d)[number]) => Number(d[i]?.[key] ?? 0);
  const money = (v: number) => `$${v.toFixed(3)}`;
  const rows: { label: string; key: "views" | "visitors" | "analyses" | "runs_signed" | "runs_anon" | "signups" | "cost"; total: number; fmt?: (v: number) => string }[] = [
    { label: t("admin.views"), key: "views", total: stats.total_views },
    { label: t("admin.visitors"), key: "visitors", total: stats.total_visitors },
    { label: t("admin.analyses"), key: "analyses", total: stats.analyses_total },
    { label: t("admin.signedRuns"), key: "runs_signed", total: stats.runs_signed_total },
    { label: t("admin.anonRuns"), key: "runs_anon", total: stats.runs_anon_total },
    { label: t("admin.signups"), key: "signups", total: stats.total_users },
    { label: t("admin.cost"), key: "cost", total: stats.cost_total || 0, fmt: money },
  ];
  const cols = [t("admin.today"), t("admin.yesterday"), t("admin.last7"), t("admin.last30"), t("admin.total")];
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 text-sm font-semibold text-heading">{t("admin.period")}</div>
      <table className="w-full text-right text-xs">
        <thead>
          <tr className="text-muted">
            <th className="py-1 pr-3 text-left font-medium"></th>
            {cols.map((c) => <th key={c} className="px-2 py-1 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => {
            const f = r.fmt ?? ((v: number) => String(Math.round(v)));
            // Visitors are distinct — use true windowed counts, not summed dailies.
            const w7 = r.key === "visitors" ? stats.visitors_7d : win(7, r.key);
            const w30 = r.key === "visitors" ? stats.visitors_30d : win(30, r.key);
            return (
              <tr key={r.key} className="border-t border-border/40">
                <td className="py-1 pr-3 text-left text-muted">{r.label}</td>
                <td className="px-2 py-1 font-semibold text-heading">{f(at(0, r.key))}</td>
                <td className="px-2 py-1 text-body">{f(at(1, r.key))}</td>
                <td className="px-2 py-1 text-body">{f(w7)}</td>
                <td className="px-2 py-1 text-body">{f(w30)}</td>
                <td className="px-2 py-1 font-semibold text-accent">{f(r.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Traffic({ stats }: { stats: AdminStats }) {
  const { t } = useT();
  const hours = stats.hourly.map((h) => ({ h: `${h.hour}`, count: h.count }));
  return (
    <div className="space-y-4">
      <TrendChart stats={stats} />
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 text-sm font-semibold text-heading">{t("admin.hourly")}</div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hours} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
              <XAxis dataKey="h" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 9 }} tickLine={false} axisLine={false} interval={1} />
              <Tooltip contentStyle={tipStyle} labelStyle={{ color: "hsl(var(--theme-heading))" }} cursor={{ fill: "#0e3bf1", opacity: 0.12 }} />
              <Bar dataKey="count" fill="#0e3bf1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ListCard title={t("admin.topPaths")} rows={stats.top_paths.map((p) => ({ k: p.path, v: p.count }))} mono />
        <ListCard title={t("admin.signups")} rows={[...stats.signups_daily].reverse().map((p) => ({ k: p.date, v: p.count }))} mono />
      </div>
    </div>
  );
}

function Usage({ stats, zh }: { stats: AdminStats; zh: boolean }) {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <Chips title={t("admin.clicks")} items={stats.clicks_by_mode} zh={zh} />
      <Chips title={t("admin.byMode")} items={stats.runs_by_mode} zh={zh} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ListCard title={t("admin.topTickers")} rows={stats.top_tickers.map((p) => ({ k: `${p.ticker} · ${p.market}`, v: p.count }))} mono />
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 text-sm font-semibold text-heading">{t("admin.topUsers")}</div>
          {stats.top_users.length === 0 ? <div className="text-xs text-muted">—</div> : (
            <div className="space-y-1">
              {stats.top_users.map((u) => (
                <div key={u.email} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-body">{u.email}</span>
                  <span className="shrink-0 text-muted">{u.last_seen ? new Date(u.last_seen).toLocaleDateString() : "—"}</span>
                  <span className="w-8 shrink-0 text-right font-semibold text-heading">{u.runs}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RateLimitSettings() {
  const { t } = useT();
  const [s, setS] = useState<RateLimits | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { fetchAdminSettings().then(setS).catch(() => {}); }, []);
  if (!s) return null;
  const field = (key: keyof RateLimits, accent?: boolean) => (
    <label className="flex flex-col gap-1">
      <span className={accent ? "text-accent" : "text-muted"}>{t(`admin.rl.${key}` as never)}</span>
      <input
        value={s[key]}
        onChange={(e) => setS({ ...s, [key]: e.target.value })}
        placeholder="5/hour"
        className="w-28 rounded-md border border-border bg-input px-2 py-1 text-sm tabular-nums text-heading focus:border-accent focus:outline-none"
      />
    </label>
  );
  async function save() {
    if (!s) return;
    setSaving(true); setMsg(null);
    try { setS(await updateAdminSettings(s)); setMsg(t("admin.rl.saved")); }
    catch (e) { setMsg((e as Error).message); }
    setSaving(false);
  }
  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-heading">{t("admin.rl.title")}</div>
      <p className="mb-3 mt-0.5 text-[11px] leading-4 text-muted">{t("admin.rl.hint")}</p>
      <div className="flex flex-wrap items-end gap-4 text-xs">
        {field("limit_quick_anon")}
        {field("limit_debate_anon")}
        {field("limit_debate_user", true)}
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-50">
          {t("admin.rl.save")}
        </button>
        {msg && <span className="text-[11px] text-muted">{msg}</span>}
      </div>
      <p className="mt-2 text-[11px] text-muted/70">{t("admin.rl.note")}</p>
    </div>
  );
}

function Invites({ stats, invites, setInvites }: { stats: AdminStats | null; invites: InviteCode[]; setInvites: (f: (x: InviteCode[]) => InviteCode[]) => void }) {
  const { t } = useT();
  return (
    <div>
      <RateLimitSettings />
      {stats && (
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
          <span>{t("admin.invTotal")} <b className="text-heading">{stats.invites_total}</b></span>
          <span>{t("admin.invUsed")} <b className="text-heading">{stats.invites_used}</b></span>
          <span>{t("admin.invActive")} <b className="text-bull">{stats.invites_active}</b></span>
        </div>
      )}
      <InviteGen onCreated={(c) => setInvites((x) => [...c, ...x])} />
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="divide-y divide-border/60">
          {invites.length === 0 ? <div className="p-4 text-sm text-muted">{t("admin.empty")}</div> :
            invites.map((inv) => (
              <InviteRow key={inv.code} inv={inv} onRevoke={() => setInvites((x) => x.map((i) => i.code === inv.code ? { ...i, active: false } : i))} />
            ))}
        </div>
      </div>
    </div>
  );
}

function fbCatLabel(cat: string, zh: boolean): string {
  const m: Record<string, [string, string]> = {
    suggestion: ["建议", "Suggestion"],
    feature: ["新功能", "Feature"],
    bug: ["问题", "Bug"],
    other: ["其他", "Other"],
  };
  const hit = m[cat];
  return hit ? (zh ? hit[0] : hit[1]) : cat;
}

function FeedbackList({ items, zh }: { items: Feedback[]; zh: boolean }) {
  const { t } = useT();
  if (items.length === 0) return <p className="text-sm text-muted">{t("admin.empty")}</p>;
  return (
    <div className="space-y-2.5">
      {items.map((f) => (
        <div key={f.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={cn(
              "rounded border px-1.5 py-0.5 text-[10px]",
              f.category === "bug" ? "border-bear/50 text-bear" : "border-accent/50 text-accent"
            )}>
              {fbCatLabel(f.category, zh)}
            </span>
            <span className="font-medium text-body">{f.email || f.contact || (zh ? "匿名" : "Anonymous")}</span>
            {f.contact && f.email && <span className="text-muted/70">· {f.contact}</span>}
            <span className="ml-auto">{new Date(f.created_at).toLocaleString()}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-body">{f.content}</p>
        </div>
      ))}
    </div>
  );
}

function Paths({ paths }: { paths: SessionPath[] }) {
  const { t } = useT();
  if (paths.length === 0) return <p className="text-sm text-muted">{t("admin.empty")}</p>;
  return (
    <div className="space-y-2">
      {paths.map((s) => (
        <div key={s.anon_id + s.last_seen} className="rounded-lg border border-border bg-surface/70 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between text-muted">
            <span className="font-mono">{s.user_email || s.anon_id}</span>
            <span>{new Date(s.last_seen).toLocaleString()}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 font-mono text-body">
            {s.paths.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted/50">→</span>}
                <span className="rounded bg-bg/40 px-1.5 py-0.5">{p}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- shared bits -----------------------------------------------------

const tipStyle = { background: "hsl(var(--theme-chart-tooltip))", border: "1px solid hsl(var(--theme-chart-grid))", borderRadius: 8, fontSize: 12 };

function TrendChart({ stats }: { stats: AdminStats }) {
  const { t } = useT();
  if (stats.daily.length < 2) return null;
  const data = [...stats.daily].reverse().map((d) => ({ date: d.date.slice(5), views: d.views, visitors: d.visitors }));
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 text-sm font-semibold text-heading">{t("admin.trend")}</div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="adm-v" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0e3bf1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#0e3bf1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tipStyle} labelStyle={{ color: "hsl(var(--theme-heading))" }} />
            <Area name="views" dataKey="views" stroke="#0e3bf1" strokeWidth={2} fill="url(#adm-v)" />
            <Area name="visitors" dataKey="visitors" stroke="#6f89f6" strokeWidth={2} fill="transparent" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Chips({ title, items, zh }: { title: string; items: ModeCount[]; zh: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 text-sm font-semibold text-heading">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((m) => (
          <span key={m.mode} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg/40 px-3 py-1 text-xs">
            <span className="text-body">{modeLabel(m.mode, zh)}</span>
            <span className="font-semibold text-accent">{m.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: "bull" | "accent" }) {
  return (
    <div className="rounded-lg border border-border bg-surface/70 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums text-heading", tone === "bull" && "text-bull", tone === "accent" && "text-accent")}>{value}</div>
      {sub && <div className="text-[11px] text-accent">{sub}</div>}
    </div>
  );
}

function ListCard({ title, rows, mono }: { title: string; rows: { k: string; v: number }[]; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 text-sm font-semibold text-heading">{title}</div>
      {rows.length === 0 ? <div className="text-xs text-muted">—</div> : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.k} className="flex items-center justify-between gap-3 text-xs">
              <span className={cn("truncate text-body", mono && "font-mono")}>{r.k}</span>
              <span className="font-semibold text-heading">{r.v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InviteGen({ onCreated }: { onCreated: (c: InviteCode[]) => void }) {
  const { t } = useT();
  const [count, setCount] = useState("5");
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [busy, setBusy] = useState(false);
  async function gen() {
    setBusy(true);
    try {
      const c = await createInvites(parseInt(count) || 1, note, parseInt(maxUses) || 1);
      onCreated(c); setNote("");
    } catch {}
    setBusy(false);
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[90px_1fr_110px_auto]">
      <input type="number" value={count} onChange={(e) => setCount(e.target.value)} placeholder={t("admin.count")}
        className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin.note")}
        className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70" />
      <input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder={t("admin.maxUses")}
        className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70" />
      <button onClick={gen} disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-50">
        {t("admin.generate")}
      </button>
    </div>
  );
}

function InviteRow({ inv, onRevoke }: { inv: InviteCode; onRevoke: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const usedUp = inv.uses >= inv.max_uses;
  const status = !inv.active ? t("admin.revoked") : usedUp ? t("admin.usedUp") : t("admin.active");
  function copy() { navigator.clipboard?.writeText(inv.code); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }
  async function revoke() { try { await revokeInvite(inv.code); onRevoke(); } catch {} }
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5", (!inv.active || usedUp) && "opacity-50")}>
      <span className="font-mono text-base font-semibold tracking-wider text-heading">{inv.code}</span>
      <span className="text-xs text-muted">{inv.uses}/{inv.max_uses} {t("admin.uses")}</span>
      {inv.note && <span className="truncate text-xs text-muted">· {inv.note}</span>}
      <span className={cn("rounded border px-1.5 py-0.5 text-[10px]", inv.active && !usedUp ? "border-bull/50 text-bull" : "border-border text-muted")}>{status}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={copy} className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-heading">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        {inv.active && (
          <button onClick={revoke} className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:border-bear/40 hover:text-bear">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
