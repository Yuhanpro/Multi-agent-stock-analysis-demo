"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Newspaper,
  BarChart3,
  Scale,
  Shield,
  Gavel,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { companyShortName } from "@/lib/company-names";
import { streamSSE } from "@/lib/sse";
import { useT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/format";

interface Props {
  ticker: string;
  market: "US" | "CN";
  language: Lang;
  runId: number;
}

interface AgentBlock {
  agent: string;
  label: string;
  status: "running" | "complete";
  report?: string;
}

interface DebateTurn {
  phase: "investment" | "risk";
  speaker: string;
  content: string;
  round: number;
}

interface FinalDecision {
  decision: string;
  trader_plan: string;
}

interface DoneInfo {
  chunks: number;
  elapsed_sec: number;
  agents_completed: string[];
  est_cost_usd?: number;
  budget_today_usd?: number;
}

const AGENT_ICONS: Record<string, JSX.Element> = {
  market_analyst:       <BarChart3 className="h-4 w-4" />,
  news_analyst:         <Newspaper className="h-4 w-4" />,
  fundamentals_analyst: <Scale className="h-4 w-4" />,
  sentiment_analyst:    <TrendingUp className="h-4 w-4" />,
};

const SPEAKER_STYLES: Record<string, { icon: JSX.Element; tint: string }> = {
  "Bull Researcher":     { icon: <TrendingUp className="h-3.5 w-3.5" />, tint: "text-bull border-bull/40 bg-bull/5" },
  "Bear Researcher":     { icon: <TrendingDown className="h-3.5 w-3.5" />, tint: "text-bear border-bear/40 bg-bear/5" },
  "Research Manager":    { icon: <Gavel className="h-3.5 w-3.5" />,        tint: "text-accent border-accent/40 bg-accent/5" },
  "Aggressive Risk":     { icon: <TrendingUp className="h-3.5 w-3.5" />, tint: "text-bull border-bull/40 bg-bull/5" },
  "Conservative Risk":   { icon: <Shield className="h-3.5 w-3.5" />,       tint: "text-bear border-bear/40 bg-bear/5" },
  "Neutral Risk":        { icon: <Scale className="h-3.5 w-3.5" />,        tint: "text-muted border-border bg-surface" },
  "Risk Manager":        { icon: <Gavel className="h-3.5 w-3.5" />,        tint: "text-accent border-accent/40 bg-accent/5" },
};

export function DebateStream({ ticker, market, runId, language }: Props) {
  const { t } = useT();
  const [agents, setAgents] = useState<AgentBlock[]>([]);
  const [turns, setTurns] = useState<DebateTurn[]>([]);
  const [final, setFinal] = useState<FinalDecision | null>(null);
  const [done, setDone] = useState<DoneInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "analysts" | "investment" | "risk" | "final" | "done">("idle");
  const ctlRef = useRef<{ abort: () => void } | null>(null);

  useEffect(() => {
    setAgents([]);
    setTurns([]);
    setFinal(null);
    setDone(null);
    setError(null);
    setPhase("analysts");

    const ctl = streamSSE(
      "/api/debate",
      { ticker, market, analysts: ["market", "news", "fundamentals"], language },
      {
        onEvent: (event, data) => {
          switch (event) {
            case "snapshot":
            case "meta":
              break;
            case "agent_start":
              setAgents((a) => {
                if (a.some((x) => x.agent === data.agent)) return a;
                return [...a, { agent: data.agent, label: data.label, status: "running" }];
              });
              break;
            case "agent_complete":
              setAgents((a) => {
                const existing = a.find((x) => x.agent === data.agent);
                if (existing) {
                  return a.map((x) =>
                    x.agent === data.agent
                      ? { ...x, status: "complete", report: data.report }
                      : x
                  );
                }
                return [...a, { agent: data.agent, label: data.label, status: "complete", report: data.report }];
              });
              break;
            case "debate_turn":
              setTurns((t) => [...t, data as DebateTurn]);
              setPhase((p) => (data.phase === "risk" ? "risk" : "investment"));
              break;
            case "final":
              setFinal(data);
              setPhase("final");
              break;
            case "done":
              setDone(data);
              setPhase("done");
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
  }, [ticker, market, runId, language]);

  const inflight = phase !== "done" && !error;
  const shortName = companyShortName(ticker, market);
  const label = shortName ? `${ticker} · ${shortName}` : ticker;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {inflight ? (
            <Loader2 className="h-4 w-4 text-accent animate-spin" />
          ) : error ? (
            <AlertCircle className="h-4 w-4 text-bear" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-bull" />
          )}
          <h3 className="text-sm font-semibold">
            {t("debate.title")} · {label}
          </h3>
          <PhasePill phase={phase} />
        </div>
        {done && (
          <div className="text-[10px] text-muted/70 font-mono">
            {done.elapsed_sec}s · {done.chunks} {t("debate.chunks")}
            {done.est_cost_usd != null && ` · ${t("debate.estcost")} $${done.est_cost_usd.toFixed(3)}`}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-bear/10 border border-bear/40 text-bear rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Analyst cards (3 in a row on wide screens) */}
      {agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {agents.map((a) => (
            <AgentCard key={a.agent} block={a} />
          ))}
        </div>
      )}

      {/* Investment debate (bull / bear / judge) */}
      {turns.filter((t) => t.phase === "investment").length > 0 && (
        <DebateGroup title={t("debate.section.investment")} turns={turns.filter((t) => t.phase === "investment")} />
      )}

      {/* Risk debate (aggressive / conservative / neutral / judge) */}
      {turns.filter((t) => t.phase === "risk").length > 0 && (
        <DebateGroup title={t("debate.section.risk")} turns={turns.filter((t) => t.phase === "risk")} />
      )}

      {final && <FinalCard final={final} />}
    </div>
  );
}

function PhasePill({ phase }: { phase: string }) {
  const { t } = useT();
  const labelMap: Record<string, string> = {
    analysts:   t("debate.phase.analysts"),
    investment: t("debate.phase.investment"),
    risk:       t("debate.phase.risk"),
    final:      t("debate.phase.final"),
    done:       t("debate.phase.done"),
  };
  if (phase === "idle") return null;
  return (
    <span className="text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
      {labelMap[phase] ?? phase}
    </span>
  );
}

function AgentCard({ block }: { block: AgentBlock }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const icon = AGENT_ICONS[block.agent] ?? <BarChart3 className="h-4 w-4" />;
  // Translate the label by agent id; fall back to server-provided English label.
  const localized = t(("agent." + block.agent) as any);
  const label = localized && localized !== "agent." + block.agent ? localized : block.label;

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={block.status !== "complete"}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-border/30 disabled:cursor-default disabled:hover:bg-transparent transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              block.status === "running" ? "text-accent" : "text-bull"
            )}
          >
            {block.status === "running" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              icon
            )}
          </span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        {block.status === "complete" &&
          (open ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted" />
          ))}
      </button>
      {block.status === "complete" && open && block.report && (
        <div className="px-4 pt-1 pb-4 prose-tight border-t border-border/40">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.report}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function DebateGroup({ title, turns }: { title: string; turns: DebateTurn[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted font-mono mb-2 mt-4">
        {title}
      </div>
      <div className="space-y-2">
        {turns.map((t, i) => (
          <DebateTurnCard key={`${t.speaker}-${i}`} turn={t} />
        ))}
      </div>
    </div>
  );
}

function DebateTurnCard({ turn }: { turn: DebateTurn }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const style = SPEAKER_STYLES[turn.speaker] ?? {
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    tint: "text-fg border-border bg-surface",
  };
  // Show first ~280 chars when collapsed for instant context.
  const preview =
    turn.content.length > 280 ? turn.content.slice(0, 280) + "…" : turn.content;
  // Localized speaker label; fall back to server English when missing.
  const localized = t(("speaker." + turn.speaker) as any);
  const speakerLabel = localized && localized !== "speaker." + turn.speaker ? localized : turn.speaker;

  return (
    <div className={cn("border rounded-lg overflow-hidden", style.tint)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-start gap-2 hover:bg-border/20 transition-colors text-left"
      >
        <span className="mt-0.5">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide">
              {speakerLabel}
            </span>
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 opacity-70" />
            )}
          </div>
          {!open && (
            <div className="text-xs text-fg/75 mt-1 line-clamp-3">{preview}</div>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 prose-tight">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function FinalCard({ final }: { final: FinalDecision }) {
  const { t } = useT();
  const verdict = (final.decision || "").match(/\b(BUY|SELL|HOLD)\b/i)?.[1]?.toUpperCase();
  const tint =
    verdict === "BUY" ? "border-bull/50 bg-bull/5"
    : verdict === "SELL" ? "border-bear/50 bg-bear/5"
    : "border-accent/50 bg-accent/5";
  const verdictColor =
    verdict === "BUY" ? "text-bull"
    : verdict === "SELL" ? "text-bear"
    : "text-accent";

  const summary = extractTLDR(final.decision);
  const facts = extractFacts(final.decision);

  return (
    <div className={cn("border-2 rounded-xl p-5 space-y-4", tint)}>
      <div className="flex items-center gap-2">
        <Gavel className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-bold uppercase tracking-wider">
          {t("debate.final.title")}
        </h3>
      </div>

      {/* Hero verdict — the part the user wants jumping out */}
      {verdict && (
        <div className="flex flex-col items-center text-center py-2">
          <div className={cn("text-5xl font-bold tracking-tight", verdictColor)}>
            {verdict}
          </div>
          {summary && (
            <p className="text-sm text-fg/85 max-w-2xl mt-3 leading-relaxed">
              {summary}
            </p>
          )}
        </div>
      )}

      {/* Structured facts row, only when something was extracted */}
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center pb-1">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="bg-bg/40 border border-border/60 rounded-lg px-3 py-1.5"
            >
              <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
              <div className="text-sm font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Full decision — collapsed by default so the verdict above gets the spotlight */}
      <details className="border-t border-border/40 pt-3 group">
        <summary className="text-xs font-mono uppercase tracking-wide text-muted cursor-pointer hover:text-fg flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 group-open:rotate-90 transition-transform" />
          {t("debate.final.fulltext")}
        </summary>
        <div className="prose-tight mt-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{final.decision}</ReactMarkdown>
        </div>
      </details>

      {final.trader_plan && (
        <details className="border-t border-border/40 pt-3 group">
          <summary className="text-xs font-mono uppercase tracking-wide text-muted cursor-pointer hover:text-fg flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 group-open:rotate-90 transition-transform" />
            {t("debate.final.plan")}
          </summary>
          <div className="prose-tight mt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{final.trader_plan}</ReactMarkdown>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Pull a TL;DR sentence from the final decision text.
 * The LLM emits English ("Executive Summary"/"Reasoning") and Chinese
 * ("执行摘要"/"理由") variants; we try a list of labels and grab the first
 * sentence (~200 chars cap so it stays as a hero blurb).
 */
function extractTLDR(decision: string): string | null {
  if (!decision) return null;
  const labels = [
    "Executive Summary",
    "执行摘要",
    "Reasoning",
    "理由",
    "Action",
    "Recommendation",
    "建议",
    "结论",
  ];
  for (const label of labels) {
    // Match `**Label**: text` or `## Label\n text` etc.
    const re = new RegExp(
      `\\*?\\*?${escapeReg(label)}\\*?\\*?\\s*[:：]?\\s*([\\s\\S]+?)(?=\\n\\s*\\*?\\*?[A-Z\\u4e00-\\u9fff][^\\*\\n:]{1,40}\\*?\\*?\\s*[:：]|\\n\\s*##|\\n\\s*\\n|$)`,
      "i"
    );
    const m = decision.match(re);
    if (m && m[1]) {
      const cleaned = m[1].trim().replace(/\s+/g, " ").replace(/\*/g, "");
      if (cleaned.length > 20) {
        // Take the first sentence (English period / Chinese 。)
        const sent = cleaned.match(/^[^.。!?！？]+[.。!?！？]/);
        const out = (sent ? sent[0] : cleaned).trim();
        return out.length > 240 ? out.slice(0, 240) + "…" : out;
      }
    }
  }
  // Fallback — first non-empty paragraph after the verdict line
  const lines = decision.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^\*?\*?(BUY|SELL|HOLD|Rating|Action|FINAL TRANSACTION)/i.test(line)) continue;
    if (line.length > 40) {
      const cleaned = line.replace(/\*/g, "").replace(/\s+/g, " ");
      return cleaned.length > 240 ? cleaned.slice(0, 240) + "…" : cleaned;
    }
  }
  return null;
}

/**
 * Pull structured facts (price target / stop loss / time horizon) from the
 * decision text. The TradingAgents final prompt encourages these labels, so
 * they appear in nearly every run, English or Chinese.
 */
function extractFacts(decision: string): Array<[string, string]> {
  if (!decision) return [];
  const patterns: Array<[string, RegExp]> = [
    ["Price Target",  /\*?\*?(?:Price\s*Target|目标价(?:位)?)\*?\*?\s*[:：]\s*([^\n*]{1,40})/i],
    ["Stop Loss",     /\*?\*?(?:Stop\s*Loss|止损(?:价|位)?)\*?\*?\s*[:：]\s*([^\n*]{1,40})/i],
    ["Time Horizon",  /\*?\*?(?:Time\s*Horizon|时间(?:周期|窗口|框架))\*?\*?\s*[:：]\s*([^\n*]{1,60})/i],
    ["Position",      /\*?\*?(?:Position\s*Sizing|Position|仓位|建议仓位|持仓占比)\*?\*?\s*[:：]\s*([^\n*]{1,40})/i],
  ];
  const out: Array<[string, string]> = [];
  for (const [label, re] of patterns) {
    const m = decision.match(re);
    if (m && m[1]) {
      const v = m[1].trim().replace(/\.$/, "").replace(/\s+/g, " ");
      if (v && v.length < 50) out.push([label, v]);
    }
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
