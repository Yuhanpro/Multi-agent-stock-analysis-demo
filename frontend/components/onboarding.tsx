"use client";

import { BarChart2, Clock, Coins, Flame, MessageCircleQuestion, MessagesSquare, PieChart, Sparkles, Star, Stethoscope, Wallet, X } from "lucide-react";
import { useT } from "@/lib/i18n";

/** First-visit onboarding modal. Content is inline-bilingual to keep i18n lean. */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const { lang } = useT();
  const zh = lang === "zh";

  const features: { icon: typeof BarChart2; tZh: string; tEn: string; zh: string; en: string }[] = [
    {
      icon: BarChart2, tZh: "股票分析", tEn: "Stock Analysis",
      zh: "输入代码(A股 600519 / 美股 AAPL / 港股 00700),四种模式:行情快照(免费)、巴菲特速评、Serenity 产业链、多智能体辩论。",
      en: "Enter a ticker (CN 600519 / US AAPL / HK 00700). Four modes: Snapshot (free), Buffett Quick, Serenity supply-chain, Multi-Agent Debate.",
    },
    {
      icon: MessageCircleQuestion, tZh: "多轮追问", tEn: "Follow-up chat",
      zh: "报告出来后继续追问(「估值贵吗」「最大风险」),AI 带着报告和实时行情连续回答。",
      en: "After a report, keep asking (\"is it expensive?\", \"biggest risk?\") — answered with the report + live data in context.",
    },
    {
      icon: PieChart, tZh: "基金", tEn: "Funds",
      zh: "搜名字或代码,覆盖 A股 + QDII海外 + 港股互认,看净值、重仓、ETF 溢价与 AI 点评,还能多只对比。",
      en: "Search by name/code — CN + overseas QDII + HK funds. NAV, holdings, ETF premium, AI review, side-by-side compare.",
    },
    {
      icon: Coins, tZh: "黄金", tEn: "Gold",
      zh: "国内金 + 国际金,分时/日/周/月 K 线,内外价差、ETF 持仓、技术面参考,每日/每周/每月 AI 复盘可追问。",
      en: "Domestic + international gold. K-line (intraday/day/week/month), spread, ETF holdings, technicals, daily/weekly/monthly AI recaps.",
    },
    {
      icon: Stethoscope, tZh: "持仓诊断", tEn: "Position Diagnosis",
      zh: "填你的买入成本,AI 给 加仓/持有/减仓/清仓 建议(基于前瞻价值)。",
      en: "Enter your cost basis → an add / hold / trim / sell call based on forward value.",
    },
    {
      icon: Flame, tZh: "市场热度", tEn: "Market Heat",
      zh: "指数、涨跌情绪、热门行业与活跃个股,加上按 A股/美股/港股分流的财经快讯。",
      en: "Indices, breadth, hot sectors & active names, plus market-filtered news (CN/US/HK).",
    },
    {
      icon: Star, tZh: "自选 + 对比", tEn: "Watchlist + Compare",
      zh: "收藏关注的票,并排比 PE/ROE/股息。无需登录,浏览器自动记住;登录后跨设备同步 + 存历史。",
      en: "Save tickers, compare PE/ROE/dividend. No sign-in needed (browser-remembered); sign in to sync + keep history.",
    },
    {
      icon: Wallet, tZh: "模拟盘", tEn: "Paper trading",
      zh: "¥100 万虚拟资金,按实时价买卖、跟踪盈亏,验证 AI 或自己的判断。同样无需登录。",
      en: "¥1,000,000 virtual cash — buy/sell at live prices, track P&L. Also works without sign-in.",
    },
    {
      icon: MessagesSquare, tZh: "建议反馈", tEn: "Feedback",
      zh: "想要的新功能在「建议反馈」里留言,我们都会看。",
      en: "Drop feature requests on the Feedback page — we read them all.",
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
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

        <div className="mt-4 grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={i} className="flex gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-heading">{zh ? f.tZh : f.tEn}</div>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{zh ? f.zh : f.en}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 space-y-1 rounded-lg border border-border/60 bg-bg/30 p-3 text-xs leading-5 text-muted">
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
