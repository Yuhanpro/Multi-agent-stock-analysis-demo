"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchPublicReport, type Report } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ReportView } from "@/components/report-view";

export default function SharePage() {
  return (
    <Suspense fallback={null}>
      <ShareInner />
    </Suspense>
  );
}

function ShareInner() {
  const { t } = useT();
  const params = useSearchParams();
  const id = params.get("id");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError(t("reports.notFound"));
      return;
    }
    setLoading(true);
    setError(null);
    fetchPublicReport(id)
      .then(setReport)
      .catch(() => setError(t("reports.notFound")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-heading">{t("reports.sharedTitle")}</h1>
        <Link href="/" className="inline-block text-xs text-accent hover:underline">stock-web →</Link>
      </header>
      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("reports.loading")}
        </div>
      ) : error || !report ? (
        <div className="mt-6 rounded-lg border border-border/70 bg-surface/40 px-5 py-8 text-center text-sm text-muted">
          {error || t("reports.notFound")}
        </div>
      ) : (
        <div className="mt-6">
          <ReportView report={report} />
        </div>
      )}
    </main>
  );
}
