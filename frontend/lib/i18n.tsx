"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "zh";

// Single source of truth for all UI strings. Add a key here, both languages
// must provide it. Keep keys flat — easier to grep than nested.
const DICT = {
  en: {
    // hero
    "hero.eyebrow":   "stock-web · multi-agent analysis",
    "hero.h1":        "Pick a ticker. Watch the agents argue.",
    "hero.lead":      "Run a Buffett-style single-agent review or a TradingAgents multi-agent debate (analyst → bull/bear → trader → risk). Live market data via yfinance / akshare. Powered by DeepSeek V4.",
    // mode selector
    "mode.snapshot.label": "Snapshot",
    "mode.snapshot.hint":  "Live data only — no LLM cost",
    "mode.quick.label":    "Buffett Quick",
    "mode.quick.hint":     "Single-agent value review · ~30s",
    "mode.serenity.label": "Serenity Scan",
    "mode.serenity.hint":  "Supply-chain bottleneck research · ~1 min",
    "mode.debate.label":   "Multi-Agent Debate",
    "mode.debate.hint":    "TradingAgents · ~3-5 min",
    // input
    "input.market.us":          "US Equities",
    "input.market.cn":          "CN A-Shares",
    "input.market.hk":          "HK Stocks",
    "input.placeholder.us":     "AAPL, NVDA, TSLA…",
    "input.placeholder.cn":     "600519, 000001…",
    "input.placeholder.hk":     "00700, 09988, 腾讯…",
    "input.submit":             "Analyze",
    "input.submit.loading":     "Loading…",
    // empty state
    "empty.hint":     "Enter a ticker above. Try AAPL, NVDA, or 600519 (CN).",
    // snapshot card
    "snap.marketcap":     "Market Cap",
    "snap.pe":            "P/E (TTM)",
    "snap.pb":            "P/B",
    "snap.dividend":      "Dividend",
    "snap.eps":           "EPS",
    "snap.revenue_yoy":   "Revenue YoY",
    "snap.bars":          "bars",
    "snap.source":        "source",
    // quick result
    "quick.title":         "Buffett Quick Analysis",
    "quick.title.buffett": "Buffett Quick Analysis",
    "quick.title.serenity": "Serenity Supply Chain Scan",
    "quick.waiting":       "Waiting for first token…",
    // debate
    "debate.title":         "TradingAgents Debate",
    "debate.phase.analysts":   "analysts",
    "debate.phase.investment": "bull vs bear",
    "debate.phase.risk":       "risk debate",
    "debate.phase.final":      "trader plan",
    "debate.phase.done":       "done",
    "debate.section.investment": "Investment Debate",
    "debate.section.risk":       "Risk Debate",
    "debate.final.title":  "Final Decision",
    "debate.final.plan":   "Trader plan",
    "debate.final.fulltext": "Full text",
    "debate.elapsed":      "elapsed",
    "debate.chunks":       "chunks",
    "debate.estcost":      "est",
    // agent labels (server sends English label; we override by id when zh)
    "agent.market_analyst":       "Market Analyst",
    "agent.news_analyst":         "News Analyst",
    "agent.fundamentals_analyst": "Fundamentals Analyst",
    "agent.sentiment_analyst":    "Sentiment Analyst",
    "speaker.Bull Researcher":   "Bull Researcher",
    "speaker.Bear Researcher":   "Bear Researcher",
    "speaker.Research Manager":  "Research Manager",
    "speaker.Aggressive Risk":   "Aggressive Risk",
    "speaker.Conservative Risk": "Conservative Risk",
    "speaker.Neutral Risk":      "Neutral Risk",
    "speaker.Risk Manager":      "Risk Manager",
    // watchlist
    "watch.back": "Back to analysis",
    "watch.title": "Watchlist",
    "watch.lead": "Keep a small list of tickers, choose default analysis modes, and jump back to single-stock analysis when needed.",
    "watch.total": "tickers",
    "watch.enabled": "enabled",
    "watch.ticker.placeholder": "AAPL or 600519",
    "watch.note.placeholder": "Note, thesis, or why you follow it",
    "watch.add": "Add",
    "watch.loading": "Loading watchlist…",
    "watch.empty": "No tickers yet. Add AAPL, NVDA, or 600519 above.",
    "watch.analyze": "Analyze",
    // footer
    "footer.note":    "Research demo. Not investment advice. Limit 5 quick / 1 debate per hour per IP. Daily LLM budget capped.",
    // misc
    "lang.switcher.en": "EN",
    "lang.switcher.zh": "中文",
  },
  zh: {
    "hero.eyebrow":   "stock-web · 多 agent 投资分析",
    "hero.h1":        "输入股票代码。看 AI agent 们辩论。",
    "hero.lead":      "巴菲特单 agent 价值分析,或 TradingAgents 多 agent 辩论(分析师 → 多/空研究员 → 交易员 → 风险委员会)。yfinance / akshare 提供实时行情。DeepSeek V4 驱动。",
    "mode.snapshot.label": "行情快照",
    "mode.snapshot.hint":  "纯数据 · 不调 LLM",
    "mode.quick.label":    "巴菲特速评",
    "mode.quick.hint":     "单 agent 价值判断 · 约 30 秒",
    "mode.serenity.label": "Serenity 产业链扫描",
    "mode.serenity.hint":  "供应链瓶颈研究 · 约 1 分钟",
    "mode.debate.label":   "多 agent 辩论",
    "mode.debate.hint":    "TradingAgents · 约 3-5 分钟",
    "input.market.us":          "美股",
    "input.market.cn":          "A 股",
    "input.market.hk":          "港股",
    "input.placeholder.us":     "AAPL、NVDA、TSLA…",
    "input.placeholder.cn":     "600519、000001…",
    "input.placeholder.hk":     "00700、09988、腾讯…",
    "input.submit":             "开始分析",
    "input.submit.loading":     "加载中…",
    "empty.hint":     "在上方输入股票代码。试试 AAPL、NVDA,或 600519(A 股)。",
    "snap.marketcap":     "总市值",
    "snap.pe":            "市盈率 (TTM)",
    "snap.pb":            "市净率",
    "snap.dividend":      "股息率",
    "snap.eps":           "每股收益",
    "snap.revenue_yoy":   "营收同比",
    "snap.bars":          "根 K 线",
    "snap.source":        "数据源",
    "quick.title":         "巴菲特速评",
    "quick.title.buffett": "巴菲特速评",
    "quick.title.serenity": "Serenity 产业链扫描",
    "quick.waiting":       "正在请求第一个 token…",
    "debate.title":         "TradingAgents 辩论",
    "debate.phase.analysts":   "分析师",
    "debate.phase.investment": "多空对决",
    "debate.phase.risk":       "风险辩论",
    "debate.phase.final":      "交易员决策",
    "debate.phase.done":       "完成",
    "debate.section.investment": "多空辩论",
    "debate.section.risk":       "风险辩论",
    "debate.final.title":  "最终决策",
    "debate.final.plan":   "交易员计划",
    "debate.final.fulltext": "完整内容",
    "debate.elapsed":      "耗时",
    "debate.chunks":       "事件",
    "debate.estcost":      "估算",
    "agent.market_analyst":       "技术面分析师",
    "agent.news_analyst":         "新闻分析师",
    "agent.fundamentals_analyst": "基本面分析师",
    "agent.sentiment_analyst":    "情绪分析师",
    "speaker.Bull Researcher":   "多头研究员",
    "speaker.Bear Researcher":   "空头研究员",
    "speaker.Research Manager":  "研究经理",
    "speaker.Aggressive Risk":   "激进派",
    "speaker.Conservative Risk": "保守派",
    "speaker.Neutral Risk":      "中立派",
    "speaker.Risk Manager":      "风险委员会主席",
    "watch.back": "返回分析页",
    "watch.title": "自选股",
    "watch.lead": "保存少量关注标的,为每只股票设置默认分析模式,需要时一键回到单票分析。",
    "watch.total": "只股票",
    "watch.enabled": "启用",
    "watch.ticker.placeholder": "AAPL 或 600519",
    "watch.note.placeholder": "备注、跟踪逻辑或关注原因",
    "watch.add": "添加",
    "watch.loading": "正在加载自选股…",
    "watch.empty": "还没有自选股。可以先添加 AAPL、NVDA 或 600519。",
    "watch.analyze": "分析",
    "footer.note":    "研究 demo。不构成投资建议。每 IP 每小时限 5 次速评 / 1 次辩论。每日 LLM 总额受限。",
    "lang.switcher.en": "EN",
    "lang.switcher.zh": "中文",
  },
} as const satisfies Record<Lang, Record<string, string>>;

type DictKey = keyof typeof DICT["en"];

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey) => string;
}

const Ctx = createContext<I18nCtx | null>(null);
const STORAGE_KEY = "stock-web:lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Hydrate from localStorage; default to browser language on first visit.
  useEffect(() => {
    const saved = typeof window !== "undefined"
      ? (window.localStorage.getItem(STORAGE_KEY) as Lang | null)
      : null;
    if (saved === "en" || saved === "zh") {
      setLangState(saved);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) {
      setLangState("zh");
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const value = useMemo<I18nCtx>(() => {
    const dict = DICT[lang];
    return {
      lang,
      setLang,
      t: (key) => dict[key] ?? key,
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useT must be inside I18nProvider");
  return ctx;
}
