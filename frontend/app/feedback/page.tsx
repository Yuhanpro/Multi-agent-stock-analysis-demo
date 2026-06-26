"use client";

import { useState } from "react";
import { MessagesSquare, Loader2, CheckCircle2, Send } from "lucide-react";
import { submitFeedback } from "@/lib/api";
import { anonId } from "@/lib/track";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/format";

const CATEGORIES = ["suggestion", "feature", "bug", "other"] as const;
type Category = (typeof CATEGORIES)[number];

export default function FeedbackPage() {
  const { t } = useT();
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>("suggestion");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({
        content: text,
        category,
        contact: contact.trim() || undefined,
        anon_id: anonId(),
        path: "/feedback",
      });
      setSent(true);
      setContent("");
      setContact("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-center gap-2 text-accent">
        <MessagesSquare className="h-5 w-5" />
        <h1 className="text-2xl font-semibold tracking-tight text-heading">{t("fb.title")}</h1>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">{t("fb.lead")}</p>

      {sent ? (
        <div className="mt-6 rounded-xl border border-bull/40 bg-bull/10 p-6 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-bull" />
          <p className="mt-2 text-sm font-medium text-heading">{t("fb.thanks")}</p>
          <button
            onClick={() => setSent(false)}
            className="mt-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-body hover:border-accent hover:text-accent"
          >
            {t("fb.again")}
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">{t("fb.category")}</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    category === c
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border bg-bg/40 text-body hover:border-accent/60"
                  )}
                >
                  {t(`fb.cat.${c}` as never)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">{t("fb.content")}</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder={t("fb.placeholder")}
              className="w-full resize-y rounded-lg border border-border bg-bg/40 px-3 py-2.5 text-sm text-body placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("fb.contact")} <span className="text-muted/60">{t("fb.optional")}</span>
            </label>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={120}
              placeholder={user?.email ? user.email : t("fb.contactHint")}
              className="w-full rounded-lg border border-border bg-bg/40 px-3 py-2.5 text-sm text-body placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-2.5 text-sm text-bear">{error}</div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted/70">{t("fb.hint")}</p>
            <button
              onClick={send}
              disabled={busy || !content.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("fb.submit")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
