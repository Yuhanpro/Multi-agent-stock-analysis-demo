"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { LogOut, User as UserIcon, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/** Shared email/password form used by the modal and the inline prompt. */
export function AuthForm({ onDone }: { onDone?: () => void }) {
  const { t } = useT();
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (isRegister) await register(email.trim(), password, invite.trim() || undefined);
      else await login(email.trim(), password);
      onDone?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-base font-semibold text-heading">
        {isRegister ? t("auth.title.register") : t("auth.title.login")}
      </div>
      <input
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("auth.email")}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
      />
      <input
        type="password"
        required
        minLength={8}
        autoComplete={isRegister ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("auth.password")}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
      />
      {isRegister && (
        <input
          type="text"
          value={invite}
          onChange={(e) => setInvite(e.target.value.toUpperCase())}
          placeholder={t("auth.invite")}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm uppercase outline-none focus:border-accent/70"
        />
      )}
      {err && <div className="rounded-lg border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">{err}</div>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-50"
      >
        {busy ? t("auth.submitting") : isRegister ? t("auth.submit.register") : t("auth.submit.login")}
      </button>
      <button
        type="button"
        onClick={() => { setErr(null); setIsRegister((v) => !v); }}
        className="w-full text-center text-xs text-muted hover:text-heading"
      >
        {isRegister ? t("auth.toggle.toLogin") : t("auth.toggle.toRegister")}
      </button>
      <p className="text-[11px] leading-4 text-muted/70">{t("auth.demoWarn")}</p>
    </form>
  );
}

function AuthModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} className="text-muted hover:text-heading" aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <AuthForm onDone={onClose} />
      </div>
    </div>
  );
}

/** Inline card for whole-page gating (watchlist / reports when signed out). */
export function LoginPrompt() {
  const { t } = useT();
  return (
    <div className="mx-auto mt-6 max-w-sm rounded-xl border border-border bg-surface p-5">
      <p className="mb-3 text-sm text-muted">{t("auth.needLogin")}</p>
      <AuthForm />
    </div>
  );
}

/** Header widget: account chip + sign out, or a sign-in button. */
export function AuthWidget({ showReportsLink = true }: { showReportsLink?: boolean } = {}) {
  const { t } = useT();
  const { user, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return null;

  if (user) {
    // Account dropdown: icon-only trigger on phones, icon + email on desktop.
    return (
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted hover:text-heading"
        >
          <UserIcon className="h-3.5 w-3.5" />
          <span className="hidden max-w-[160px] truncate sm:inline">{user.email}</span>
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-2xl">
              <div className="truncate px-3 py-2 text-xs text-muted/80">{user.email}</div>
              {showReportsLink && (
                <Link
                  href="/reports"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded px-3 py-2 text-xs text-muted hover:bg-border/40 hover:text-heading"
                >
                  {t("nav.reports")}
                </Link>
              )}
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-muted hover:bg-border/40 hover:text-heading"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t("nav.logout")}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-heading"
      >
        {t("nav.login")}
      </button>
      {open && <AuthModal onClose={() => setOpen(false)} />}
    </>
  );
}
