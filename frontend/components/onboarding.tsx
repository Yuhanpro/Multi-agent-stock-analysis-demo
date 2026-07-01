"use client";

import { BarChart2, Clock, Coins, Flame, MessageCircleQuestion, MessagesSquare, PieChart, Sparkles, Star, Stethoscope, Wallet, X } from "lucide-react";
import { useT } from "@/lib/i18n";

/** First-visit onboarding modal. Content is inline-bilingual to keep i18n lean. */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const { lang } = useT();
  const zh = lang === "zh";

  const features: { icon: typeof BarChart2; en: string; zh: string }[] = [
    {
      icon: BarChart2,
      zh: "「股票分析」输入代码(A股 600519 / 美股 AAPL / 港股 00700),选市场和模式:行情快照(免费最快,含财务概览趋势)、巴菲特速评(约30秒)、Serenity 产业链(约1分钟)、多智能体辩论(3–6分钟,出最终结论)。",
      en: "Stock Analysis — enter a ticker (CN 600519 / US AAPL / HK 00700), pick a market + mode: Snapshot (free, fastest, with the financial-trend overview), Buffett Quick (~30s), Serenity supply-chain (~1min), Multi-Agent Debate (3–6min, final verdict).",
    },
    {
      icon: MessageCircleQuestion,
      zh: "多轮追问(新):速评/Serenity/诊断出报告后,下方可继续对话提问(「估值贵吗」「最大风险」等),AI 带着报告和实时行情上下文连续回答。",
      en: "Follow-up chat (new): after a Quick / Serenity / Diagnosis report, keep asking below (\"is it expensive?\", \"biggest risk?\") — the AI answers with the report + live data in context.",
    },
    {
      icon: PieChart,
      zh: "基金(新):搜名字或代码(如「全球科技」「易方达」「摩根太平洋」),覆盖 A股公募 + QDII海外 + 香港互认基金,看净值曲线、重仓股、ETF 实时溢价与 AI 点评;还能「加入对比」多只基金并排比收益。",
      en: "Funds (new): search by name or code — CN funds + overseas QDII + HK mutual-recognition funds, with NAV curve, holdings, ETF realtime premium and an AI review; add several to compare side by side.",
    },
    {
      icon: Coins,
      zh: "黄金(新):独立「黄金」页,国内金(沪金 Au99.99,元/克)+ 国际金(COMEX,美元/盎司),K线可选 分时/日K/周K/月K,看内外价差与全球黄金 ETF 持仓;技术面参考(均线/RSI/MACD/布林 等客观状态,非买卖信号);每日 / 每周 / 每月 AI 复盘,还能就黄金继续追问。",
      en: "Gold (new): a dedicated Gold page — domestic (SGE Au99.99, ¥/g) + international (COMEX, $/oz), K-line by intraday/day/week/month, home-vs-abroad spread and global gold-ETF holdings; a technical reference (MA/RSI/MACD/Bollinger states — not buy/sell signals); daily / weekly / monthly AI recaps with follow-up chat.",
    },
    {
      icon: Stethoscope,
      zh: "持仓诊断:填你的买入成本,AI 给 加仓/持有/减仓/清仓 建议(基于前瞻价值,不劝你死等回本)。",
      en: "Position Diagnosis: enter your cost basis → an add/hold/trim/sell call based on forward value (not breaking even).",
    },
    {
      icon: Flame,
      zh: "市场热度:分「行业与指数」(指数、涨跌/涨停情绪、热门行业、活跃个股)和「财经新闻」(按 A股/美股/港股分流的实时快讯)两大模块。",
      en: "Market Heat: two modules — Indices & sectors (indices, breadth, hot industries, active names) and Market news (live headlines filtered by CN/US/HK).",
    },
    {
      icon: Star,
      zh: "自选 + 对比:收藏关注的票,「对比」视图并排比 PE/ROE/股息等——无需登录,浏览器自动记住;登录后可跨设备同步,分析还会自动存「历史」,可分享链接、导出长图。",
      en: "Watchlist + Compare: save tickers and compare PE/ROE/dividend side by side — no sign-in needed (remembered by your browser). Sign in to sync across devices; signed-in analyses are kept in History (shareable & exportable).",
    },
    {
      icon: Wallet,
      zh: "模拟盘:自选页「持仓」Tab,¥100 万虚拟资金,按实时价模拟买卖、跟踪持仓盈亏——验证 AI 的判断或自己的想法,不花真钱。同样无需登录(浏览器记住),登录后跨设备同步。",
      en: "Paper trading: the Portfolio tab on Watchlist — ¥1,000,000 virtual cash, buy/sell at live prices and track P&L. Also works without sign-in (browser-remembered); sign in to sync across devices.",
    },
    {
      icon: MessagesSquare,
      zh: "建议反馈:有想法或想要的新功能,在「建议反馈」里留言,我们都会看。",
      en: "Feedback: drop suggestions or feature requests on the Feedback page — we read them all.",
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-accent">
            <Sparkles className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-heading">{zh ? "欢迎使用 · 快速上手" : "Welcome · Quick start"}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-heading" aria-label="close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-sm leading-6 text-body">
          {zh
            ? "输入一只股票,让多个 AI 分析师帮你看基本面、估值、产业链并辩论出结论,还能继续追问。支持 A股 / 美股 / 港股 / 基金 / 黄金。"
            : "Enter a stock and let multiple AI analysts review fundamentals, valuation, supply chain, debate a conclusion — then ask follow-ups. CN / US / HK stocks, funds & gold supported."}
        </p>

        <div className="mt-4 space-y-3">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={i} className="flex gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p className="text-sm leading-6 text-body">{zh ? f.zh : f.en}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 space-y-1 rounded-lg border border-border/60 bg-bg/30 p-3 text-xs leading-5 text-muted">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {zh ? "A股首次加载会慢十几秒;辩论需 3–6 分钟,耐心等结论卡出现。每小时有次数上限。" : "CN first load takes ~10s; debate takes 3–6 min. Hourly rate limits apply."}
          </div>
          <div>
            {zh
              ? "无需注册即可体验全部功能(自选/模拟盘由浏览器记住);注册(需邀请码)可跨设备同步。研究 Demo,不构成投资建议;站点为 HTTP,请勿使用常用重要密码。"
              : "No sign-up needed to use everything (watchlist/paper are browser-remembered); registering (invite code) syncs across devices. Research demo — not investment advice. HTTP site — don't reuse an important password."}
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/85"
        >
          {zh ? "知道了,开始分析 →" : "Got it — start →"}
        </button>
      </div>
    </div>
  );
}
