"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Clock3, Download, Lightbulb,
  Loader2, RefreshCw, Search, ShieldCheck, Target, X,
} from "lucide-react";
import {
  fetchRecommendations,
  fetchRecommendationBacktest,
  searchSymbols,
  type SymbolSuggestion,
  type RecommendationBacktest,
  type RecommendationProfile,
  type RecommendationResponse,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";
import { track } from "@/lib/track";

const PROFILES: RecommendationProfile[] = ["conservative", "balanced", "aggressive"];

const COPY = {
  zh: {
    title: "机会雷达",
    lead: "每天只筛少量值得出手研究的机会，并把关注价格、止损条件和推荐后的真实结果完整记录。",
    conservative: "稳健",
    balanced: "均衡",
    aggressive: "进取",
    allIndustries: "全部行业",
    industryLabel: "选择行业",
    refresh: "刷新",
    loading: "正在扫描 A 股市场…",
    score: "综合分",
    evidence: "真实推荐成绩",
    evidenceLead: "从首次上线开始逐日记录，不回填历史、不隐藏失败样本。",
    tracking: "累计推荐记录",
    samples: "个成熟样本",
    winRate: "正收益率",
    avgReturn: "平均收益",
    backtestTitle: "看看这些股票过去表现怎么样",
    backtestLead: "添加你关心的A股，系统会模拟过去出现相同机会时买入，看看后来赚钱的次数和风险。",
    runBacktest: "运行3年回测",
    rerunBacktest: "重新运行",
    backtesting: "正在拉取历史日线并逐日复测…",
    signals: "历史信号",
    stocks: "只当前候选股",
    positiveRate: "正收益率",
    medianReturn: "中位收益",
    targetFirst: "目标先触发",
    stopFirst: "止损先触发",
    maxDrawdown: "序列最大回撤",
    portfolioReturn: "组合累计收益",
    annualizedReturn: "组合年化收益",
    benchmarkReturn: "沪深300同期",
    excessReturn: "相对基准超额",
    executionRules: "成交约束",
    blockedTrades: "次信号因停牌/涨停未成交",
    slippageIncluded: "已计滑点",
    fundamentalsCoverage: "历史基本面覆盖",
    costIncluded: "已计交易成本",
    backtestLimits: "口径与局限",
    choosePeriod: "选择回溯时间",
    chooseStocks: "选择纳入股票",
    selectAll: "全选",
    clearAll: "清空",
    selectedCount: "只已选择",
    needStock: "请至少选择一只股票",
    conclusion: "一句话结论",
    sampleLow: "样本较少，结果只能作为线索，暂时不能证明策略稳定。",
    outlierDriven: "平均收益为正但中位收益不佳，结果主要由少数大涨股票拉高，稳定性不足。",
    promising: "平均收益、中位收益和正收益率同时较好，历史表现有一定一致性，仍需真实样本验证。",
    weak: "大多数历史信号没有获得正收益，当前规则在这组股票上缺乏优势。",
    readFirst: "先看中位收益和样本数，再看平均收益；平均值容易被少数大涨样本拉高。",
    includedStocks: "本次实际包含",
    reliability: "样本可信度",
    reliabilityLow: "低",
    reliabilityMedium: "中",
    reliabilityHigh: "较高",
    searchStock: "输入股票名称或6位代码",
    searchHint: "可添加任意A股，最多10只",
    quickAdd: "快速添加今日候选",
    startCheck: "看看历史表现",
    resultTitle: "历史验证结果",
    noMatch: "未找到匹配的A股",
    duplicate: "该股票已经添加",
    tradeHistory: "每次模拟买卖",
    tradeHistoryLead: "以下价格来自历史日线，收益已经扣除设定的交易成本。",
    signalDay: "发现机会",
    buyDay: "模拟买入",
    sellDay: "模拟卖出",
    buyPrice: "买入价",
    sellPrice: "卖出价",
    latestDay: "最新日期",
    latestPrice: "最新价格",
    held: "持有",
    days: "个交易日",
    showAll: "查看全部记录",
    showLess: "收起记录",
    noTrades: "所选时间内没有出现符合规则的机会",
    noFilteredTrades: "没有符合当前筛选条件的记录",
    filterStock: "全部股票",
    filterResult: "全部结果",
    filterYear: "全部年份",
    resultProfit: "盈利",
    resultLoss: "亏损",
    resultOpen: "观察中",
    exportCsv: "导出 CSV",
    filteredSignals: "条筛选结果",
    thesis: "机会逻辑",
    entry: "关注区间",
    target: "目标参考",
    stop: "失效价格",
    horizon: "预计周期",
    rr: "收益风险比",
    discipline: "执行纪律",
    reason: "入选依据",
    risk: "主要风险",
    analyze: "打开个股分析",
    pool: "只股票参与扫描",
    eligible: "只通过基础过滤",
    industries: "个行业",
    otherIndustry: "其他",
    logicTitle: "推荐逻辑",
    logicBase: "基础过滤：排除 ST、退市整理和北交所股票，并要求价格、涨跌幅和成交额有效。",
    logicFactors: "四项评分：流动性、适度动量、估值和波动稳定性，均为 0–100 分。",
    logicConservative: "稳健权重：流动性 30% · 动量 15% · 估值 30% · 稳定性 25%；最低成交额 5 亿元。",
    logicBalanced: "均衡权重：流动性 30% · 动量 30% · 估值 20% · 稳定性 20%；最低成交额 2 亿元。",
    logicAggressive: "进取权重：流动性 25% · 动量 50% · 估值 10% · 稳定性 15%；最低成交额 1 亿元。",
    logicIndustry: "选择具体行业后，只在该行业内按总分排名；选择全部行业时，每个行业最多入选 2 只。",
    industrySource: "行业分类来源：新浪行业板块（经 AKShare 获取）。该口径可能与证监会、申万等分类不同，未覆盖的股票显示为“其他”。",
    logicLimit: "局限：当前主要使用当日行情与估值快照，未覆盖财报质量、公告、突发新闻和历史回测。",
    breakdown: ["流动性", "动量", "估值", "稳定性"],
  },
  en: {
    title: "Opportunity radar",
    lead: "A short list of research opportunities with entry zones, invalidation rules and an immutable outcome record.",
    conservative: "Conservative",
    balanced: "Balanced",
    aggressive: "Aggressive",
    allIndustries: "All industries",
    industryLabel: "Choose industry",
    refresh: "Refresh",
    loading: "Scanning the A-share market…",
    score: "Score",
    evidence: "Live recommendation record",
    evidenceLead: "Tracked forward from launch, with no backfill and no failed signal deletion.",
    tracking: "Recorded signals",
    samples: "mature samples",
    winRate: "Positive rate",
    avgReturn: "Average return",
    backtestTitle: "See how these stocks behaved before",
    backtestLead: "Add any A-share. We simulate similar past opportunities and summarize wins and risks.",
    runBacktest: "Run 3-year test",
    rerunBacktest: "Run again",
    backtesting: "Loading daily history and walking forward…",
    signals: "historical signals",
    stocks: "current candidates",
    positiveRate: "Positive rate",
    medianReturn: "Median return",
    targetFirst: "Target first",
    stopFirst: "Stop first",
    maxDrawdown: "Sequence max drawdown",
    portfolioReturn: "Portfolio return",
    annualizedReturn: "Annualized return",
    benchmarkReturn: "CSI 300 return",
    excessReturn: "Excess vs benchmark",
    executionRules: "Execution constraints",
    blockedTrades: "signals blocked by suspension/limit-up",
    slippageIncluded: "slippage included",
    fundamentalsCoverage: "Historical fundamentals coverage",
    costIncluded: "cost included",
    backtestLimits: "Method and limitations",
    choosePeriod: "Lookback period",
    chooseStocks: "Stocks included",
    selectAll: "Select all",
    clearAll: "Clear",
    selectedCount: "selected",
    needStock: "Select at least one stock",
    conclusion: "Plain-language conclusion",
    sampleLow: "The sample is small and cannot yet establish stable performance.",
    outlierDriven: "Average return is positive but median return is weak; a few large winners drive the result.",
    promising: "Average, median and positive rate are aligned, suggesting some consistency that still needs live validation.",
    weak: "Most historical signals were not profitable; these rules show little edge on this stock set.",
    readFirst: "Read median return and sample size before the average, which can be lifted by a few outliers.",
    includedStocks: "Actually included",
    reliability: "Sample reliability",
    reliabilityLow: "Low",
    reliabilityMedium: "Medium",
    reliabilityHigh: "Higher",
    searchStock: "Search name or 6-digit code",
    searchHint: "Add any A-share, up to 10",
    quickAdd: "Add today's candidates",
    startCheck: "Check historical performance",
    resultTitle: "Historical result",
    noMatch: "No matching A-share",
    duplicate: "Already added",
    tradeHistory: "Every simulated trade",
    tradeHistoryLead: "Historical daily prices; returns include configured transaction costs.",
    signalDay: "Signal",
    buyDay: "Simulated buy",
    sellDay: "Simulated sell",
    buyPrice: "Buy",
    sellPrice: "Sell",
    latestDay: "Latest date",
    latestPrice: "Latest price",
    held: "Held",
    days: "trading days",
    showAll: "Show all records",
    showLess: "Show fewer",
    noTrades: "No matching opportunities in the selected period",
    noFilteredTrades: "No records match these filters",
    filterStock: "All stocks",
    filterResult: "All results",
    filterYear: "All years",
    resultProfit: "Profitable",
    resultLoss: "Loss",
    resultOpen: "Open",
    exportCsv: "Export CSV",
    filteredSignals: "filtered",
    thesis: "Opportunity thesis",
    entry: "Entry zone",
    target: "Target reference",
    stop: "Invalidation price",
    horizon: "Time horizon",
    rr: "Reward / risk",
    discipline: "Execution discipline",
    reason: "Why it ranked",
    risk: "Key risks",
    analyze: "Open stock analysis",
    pool: "stocks scanned",
    eligible: "passed base filters",
    industries: "industries represented",
    otherIndustry: "Other",
    logicTitle: "How recommendations work",
    logicBase: "Base filters: excludes ST, delisting-stage and Beijing Exchange stocks, and requires valid price, change and turnover.",
    logicFactors: "Four 0–100 scores: liquidity, moderate momentum, valuation and price stability.",
    logicConservative: "Conservative: liquidity 30% · momentum 15% · valuation 30% · stability 25%; ¥500m minimum turnover.",
    logicBalanced: "Balanced: liquidity 30% · momentum 30% · valuation 20% · stability 20%; ¥200m minimum turnover.",
    logicAggressive: "Aggressive: liquidity 25% · momentum 50% · valuation 10% · stability 15%; ¥100m minimum turnover.",
    logicIndustry: "A selected industry is ranked on its own. The all-industry list caps each classified industry at two candidates.",
    industrySource: "Industry source: Sina industry sectors via AKShare. This taxonomy may differ from CSRC or Shenwan classifications; uncovered stocks appear as “Other.”",
    logicLimit: "Limitations: currently based mainly on intraday price and valuation snapshots; financial quality, filings, breaking news and backtests are not included.",
    breakdown: ["Liquidity", "Momentum", "Valuation", "Stability"],
  },
};

export default function RecommendPage() {
  const { lang } = useT();
  const c = COPY[lang];
  const [profile, setProfile] = useState<RecommendationProfile>("balanced");
  const [industry, setIndustry] = useState("");
  const [data, setData] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [backtest, setBacktest] = useState<RecommendationBacktest | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestYears, setBacktestYears] = useState(3);
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<Record<string, string>>({});
  const [stockQuery, setStockQuery] = useState("");
  const [stockSuggestions, setStockSuggestions] = useState<SymbolSuggestion[]>([]);
  const [searchingStocks, setSearchingStocks] = useState(false);
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [tradeTicker, setTradeTicker] = useState("");
  const [tradeResult, setTradeResult] = useState("");
  const [tradeYear, setTradeYear] = useState("");
  const groupedCandidates = data?.candidates.reduce<Record<string, typeof data.candidates>>(
    (groups, item) => {
      const industry = item.industry || c.otherIndustry;
      (groups[industry] ||= []).push(item);
      return groups;
    },
    {}
  ) ?? {};

  useEffect(() => {
    setLoading(true);
    setError(null);
    track(`run:recommend:${profile}:${industry || "all"}`);
    fetchRecommendations(profile, 10, industry || undefined)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [profile, industry, nonce]);

  useEffect(() => {
    setBacktest(null);
    setBacktestError(null);
  }, [profile]);

  useEffect(() => {
    if (data?.candidates.length) {
      const initial = data.candidates.slice(0, 3);
      setSelectedTickers(initial.map((item) => item.ticker));
      setSelectedNames(Object.fromEntries(initial.map((item) => [item.ticker, item.name])));
    }
  }, [data?.as_of, profile]);

  useEffect(() => {
    const query = stockQuery.trim();
    if (!query) {
      setStockSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearchingStocks(true);
      searchSymbols(query, "CN", 6)
        .then(setStockSuggestions)
        .catch(() => setStockSuggestions([]))
        .finally(() => setSearchingStocks(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [stockQuery]);

  const addStock = (stock: SymbolSuggestion) => {
    if (selectedTickers.includes(stock.ticker) || selectedTickers.length >= 10) return;
    setSelectedTickers((current) => [...current, stock.ticker]);
    setSelectedNames((current) => ({ ...current, [stock.ticker]: stock.name }));
    setStockQuery("");
    setStockSuggestions([]);
    setBacktest(null);
  };

  const removeStock = (ticker: string) => {
    setSelectedTickers((current) => current.filter((item) => item !== ticker));
    setSelectedNames((current) => {
      const next = { ...current };
      delete next[ticker];
      return next;
    });
    setBacktest(null);
  };

  const runBacktest = () => {
    if (!selectedTickers.length) {
      setBacktestError(c.needStock);
      return;
    }
    setBacktestLoading(true);
    setShowAllTrades(false);
    setTradeTicker("");
    setTradeResult("");
    setTradeYear("");
    setBacktestError(null);
    track(`run:recommend-backtest:${profile}:${backtestYears}y:${selectedTickers.length}`);
    fetchRecommendationBacktest(profile, backtestYears, 10, selectedTickers, industry || undefined)
      .then(setBacktest)
      .catch((err) => setBacktestError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBacktestLoading(false));
  };

  const tradeYears = useMemo(
    () => Array.from(new Set(backtest?.trades.map((trade) => trade.signal_date.slice(0, 4)) ?? [])).sort().reverse(),
    [backtest]
  );
  const filteredTrades = useMemo(
    () => backtest?.trades.filter((trade) => {
      if (tradeTicker && trade.ticker !== tradeTicker) return false;
      if (tradeYear && !trade.signal_date.startsWith(tradeYear)) return false;
      if (tradeResult === "open" && trade.exit_reason !== "open") return false;
      if (tradeResult === "profit" && (trade.exit_reason === "open" || trade.return_pct <= 0)) return false;
      if (tradeResult === "loss" && (trade.exit_reason === "open" || trade.return_pct > 0)) return false;
      return true;
    }) ?? [],
    [backtest, tradeTicker, tradeResult, tradeYear]
  );

  const exportTradesCsv = () => {
    if (!filteredTrades.length) return;
    const headers = [
      "股票名称", "股票代码", "信号日期", "买入日期", "买入价", "退出日期",
      "退出价", "持有交易日", "退出原因", "收益率(%)",
    ];
    const escapeCell = (value: string | number) => `"${String(value).replaceAll("\"", "\"\"")}"`;
    const rows = filteredTrades.map((trade) => [
      trade.name, trade.ticker, trade.signal_date, trade.entry_date, trade.entry_price,
      trade.exit_date, trade.exit_price, trade.holding_days, trade.exit_reason_label, trade.return_pct,
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `recommendation-backtest-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    track(`export:recommend-backtest:${filteredTrades.length}`);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="space-y-4">
        <div className="flex items-center gap-2 text-accent">
          <Lightbulb className="h-4 w-4" />
          <h1 className="text-sm font-semibold">{c.title}</h1>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-body">{c.lead}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface p-1">
            {PROFILES.map((item) => (
              <button
                key={item}
                onClick={() => setProfile(item)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  profile === item ? "bg-accent text-white" : "text-muted hover:text-heading"
                )}
              >
                {c[item]}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted">
            <span>{c.industryLabel}</span>
            <select
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className="min-w-36 max-w-48 rounded-md bg-input px-2 py-1 font-medium text-heading outline-none focus:ring-1 focus:ring-accent sm:min-w-44 sm:max-w-none"
            >
              <option
                value=""
                className="bg-surface text-heading"
                style={{ backgroundColor: "hsl(var(--theme-surface))", color: "hsl(var(--theme-heading))" }}
              >
                {c.allIndustries}
              </option>
              {(data?.available_industries ?? []).map((item) => (
                <option
                  key={item}
                  value={item}
                  className="bg-surface text-heading"
                  style={{ backgroundColor: "hsl(var(--theme-surface))", color: "hsl(var(--theme-heading))" }}
                >
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setNonce((value) => value + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-heading"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {c.refresh}
          </button>
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-border bg-surface/60 p-4 text-xs leading-5 text-muted">
        <h2 className="mb-2 font-semibold text-heading">{c.logicTitle}</h2>
        <ul className="space-y-1">
          <li>· {c.logicBase}</li>
          <li>· {c.logicFactors}</li>
          <li>· {c[`logic${profile[0].toUpperCase()}${profile.slice(1)}` as keyof typeof c]}</li>
          <li>· {c.logicIndustry}</li>
          <li>· {c.industrySource}</li>
          <li>· {c.logicLimit}</li>
        </ul>
      </section>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> {c.loading}
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>
      ) : data ? (
        <div className="mt-6 space-y-4">
          <section className="overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-br from-accent/15 via-surface to-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-heading">
                  <BarChart3 className="h-4 w-4 text-accent" /> {c.evidence}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{c.evidenceLead}</p>
              </div>
              <div className="rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted">
                {c.tracking} {data.performance.total_signals}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {data.performance.windows.map((window) => (
                <div key={window.trading_days} className="rounded-lg border border-border bg-input/70 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-heading">{window.trading_days}日结果</span>
                    <span className="text-muted">{window.sample_size} {c.samples}</span>
                  </div>
                  {window.sample_size ? (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-muted">{c.winRate}</div>
                        <div className="mt-0.5 text-lg font-bold text-bull">{window.win_rate}%</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted">{c.avgReturn}</div>
                        <div className={cn("mt-0.5 text-lg font-bold", (window.average_return ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                          {(window.average_return ?? 0) >= 0 ? "+" : ""}{window.average_return}%
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                      <Clock3 className="h-4 w-4 text-warning" /> {window.status}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-4 text-subtle">{data.performance.methodology}</p>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 text-sm font-semibold text-heading">
                  <BarChart3 className="h-4 w-4 text-accent" /> {c.backtestTitle}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{c.backtestLead}</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-border bg-input/50 p-3">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-heading">
                    1. {c.chooseStocks} · {selectedTickers.length}/10
                  </div>
                  <button
                    onClick={() => {
                      const items = data.candidates.slice(0, 10);
                      setSelectedTickers(items.map((item) => item.ticker));
                      setSelectedNames(Object.fromEntries(items.map((item) => [item.ticker, item.name])));
                      setBacktest(null);
                    }}
                    className="text-[11px] text-accent hover:underline"
                  >
                    {c.quickAdd}
                  </button>
                </div>
                <div className="relative mt-2 max-w-xl">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
                  <input
                    value={stockQuery}
                    onChange={(event) => setStockQuery(event.target.value)}
                    placeholder={c.searchStock}
                    disabled={selectedTickers.length >= 10}
                    className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-heading outline-none focus:border-accent disabled:opacity-50"
                  />
                  {stockQuery.trim() ? (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-elevated shadow-xl">
                      {searchingStocks ? (
                        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />搜索中…</div>
                      ) : stockSuggestions.length ? stockSuggestions.map((stock) => (
                        <button
                          key={stock.ticker}
                          onClick={() => addStock(stock)}
                          disabled={selectedTickers.includes(stock.ticker)}
                          className="flex w-full items-center justify-between border-b border-border/50 px-3 py-2 text-left text-xs last:border-0 hover:bg-accent/10 disabled:opacity-40"
                        >
                          <span className="font-semibold text-heading">{stock.name}</span>
                          <span className="text-muted">{stock.ticker}</span>
                        </button>
                      )) : (
                        <div className="px-3 py-3 text-xs text-muted">{c.noMatch}</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="mt-1 text-[10px] text-muted">{c.searchHint}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedTickers.map((ticker) => (
                    <span key={ticker} className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] text-heading">
                      <span className="font-semibold">{selectedNames[ticker] ?? ticker}</span>
                      <span className="text-muted">{ticker}</span>
                      <button onClick={() => removeStock(ticker)} aria-label={`移除 ${selectedNames[ticker] ?? ticker}`} className="ml-1 text-muted hover:text-bear">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {!selectedTickers.length ? <span className="text-xs text-warning">{c.needStock}</span> : null}
                </div>
              </div>
              <div className="mt-4">
                <div className="text-xs font-semibold text-heading">2. {c.choosePeriod}</div>
                <div className="mt-2 inline-flex rounded-lg border border-border bg-surface p-1">
                  {[1, 3, 5].map((years) => (
                    <button
                      key={years}
                      onClick={() => { setBacktestYears(years); setBacktest(null); }}
                      className={cn(
                        "rounded-md px-4 py-1.5 text-xs font-semibold",
                        backtestYears === years ? "bg-accent text-white" : "text-muted"
                      )}
                    >
                      {years}年
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={runBacktest}
              disabled={backtestLoading || !selectedTickers.length}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50 sm:w-auto"
            >
              {backtestLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{c.backtesting}</>
                : <><BarChart3 className="h-3.5 w-3.5" />3. {c.startCheck}</>}
            </button>
            {backtestError ? (
              <div className="mt-4 rounded-lg border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">
                {backtestError}
              </div>
            ) : backtest ? (
              <div className="mt-4 space-y-4">
                {(() => {
                  const main = backtest.windows.find((window) => window.trading_days === 20) ?? backtest.windows[0];
                  const reliability = main.sample_size >= 100
                    ? c.reliabilityHigh
                    : main.sample_size >= 30 ? c.reliabilityMedium : c.reliabilityLow;
                  const conclusion = main.sample_size < 20
                    ? c.sampleLow
                    : (main.average_return ?? 0) > 0 && (main.median_return ?? 0) <= 0
                      ? c.outlierDriven
                      : (main.average_return ?? 0) > 0 && (main.median_return ?? 0) > 0 && (main.positive_rate ?? 0) >= 50
                        ? c.promising
                        : c.weak;
                  return (
                    <div className="rounded-xl border border-accent/30 bg-accent/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-heading">{c.conclusion}</div>
                        <span className="rounded-full bg-surface/70 px-2 py-1 text-[10px] text-muted">
                          {c.reliability}：{reliability}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-body">{conclusion}</p>
                      <p className="mt-1 text-[10px] leading-4 text-muted">{c.readFirst}</p>
                    </div>
                  );
                })()}
                <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                  <span className="rounded-full bg-border/40 px-2.5 py-1">{backtest.years}年</span>
                  <span className="rounded-full bg-border/40 px-2.5 py-1">{backtest.universe.length} {c.stocks}</span>
                  <span className="rounded-full bg-border/40 px-2.5 py-1">{backtest.signals} {c.signals}</span>
                  <span className="rounded-full bg-border/40 px-2.5 py-1">{backtest.transaction_cost_pct}% {c.costIncluded}</span>
                  <span className="rounded-full bg-border/40 px-2.5 py-1">{backtest.slippage_pct}% {c.slippageIncluded}</span>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-heading">{c.includedStocks}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {backtest.universe.map((ticker) => (
                      <span key={ticker} className="rounded-md bg-border/30 px-2 py-1 text-[10px] text-muted">
                        {backtest.stock_names[ticker] ?? ticker} · {ticker}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {backtest.windows.map((window) => (
                    <div key={window.trading_days} className="rounded-lg border border-border bg-input/70 p-3">
                      <div className="text-xs font-semibold text-heading">{window.trading_days}日持有</div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-[10px] text-muted">{c.positiveRate}</div>
                          <div className="mt-1 text-sm font-bold text-heading">{window.positive_rate ?? "—"}%</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted">{c.avgReturn}</div>
                          <div className={cn("mt-1 text-sm font-bold", (window.average_return ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                            {window.average_return ?? "—"}%
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted">{c.medianReturn}</div>
                          <div className="mt-1 text-sm font-bold text-heading">{window.median_return ?? "—"}%</div>
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-subtle">
                        n={window.sample_size}
                        {" · "}{c.benchmarkReturn} {window.benchmark_return ?? "—"}%
                        {" · "}{c.excessReturn} {window.excess_return ?? "—"}%
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg bg-bull/10 p-3"><div className="text-muted">{c.portfolioReturn}</div><div className="mt-1 font-bold text-bull">{backtest.portfolio_return ?? "—"}%</div></div>
                  <div className="rounded-lg bg-border/25 p-3"><div className="text-muted">{c.annualizedReturn}</div><div className="mt-1 font-bold text-heading">{backtest.portfolio_annualized_return ?? "—"}%</div></div>
                  <div className="rounded-lg bg-border/25 p-3"><div className="text-muted">{c.benchmarkReturn}</div><div className="mt-1 font-bold text-heading">{backtest.benchmark?.return_pct ?? "—"}%</div></div>
                  <div className="rounded-lg bg-accent/10 p-3"><div className="text-muted">{c.excessReturn}</div><div className="mt-1 font-bold text-accent">{backtest.benchmark?.excess_return_pct ?? "—"}%</div></div>
                  <div className="rounded-lg bg-border/25 p-3"><div className="text-muted">{c.maxDrawdown}</div><div className="mt-1 font-bold text-heading">{backtest.max_drawdown ?? "—"}%</div></div>
                  <div className="rounded-lg bg-bull/10 p-3"><div className="text-muted">{c.targetFirst}</div><div className="mt-1 font-bold text-bull">{backtest.target_first_rate ?? "—"}%</div></div>
                  <div className="rounded-lg bg-bear/10 p-3"><div className="text-muted">{c.stopFirst}</div><div className="mt-1 font-bold text-bear">{backtest.stop_first_rate ?? "—"}%</div></div>
                  <div className="rounded-lg bg-border/25 p-3"><div className="text-muted">{c.avgReturn}</div><div className="mt-1 font-bold text-heading">{backtest.average_trade_return ?? "—"}%</div></div>
                </div>
                <div className="rounded-lg border border-border bg-input/50 px-3 py-2 text-[11px] leading-5 text-muted">
                  <span className="font-semibold text-heading">{c.executionRules}：</span>
                  {backtest.execution_stats.suspended + backtest.execution_stats.limit_locked} {c.blockedTrades}
                  {" · "}{c.fundamentalsCoverage} {backtest.fundamentals_coverage_pct}%
                </div>
                <section>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-heading">{c.tradeHistory}</h3>
                      <p className="mt-1 text-[10px] leading-4 text-muted">{c.tradeHistoryLead}</p>
                    </div>
                    <span className="text-[11px] text-muted">
                      {filteredTrades.length === backtest.trades.length
                        ? `${backtest.trades.length} ${c.signals}`
                        : `${filteredTrades.length} ${c.filteredSignals} / ${backtest.trades.length}`}
                    </span>
                  </div>
                  {backtest.trades.length ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-2 rounded-xl border border-border bg-surface/60 p-3 sm:grid-cols-4">
                        <select
                          aria-label={c.filterStock}
                          value={tradeTicker}
                          onChange={(event) => { setTradeTicker(event.target.value); setShowAllTrades(false); }}
                          className="min-w-0 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-heading outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="">{c.filterStock}</option>
                          {backtest.universe.map((ticker) => (
                            <option key={ticker} value={ticker}>{backtest.stock_names[ticker] ?? ticker} · {ticker}</option>
                          ))}
                        </select>
                        <select
                          aria-label={c.filterResult}
                          value={tradeResult}
                          onChange={(event) => { setTradeResult(event.target.value); setShowAllTrades(false); }}
                          className="min-w-0 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-heading outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="">{c.filterResult}</option>
                          <option value="profit">{c.resultProfit}</option>
                          <option value="loss">{c.resultLoss}</option>
                          <option value="open">{c.resultOpen}</option>
                        </select>
                        <select
                          aria-label={c.filterYear}
                          value={tradeYear}
                          onChange={(event) => { setTradeYear(event.target.value); setShowAllTrades(false); }}
                          className="min-w-0 rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-heading outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="">{c.filterYear}</option>
                          {tradeYears.map((year) => <option key={year} value={year}>{year}</option>)}
                        </select>
                        <button
                          onClick={exportTradesCsv}
                          disabled={!filteredTrades.length}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-accent/40 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Download className="h-3.5 w-3.5" /> {c.exportCsv}
                        </button>
                      </div>
                      {(showAllTrades ? filteredTrades : filteredTrades.slice(0, 8)).map((trade) => (
                        <article key={`${trade.ticker}-${trade.entry_date}`} className="rounded-xl border border-border bg-input/60 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-semibold text-heading">{trade.name} <span className="font-normal text-muted">{trade.ticker}</span></div>
                              <div className="mt-1 text-[10px] text-muted">{c.signalDay}：{trade.signal_date}</div>
                            </div>
                            <div className="text-right">
                              <div className={cn("text-base font-bold", trade.return_pct >= 0 ? "text-bull" : "text-bear")}>
                                {trade.return_pct >= 0 ? "+" : ""}{trade.return_pct}%
                              </div>
                              <div className="text-[10px] text-muted">{trade.exit_reason_label}</div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                            <div className="rounded-lg bg-surface p-2.5">
                              <div className="text-[10px] text-muted">{c.buyDay}</div>
                              <div className="mt-1 text-xs font-semibold text-heading">{trade.entry_date}</div>
                              <div className="mt-0.5 text-xs text-body">{c.buyPrice} ¥{trade.entry_price}</div>
                            </div>
                            <ArrowRight className="hidden h-4 w-4 text-muted sm:block" />
                            <div className="rounded-lg bg-surface p-2.5">
                              <div className="text-[10px] text-muted">
                                {trade.exit_reason === "open" ? c.latestDay : c.sellDay} · {c.held}{trade.holding_days}{c.days}
                              </div>
                              <div className="mt-1 text-xs font-semibold text-heading">{trade.exit_date}</div>
                              <div className="mt-0.5 text-xs text-body">
                                {trade.exit_reason === "open" ? c.latestPrice : c.sellPrice} ¥{trade.exit_price}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {[5, 20, 60].map((days) => {
                              const outcome = trade.forward_outcomes.find((item) => item.trading_days === days);
                              return (
                                <div key={days} className="rounded-lg border border-border/60 px-2 py-2">
                                  <div className="text-[10px] font-semibold text-heading">{days}日后</div>
                                  {outcome ? (
                                    <>
                                      <div className="mt-1 text-[10px] text-muted">{outcome.date}</div>
                                      <div className="mt-0.5 text-[10px] text-body">¥{outcome.price}</div>
                                      <div className={cn("mt-0.5 text-xs font-bold", outcome.return_pct >= 0 ? "text-bull" : "text-bear")}>
                                        {outcome.return_pct >= 0 ? "+" : ""}{outcome.return_pct}%
                                      </div>
                                    </>
                                  ) : <div className="mt-2 text-[10px] text-subtle">数据未满</div>}
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      ))}
                      {!filteredTrades.length ? (
                        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-3 text-xs text-muted">
                          {c.noFilteredTrades}
                        </div>
                      ) : null}
                      {filteredTrades.length > 8 ? (
                        <button
                          onClick={() => setShowAllTrades((value) => !value)}
                          className="w-full rounded-lg border border-border py-2 text-xs font-semibold text-accent hover:bg-accent/5"
                        >
                          {showAllTrades ? c.showLess : `${c.showAll}（${filteredTrades.length}）`}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-3 text-xs text-muted">{c.noTrades}</div>
                  )}
                </section>
                <details className="rounded-lg border border-border px-3 py-2 text-xs text-muted">
                  <summary className="cursor-pointer font-semibold text-heading">{c.backtestLimits}</summary>
                  <p className="mt-2 leading-5">{backtest.methodology}</p>
                  <ul className="mt-2 space-y-1 leading-5">
                    {backtest.limitations.map((item) => <li key={item}>· {item}</li>)}
                  </ul>
                </details>
              </div>
            ) : null}
          </section>

          <div className="rounded-xl border border-border bg-surface/60 px-4 py-3 text-xs leading-5 text-muted">
            <div>{data.methodology}</div>
            <div>
              {data.universe_size} {c.pool} · {data.eligible_size} {c.eligible}
              {" · "}{Object.keys(groupedCandidates).length} {c.industries}
              {" · "}{new Date(data.as_of).toLocaleString()}
            </div>
          </div>

          {Object.entries(groupedCandidates).map(([industry, items]) => (
            <section key={industry} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-heading">{industry}</h2>
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                  {items.length}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              {items.map((item) => {
                const index = data.candidates.findIndex((candidate) => candidate.ticker === item.ticker);
                const scores = Object.values(item.score_breakdown);
                return (
              <article key={item.ticker} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-accent">#{index + 1}</span>
                      <h2 className="font-semibold text-heading">{item.name}</h2>
                      <span className="text-xs text-muted">{item.ticker}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      ¥{item.price.toFixed(2)} · {item.change_pct >= 0 ? "+" : ""}{item.change_pct.toFixed(2)}%
                      {" · "}{(item.amount / 1e8).toFixed(1)}亿
                    </div>
                    <div className={cn(
                      "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      item.trade_plan.signal === "consider"
                        ? "bg-bull/15 text-bull"
                        : item.trade_plan.signal === "wait"
                          ? "bg-warning/15 text-warning"
                          : "bg-accent/15 text-accent"
                    )}>
                      {item.trade_plan.signal === "consider" ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                      {item.trade_plan.signal_label}
                    </div>
                  </div>
                  <div className="rounded-lg bg-accent/10 px-3 py-2 text-center">
                    <div className="text-[10px] text-muted">{c.score}</div>
                    <div className="text-xl font-bold text-accent">{item.score}</div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-accent/20 bg-accent/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-heading">
                    <Lightbulb className="h-3.5 w-3.5 text-accent" /> {c.thesis}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-body">{item.thesis}</p>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="rounded-lg bg-border/25 p-2.5">
                    <div className="text-[10px] text-muted">{c.entry}</div>
                    <div className="mt-1 text-xs font-semibold text-heading">¥{item.trade_plan.entry_low}–{item.trade_plan.entry_high}</div>
                  </div>
                  <div className="rounded-lg bg-bull/10 p-2.5">
                    <div className="flex items-center gap-1 text-[10px] text-muted"><Target className="h-3 w-3" />{c.target}</div>
                    <div className="mt-1 text-xs font-semibold text-bull">¥{item.trade_plan.target_price} · +{item.trade_plan.expected_upside_pct}%</div>
                  </div>
                  <div className="rounded-lg bg-bear/10 p-2.5">
                    <div className="flex items-center gap-1 text-[10px] text-muted"><ShieldCheck className="h-3 w-3" />{c.stop}</div>
                    <div className="mt-1 text-xs font-semibold text-bear">¥{item.trade_plan.stop_price} · -{item.trade_plan.max_risk_pct}%</div>
                  </div>
                  <div className="rounded-lg bg-border/25 p-2.5">
                    <div className="text-[10px] text-muted">{c.horizon}</div>
                    <div className="mt-1 text-xs font-semibold text-heading">{item.trade_plan.holding_period}</div>
                  </div>
                  <div className="rounded-lg bg-border/25 p-2.5">
                    <div className="text-[10px] text-muted">{c.rr}</div>
                    <div className="mt-1 text-xs font-semibold text-heading">{item.trade_plan.reward_risk_ratio}:1</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  {scores.map((score, i) => (
                    <div key={c.breakdown[i]} className="rounded-lg bg-border/25 px-2 py-2 text-center">
                      <div className="text-[10px] text-muted">{c.breakdown[i]}</div>
                      <div className="text-sm font-semibold text-heading">{score}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 rounded-lg border border-border px-3 py-2 text-xs leading-5 text-muted">
                  <span className="font-semibold text-heading">{c.discipline}：</span>
                  {item.trade_plan.position_hint}。{item.trade_plan.invalidation}。
                </div>

                <div className="mt-4 grid gap-4 text-xs leading-5 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 font-semibold text-heading">{c.reason}</div>
                    <ul className="space-y-1 text-body">
                      {item.reasons.map((reason) => <li key={reason}>· {reason}</li>)}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-1 font-semibold text-heading">
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" /> {c.risk}
                    </div>
                    <ul className="space-y-1 text-muted">
                      {item.risks.map((risk) => <li key={risk}>· {risk}</li>)}
                    </ul>
                  </div>
                </div>

                <Link
                  href={`/?ticker=${item.ticker}&market=CN&mode=quick&run=1`}
                  className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                >
                  {c.analyze} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </article>
                );
              })}
            </section>
          ))}

          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-5 text-muted">
            {data.disclaimer}
          </div>
        </div>
      ) : null}
    </main>
  );
}
