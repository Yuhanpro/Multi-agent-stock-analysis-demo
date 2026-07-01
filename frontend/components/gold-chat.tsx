"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, MessageCircleQuestion, Send, Sparkles, User2 } from "lucide-react";
import { streamSSE } from "@/lib/sse";
import { useT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/format";

interface Turn { role: "user" | "assistant"; content: string; }

/** Multi-turn follow-up chat about gold, grounded in the recap + gold data. */
export function GoldChat({ report, language }: { report: string; language: Lang }) {
  const { t } = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const ctlRef = useRef<{ abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const suggestions = [t("gold.chat.s1"), t("gold.chat.s2"), t("gold.chat.s3")];

  function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setError(null);
    setInput("");
    const history = turns;
    setTurns([...turns, { role: "user", content: question }]);
    setBusy(true);
    setStreaming("");
    let acc = "";
    const ctl = streamSSE("/api/gold-chat", { report, history, question, language }, {
      onEvent: (ev, d) => {
        if (ev === "token") { acc += d?.text ?? ""; setStreaming(acc); }
        else if (ev === "done") { setTurns((p) => [...p, { role: "assistant", content: acc }]); setStreaming(""); setBusy(false); }
        else if (ev === "error") { setError(d?.message ?? "stream error"); setBusy(false); }
      },
      onError: (e) => { setError(e.message); setBusy(false); },
    });
    ctlRef.current = ctl;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <MessageCircleQuestion className="h-4 w-4 text-accent" />
        <span className="text-sm font-medium">{t("followup.title")}</span>
      </div>

      <div ref={scrollRef} className="max-h-[26rem] space-y-4 overflow-y-auto px-5 py-4">
        {turns.length === 0 && !busy && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => ask(s)} className="rounded-full border border-border bg-bg/40 px-3 py-1.5 text-xs text-body hover:border-accent hover:text-accent">{s}</button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => turn.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="flex max-w-[85%] items-start gap-2">
              <div className="whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-accent/30 bg-accent/15 px-3.5 py-2 text-sm text-body">{turn.content}</div>
              <span className="mt-1 shrink-0 rounded-full bg-accent/15 p-1.5"><User2 className="h-3.5 w-3.5 text-accent" /></span>
            </div>
          </div>
        ) : (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-1 shrink-0 rounded-full bg-bull/15 p-1.5"><Sparkles className="h-3.5 w-3.5 text-bull" /></span>
            <div className="prose-tight max-w-[88%]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown></div>
          </div>
        ))}
        {busy && (
          <div className="flex items-start gap-2">
            <span className="mt-1 shrink-0 rounded-full bg-bull/15 p-1.5"><Sparkles className="h-3.5 w-3.5 text-bull" /></span>
            {streaming ? (
              <div className="prose-tight max-w-[88%]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown><span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent align-baseline" /></div>
            ) : (
              <div className="flex items-center gap-2 pt-1 text-sm text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("followup.thinking")}</div>
            )}
          </div>
        )}
        {error && <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-2.5 text-sm text-bear">{error}</div>}
      </div>

      <div className="border-t border-border p-3">
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            rows={1}
            placeholder={t("gold.chat.placeholder")}
            className="flex-1 resize-none rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm text-body placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <button type="submit" disabled={busy || !input.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent/85 disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">{t("followup.send")}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
