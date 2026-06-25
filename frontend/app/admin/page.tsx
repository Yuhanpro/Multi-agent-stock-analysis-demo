"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  createInvites,
  fetchAdminPaths,
  fetchAdminStats,
  fetchInvites,
  revokeInvite,
  type AdminStats,
  type InviteCode,
  type SessionPath,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";
import { LoginPrompt } from "@/components/auth-widget";

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

function Dashboard() {
  const { t } = useT();
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
    <div className="mt-6 space-y-8">
      <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-heading">
        <RefreshCw className="h-3.5 w-3.5" /> refresh
      </button>

      {/* Traffic */}
      {stats && (
        <section className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label={t("admin.views")} value={stats.total_views} sub={`${stats.today_views} ${t("admin.today")}`} />
            <StatCard label={t("admin.visitors")} value={stats.total_visitors} sub={`${stats.today_visitors} ${t("admin.today")}`} />
            <StatCard label={t("admin.users")} value={stats.total_users} />
          </div>
          {stats.top_paths.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-2 text-sm font-semibold text-heading">{t("admin.topPaths")}</div>
              <div className="space-y-1">
                {stats.top_paths.map((p) => (
                  <div key={p.path} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-body">{p.path}</span>
                    <span className="font-semibold text-heading">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Invite codes */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-heading">{t("admin.invites")}</h2>
        <InviteGen onCreated={(c) => setInvites((x) => [...c, ...x])} />
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="divide-y divide-border/60">
            {invites.length === 0 ? (
              <div className="p-4 text-sm text-muted">{t("admin.empty")}</div>
            ) : invites.map((inv) => (
              <InviteRow key={inv.code} inv={inv} onRevoke={() => setInvites((x) => x.map((i) => i.code === inv.code ? { ...i, active: false } : i))} />
            ))}
          </div>
        </div>
      </section>

      {/* Recent user paths */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-heading">{t("admin.paths")}</h2>
        <div className="space-y-2">
          {paths.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.empty")}</p>
          ) : paths.map((s) => (
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
      </section>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/70 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-heading">{value}</div>
      {sub && <div className="text-[11px] text-accent">{sub}</div>}
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
      onCreated(c);
      setNote("");
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

  function copy() {
    navigator.clipboard?.writeText(inv.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  async function revoke() {
    try { await revokeInvite(inv.code); onRevoke(); } catch {}
  }

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
