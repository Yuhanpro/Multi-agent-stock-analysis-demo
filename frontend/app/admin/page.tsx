"use client";

import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis,
} from "recharts";
import { Check, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  createInvites, fetchAdminPaths, fetchAdminStats, fetchInvites, revokeInvite,
  type AdminStats, type InviteCode, type ModeCount, type SessionPath,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";
import { LoginPrompt } from "@/components/auth-widget";

const TABS = ["overview", "traffic", "usage", "invites", "paths"] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const { t } = useT();
  const { user, loading } = useAuth();
  return (
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
  );
}

function modeLabel(mode: string, zh: boolean): string {
  const m: Record<string, [string, string]> = {
    snapshot: ["行情快照", "Snapshot"],
    quick: ["巴菲特速评", "Buffett"],
    serenity: ["Serenity", "Serenity"],
    debate: ["多智能体辩论", "Debate"],
    diagnose: ["持仓诊断", "Diagnosis"],
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
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [s, inv, p] = await Promise.all([fetchAdminStats(), fetchInvites(), fetchAdminPaths()]);
      setStats(s); setInvites(inv); setPaths(p);
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
        {tab === "invites" && (
          <Invites stats={stats} invites={invites} setInvites={setInvites} />
        )}
        {tab === "paths" && <Paths paths={paths} />}
      </div>
    </div>
  );
}

// ---------- tabs ------------------------------------------------------------

function Overview({ stats }: { stats: AdminStats }) {
  const { t } = useT();
  const perVisitor = stats.total_visitors ? Math.round((stats.total_views / stats.total_visitors) * 10) / 10 : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t("admin.views")} value={stats.total_views} sub={`${stats.today_views} ${t("admin.today")}`} />
        <StatCard label={t("admin.visitors")} value={stats.total_visitors} sub={`${stats.today_visitors} ${t("admin.today")}`} />
        <StatCard label={t("admin.perVisitor")} value={perVisitor} />
        <StatCard label={t("admin.users")} value={stats.total_users} />
        <StatCard label={t("admin.runs")} value={stats.runs_total} />
        <StatCard label={t("admin.cost")} value={`$${(stats.cost_total || 0).toFixed(3)}`} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={`${t("admin.new")} (${t("admin.today")})`} value={stats.new_today} tone="bull" />
        <StatCard label={`${t("admin.returning")} (${t("admin.today")})`} value={stats.returning_today} tone="accent" />
      </div>
      <TrendChart stats={stats} />
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
              <Tooltip contentStyle={tipStyle} labelStyle={{ color: "hsl(var(--theme-heading))" }} cursor={{ fill: "#2563eb", opacity: 0.08 }} />
              <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} />
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

function Invites({ stats, invites, setInvites }: { stats: AdminStats | null; invites: InviteCode[]; setInvites: (f: (x: InviteCode[]) => InviteCode[]) => void }) {
  const { t } = useT();
  return (
    <div>
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
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--theme-chart-grid))" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "hsl(var(--theme-muted))", fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tipStyle} labelStyle={{ color: "hsl(var(--theme-heading))" }} />
            <Area name="views" dataKey="views" stroke="#2563eb" strokeWidth={2} fill="url(#adm-v)" />
            <Area name="visitors" dataKey="visitors" stroke="#38bdf8" strokeWidth={2} fill="transparent" />
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
