"use client";

import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download } from "lucide-react";
import { toPng } from "html-to-image";
import type { Report } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";

export function decisionClass(d: string | null): string {
  if (d === "BUY") return "border-bull/50 bg-bull/10 text-bull";
  if (d === "SELL") return "border-bear/50 bg-bear/10 text-bear";
  return "border-border text-muted";
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ReportView({ report, actions }: { report: Report; actions?: ReactNode }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  async function exportPng() {
    if (!ref.current) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "#0b0e14";
      const dataUrl = await toPng(ref.current, { pixelRatio: 2, backgroundColor: bg });
      const a = document.createElement("a");
      a.download = `${report.ticker}-${report.mode}-${report.created_at.slice(0, 10)}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) {
      console.error("export failed", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions}
        <button
          onClick={exportPng}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-heading disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {busy ? t("reports.exporting") : t("reports.export")}
        </button>
      </div>

      <article ref={ref} className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
          <span className="font-mono text-base font-semibold text-heading">{report.title}</span>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{report.market}</span>
          {report.decision && (
            <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", decisionClass(report.decision))}>
              {report.decision}
            </span>
          )}
          <span className="ml-auto text-xs text-muted">{fmtDate(report.created_at)}</span>
        </div>
        <div className="prose-tight max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
