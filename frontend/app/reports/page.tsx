"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Link2, Loader2, Share2, Trash2 } from "lucide-react";
import {
  deleteReport,
  fetchReport,
  fetchReports,
  shareReport,
  type Report,
  type ReportMeta,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";
import { LoginPrompt } from "@/components/auth-widget";
import { ReportView, decisionClass, fmtDate } from "@/components/report-view";

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsInner />
    </Suspense>
  );
}

function ReportsInner() {
  const { t } = useT();
  const { user, loading: authLoading } = useAuth();
  const params = useSearchParams();
  const id = params.get("id");

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-4">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-muted hover:text-heading">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("reports.back")}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-heading sm:text-4xl">{t("reports.title")}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted">{t("reports.lead")}</p>
      </header>

      {authLoading ? null : !user ? (
        <LoginPrompt />
      ) : id ? (
        <ReportDetail id={id} />
      ) : (
        <ReportList />
      )}
    </main>
  );
}

function ReportList() {
  const { t } = useT();
  const [items, setItems] = useState<ReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchReports());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function del(rid: string) {
    try {
      await deleteReport(rid);
      setItems((xs) => xs.filter((x) => x.id !== rid));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("reports.loading")}
      </div>
    );
  }
  if (error) {
    return <div className="mt-6 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>;
  }
  if (items.length === 0) {
    return <div className="mt-6 rounded-xl border border-border/70 bg-surface/40 px-5 py-8 text-center text-sm text-muted">{t("reports.empty")}</div>;
  }

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="divide-y divide-border/70">
        {items.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-heading">{r.title}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{r.market}</span>
                {r.decision && (
                  <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", decisionClass(r.decision))}>
                    {r.decision}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted">{fmtDate(r.created_at)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/reports?id=${encodeURIComponent(r.id)}`}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-heading"
              >
                {t("reports.view")}
              </Link>
              <button
                onClick={() => del(r.id)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:border-bear/40 hover:text-bear"
                aria-label="delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportDetail({ id }: { id: string }) {
  const { t } = useT();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchReport(id)
      .then((r) => { setReport(r); setIsPublic(r.is_public); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  async function toggleShare() {
    if (!report) return;
    try {
      const r = await shareReport(report.id, !isPublic);
      setIsPublic(r.is_public);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function copyLink() {
    if (!report) return;
    const url = `${window.location.origin}/share?id=${encodeURIComponent(report.id)}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const shareActions = report && (
    <>
      <button
        onClick={toggleShare}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs",
          isPublic ? "border-accent/60 bg-accent/10 text-accent" : "border-border bg-surface text-muted hover:text-heading"
        )}
      >
        <Share2 className="h-3.5 w-3.5" />
        {isPublic ? t("reports.unshare") : t("reports.share")}
      </button>
      {isPublic && (
        <button
          onClick={copyLink}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-heading"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          {copied ? t("reports.copied") : t("reports.copyLink")}
        </button>
      )}
    </>
  );

  return (
    <section className="mt-6">
      <Link href="/reports" className="inline-flex items-center gap-2 text-xs text-muted hover:text-heading">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("reports.detailBack")}
      </Link>
      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("reports.loading")}
        </div>
      ) : error ? (
        <div className="mt-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>
      ) : report ? (
        <div className="mt-4">
          {isPublic && <div className="mb-2 text-xs text-muted">{t("reports.publicHint")}</div>}
          <ReportView report={report} actions={shareActions} />
        </div>
      ) : null}
    </section>
  );
}
