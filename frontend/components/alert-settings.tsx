"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader2, Send, Trash2 } from "lucide-react";
import {
  clearPushChannel, getPushChannel, saveAlert, deleteAlert, setPushChannel, testPushChannel,
  type Alert, type Market,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";

/** WeChat push-channel binding card (Server酱 / PushPlus). */
export function PushSettings() {
  const { t } = useT();
  const [provider, setProvider] = useState("serverchan");
  const [key, setKey] = useState("");
  const [bound, setBound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getPushChannel().then((p) => {
      if (p.provider) setProvider(p.provider);
      if (p.key) { setKey(p.key); setBound(true); }
    }).catch(() => {});
  }, []);

  async function save() {
    if (!key.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await setPushChannel(provider, key.trim());
      setBound(true);
      setMsg({ ok: true, text: t("alert.saved") });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "error" });
    }
    setBusy(false);
  }
  async function test() {
    setBusy(true); setMsg(null);
    try {
      await testPushChannel();
      setMsg({ ok: true, text: t("alert.testOk") });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "error" });
    }
    setBusy(false);
  }
  async function unbind() {
    setBusy(true); setMsg(null);
    try { await clearPushChannel(); setKey(""); setBound(false); } catch {}
    setBusy(false);
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        {bound ? <Bell className="h-4 w-4 text-accent" /> : <BellOff className="h-4 w-4 text-muted" />}
        <span className="text-sm font-semibold text-heading">{t("alert.pushTitle")}</span>
        {bound && <span className="rounded-full border border-bull/40 bg-bull/10 px-2 py-0.5 text-[10px] text-bull">{t("alert.bound")}</span>}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted">{t("alert.pushHint")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[130px_1fr_auto]">
        <select value={provider} onChange={(e) => setProvider(e.target.value)}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70">
          <option value="serverchan">Server酱</option>
          <option value="pushplus">PushPlus</option>
        </select>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("alert.keyPlaceholder")}
          className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent/70" />
        <div className="flex gap-2">
          <button onClick={save} disabled={busy || !key.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("alert.save")}
          </button>
          {bound && (
            <button onClick={test} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-heading disabled:opacity-40">
              <Send className="h-3.5 w-3.5" />{t("alert.test")}
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[11px] text-muted/70">
          {provider === "serverchan"
            ? <>{t("alert.register")} <a className="text-accent hover:underline" href="https://sct.ftqq.com/" target="_blank" rel="noreferrer">sct.ftqq.com</a></>
            : <>{t("alert.register")} <a className="text-accent hover:underline" href="https://www.pushplus.plus/" target="_blank" rel="noreferrer">pushplus.plus</a></>}
        </p>
        {bound && <button onClick={unbind} className="text-[11px] text-muted hover:text-bear">{t("alert.unbind")}</button>}
      </div>
      {msg && <div className={cn("mt-2 text-xs", msg.ok ? "text-bull" : "text-bear")}>{msg.text}</div>}
    </section>
  );
}

/** Inline per-stock alert threshold editor. */
export function AlertEditor({ ticker, market, alert, onChange }: {
  ticker: string; market: Market; alert?: Alert; onChange: () => void;
}) {
  const { t } = useT();
  const [up, setUp] = useState(alert?.up_pct?.toString() ?? "");
  const [down, setDown] = useState(alert?.down_pct?.toString() ?? "");
  const [above, setAbove] = useState(alert?.target_above?.toString() ?? "");
  const [below, setBelow] = useState(alert?.target_below?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const num = (s: string) => { const v = parseFloat(s); return isNaN(v) || v <= 0 ? null : v; };

  async function save() {
    const body = { ticker, market, up_pct: num(up), down_pct: num(down), target_above: num(above), target_below: num(below), enabled: true };
    if (!body.up_pct && !body.down_pct && !body.target_above && !body.target_below) {
      setErr(t("alert.needOne")); return;
    }
    setBusy(true); setErr(null);
    try { await saveAlert(body); onChange(); } catch (e) { setErr(e instanceof Error ? e.message : "error"); }
    setBusy(false);
  }
  async function remove() {
    setBusy(true);
    try { await deleteAlert(market, ticker); setUp(""); setDown(""); setAbove(""); setBelow(""); onChange(); } catch {}
    setBusy(false);
  }

  const Field = ({ label, v, set, prefix }: { label: string; v: string; set: (s: string) => void; prefix: string }) => (
    <label className="flex items-center gap-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder={prefix}
        className="w-14 bg-transparent text-right tabular-nums outline-none" />
    </label>
  );

  return (
    <div className="mt-2 rounded-lg border border-border/70 bg-bg/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Field label={t("alert.up")} v={up} set={setUp} prefix="%" />
        <Field label={t("alert.down")} v={down} set={setDown} prefix="%" />
        <Field label={t("alert.above")} v={above} set={setAbove} prefix="≥" />
        <Field label={t("alert.below")} v={below} set={setBelow} prefix="≤" />
        <button onClick={save} disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/85 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{t("alert.save")}
        </button>
        {alert && (
          <button onClick={remove} disabled={busy} className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:border-bear/40 hover:text-bear">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {err && <div className="mt-1.5 text-[11px] text-bear">{err}</div>}
      <p className="mt-1.5 text-[11px] text-muted/60">{market === "CN" ? t("alert.cnNote") : t("alert.ushkNote")}</p>
    </div>
  );
}
