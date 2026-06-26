"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, MessageCircleQuestion, Send, User2, Sparkles } from "lucide-react";
import { streamSSE } from "@/lib/sse";
import type { Market } from "@/lib/api";
import { useT, type Lang } from "@/lib/i18n";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  ticker: string;
  market: Market;
  language: Lang;
  /** The completed analysis report, sent as grounding context. */
  report: string;
}

export function FollowupChat({ ticker, market, language, report }: Props) {
  const { t } = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState("");   // in-flight assistant text
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const ctlRef = useRef<{ abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    const history = turns;                 // prior turns (exclude the new one)
    const next = [...turns, { role: "user" as const, content: q }];
    setTurns(next);
    setBusy(true);
    setStreaming("");

    let acc = "";
    const ctl = streamSSE(
      "/api/chat",
      { ticker, market, language, report, history, question: q },
      {
        onEvent: (event, data) => {
          if (event === "token") {
            acc += data?.text ?? "";
            setStreaming(acc);
          } else if (event === "done") {
            setTurns((prev) => [...prev, { role: "assistant", content: acc }]);
            setStreaming("");
            setBusy(false);
          } else if (event === "error") {
            setError(data?.message ?? "stream error");
            setBusy(false);
          }
        },
        onError: (e) => {
          setError(e.message);
          setBusy(false);
        },
      }
    );
    ctlRef.current = ctl;
    // keep the newest message in view
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    );
  }

  const suggestions = [t("followup.suggest1"), t("followup.suggest2"), t("followup.suggest3")];

  return (
    <div className="mt-3 bg-surface border border-border rounded-xl">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-accent" />
        <span className="text-sm font-medium">{t("followup.title")}</span>
      </div>

      <div ref={scrollRef} className="max-h-[28rem] overflow-y-auto px-5 py-4 space-y-4">
        {turns.length === 0 && !busy && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="rounded-full border border-border bg-bg/40 px-3 py-1.5 text-xs text-body hover:border-accent hover:text-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="flex items-start gap-2 max-w-[85%]">
                <div className="rounded-2xl rounded-tr-sm bg-accent/15 border border-accent/30 px-3.5 py-2 text-sm text-body whitespace-pre-wrap">
                  {turn.content}
                </div>
                <span className="mt-1 shrink-0 rounded-full bg-accent/15 p-1.5">
                  <User2 className="h-3.5 w-3.5 text-accent" />
                </span>
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1 shrink-0 rounded-full bg-bull/15 p-1.5">
                <Sparkles className="h-3.5 w-3.5 text-bull" />
              </span>
              <div className="prose-tight max-w-[88%]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
              </div>
            </div>
          )
        )}

        {busy && (
          <div className="flex items-start gap-2">
            <span className="mt-1 shrink-0 rounded-full bg-bull/15 p-1.5">
              <Sparkles className="h-3.5 w-3.5 text-bull" />
            </span>
            {streaming ? (
              <div className="prose-tight max-w-[88%]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
                <span className="inline-block w-2 h-4 align-baseline bg-accent animate-pulse ml-0.5" />
              </div>
            ) : (
              <div className="text-muted text-sm flex items-center gap-2 pt-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("followup.thinking")}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-bear/10 border border-bear/40 text-bear rounded-lg px-4 py-2.5 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder={t("followup.placeholder")}
            className="flex-1 resize-none rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm text-body placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">{t("followup.send")}</span>
          </button>
        </form>
        <p className="mt-2 px-1 text-[11px] text-muted/70">{t("followup.hint")}</p>
      </div>
    </div>
  );
}
