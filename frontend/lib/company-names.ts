import type { Market } from "./api";

const US_NAMES: Record<string, string> = {
  AAPL: "Apple",
  NVDA: "NVIDIA",
  TSLA: "Tesla",
  MSFT: "Microsoft",
  GOOGL: "Alphabet",
  GOOG: "Alphabet",
  AMZN: "Amazon",
  META: "Meta",
  AMD: "AMD",
  AVGO: "Broadcom",
  SMCI: "Supermicro",
  TSM: "TSMC",
  ASML: "ASML",
};

const CN_NAMES: Record<string, string> = {
  "600519": "贵州茅台",
  "000001": "平安银行",
  "300750": "宁德时代",
  "600036": "招商银行",
  "601318": "中国平安",
  "000858": "五粮液",
  "002415": "海康威视",
  "600276": "恒瑞医药",
};

const HK_NAMES: Record<string, string> = {
  "00700": "腾讯控股",
  "09988": "阿里巴巴-W",
  "03690": "美团-W",
  "01810": "小米集团-W",
  "09888": "百度集团-SW",
  "09618": "京东集团-SW",
};

export function companyShortName(ticker: string, market: Market, fallback?: string | null): string {
  const key = market === "CN" ? ticker.padStart(6, "0") : market === "HK" ? ticker.replace(/^HK/i, "").padStart(5, "0") : ticker.toUpperCase();
  const mapped = market === "CN" ? CN_NAMES[key] : market === "HK" ? HK_NAMES[key] : US_NAMES[key];
  if (mapped) return mapped;
  if (fallback && fallback.toUpperCase() !== ticker.toUpperCase()) return fallback;
  return "";
}
