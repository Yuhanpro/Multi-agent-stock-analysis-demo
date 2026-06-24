"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { streamSSE } from "@/lib/sse";
import { companyShortName } from "@/lib/company-names";
import type { Market } from "@/lib/api";
import { useT, type Lang } from "@/lib/i18n";
import { fmtNumber } from "@/lib/format";

interface Props {
  ticker: string;
  market: Market;
  language: Lang;
  skill?: "buffett" | "serenity";
  /** Position diagnosis: when set, the agent gives an add/hold/trim/sell call. */
  costBasis?: number;
  shares?: number;
  buyDate?: string;
  /** Bumping this re-runs the request. Parent passes a counter / nonce. */
  runId: number;
}

interface DoneInfo {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  cost_usd: number;
  budget_today_usd?: number;
  stop_reason?: string;
}

export function QuickResult({ ticker, market, runId, language, skill = "buffett", costBasis, shares, buyDate }: Props) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [done, setDone] = useState<DoneInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctlRef = useRef<{ abort: () => void } | null>(null);

  useEffect(() => {
    setText("");
    setModel(null);
    setDone(null);
    setError(null);

    const ctl = streamSSE(
      "/api/quick",
      {
        ticker, market, skill, language,
        ...(costBasis ? { cost_basis: costBasis } : {}),
        ...(shares ? { shares } : {}),
        ...(buyDate ? { buy_date: buyDate } : {}),
      },
      {
        onEvent: (event, data) => {
          switch (event) {
            case "snapshot":
              break; // handled by sibling SnapshotCard via separate fetch
            case "meta":
              setModel(data.model ?? null);
              break;
            case "token":
              setText((t) => t + (data?.text ?? ""));
              break;
            case "done":
              setDone(data);
              break;
            case "error":
              setError(data?.message ?? "stream error");
              break;
          }
        },
        onError: (e) => setError(e.message),
      }
    );
    ctlRef.current = ctl;
    return () => ctl.abort();
  }, [ticker, market, runId, language, skill, costBasis, shares, buyDate]);

  const inflight = !done && !error;
  const shortName = companyShortName(ticker, market);
  const label = shortName ? `${ticker} · ${shortName}` : ticker;

  return (
    <div className="bg-surface border border-border rounded-xl">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          {inflight ? (
            <Loader2 className="h-4 w-4 text-accent animate-spin" />
          ) : error ? (
            <AlertCircle className="h-4 w-4 text-bear" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-bull" />
          )}
          <span className="text-sm font-medium">
            {t(skill === "serenity" ? "quick.title.serenity" : "quick.title.buffett")} · {label}
          </span>
          {model && (
            <span className="text-[10px] text-muted/70 font-mono">{model}</span>
          )}
        </div>
        {done && (
          <div className="text-[10px] text-muted/70 font-mono">
            {fmtNumber(done.input_tokens, 0)} in /{" "}
            {fmtNumber(done.output_tokens, 0)} out · ${done.cost_usd.toFixed(4)}
          </div>
        )}
      </div>

      <div className="p-5">
        {error ? (
          <div className="bg-bear/10 border border-bear/40 text-bear rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        ) : text ? (
          <div className="prose-tight max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            {inflight && (
              <span className="inline-block w-2 h-4 align-baseline bg-accent animate-pulse ml-0.5" />
            )}
          </div>
        ) : (
          <div className="text-muted text-sm flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("quick.waiting")}
          </div>
        )}
      </div>
    </div>
  );
}
