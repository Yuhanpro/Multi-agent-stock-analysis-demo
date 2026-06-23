// API base URL for the FastAPI backend. Defaults to localhost:8000 for dev;
// override with NEXT_PUBLIC_API_BASE in .env.local or at build time.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export type Market = "US" | "CN" | "HK";
export type AnalysisMode = "snapshot" | "quick" | "serenity" | "debate";

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Fundamentals {
  name: string | null;
  sector: string | null;
  market_cap: number | null;
  pe: number | null;
  pb: number | null;
  dividend_yield: number | null;
  revenue_yoy: number | null;
  net_income_yoy: number | null;
  eps: number | null;
  revenue: number | null;
  net_income: number | null;
  roe: number | null;
  roa: number | null;
  gross_margin: number | null;
  net_margin: number | null;
  debt_asset_ratio: number | null;
  currency: string | null;
  source_detail: string | null;
}

export interface RealtimeQuote {
  current_price: number | null;
  open: number | null;
  prev_close: number | null;
  day_high: number | null;
  day_low: number | null;
  volume: number | null;
  amount: number | null;
  turnover_rate: number | null;
  amplitude: number | null;
  change_pct: number | null;
  bid: number | null;
  ask: number | null;
  timestamp: string | null;
  source: string | null;
}

export interface Snapshot {
  ticker: string;
  market: Market;
  price: number | null;
  change_pct: number | null;
  ohlcv: OHLCV[];
  fundamentals: Fundamentals;
  realtime: RealtimeQuote | null;
  source: string;
}

export interface WatchlistItem {
  ticker: string;
  market: Market;
  enabled: boolean;
  modes: AnalysisMode[];
  note: string;
}

export interface SymbolSuggestion {
  ticker: string;
  market: Market;
  name: string;
  aliases: string[];
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export async function fetchSnapshot(
  ticker: string,
  market: Market
): Promise<Snapshot> {
  const url = `${API_BASE}/api/snapshot?ticker=${encodeURIComponent(
    ticker
  )}&market=${market}`;
  return readJsonOrThrow(await fetch(url));
}

export async function searchSymbols(
  q: string,
  market: Market | "ALL" = "ALL",
  limit = 8
): Promise<SymbolSuggestion[]> {
  const url = `${API_BASE}/api/symbol-search?q=${encodeURIComponent(q)}&market=${market}&limit=${limit}`;
  return readJsonOrThrow(await fetch(url));
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/watchlist`));
}

export async function addWatchlistItem(item: WatchlistItem): Promise<WatchlistItem[]> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    })
  );
}

export async function patchWatchlistItem(
  item: Pick<WatchlistItem, "ticker" | "market">,
  patch: Partial<Omit<WatchlistItem, "ticker" | "market">>
): Promise<WatchlistItem[]> {
  const url = `${API_BASE}/api/watchlist/${encodeURIComponent(item.ticker)}?market=${item.market}`;
  return readJsonOrThrow(
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function deleteWatchlistItem(item: Pick<WatchlistItem, "ticker" | "market">): Promise<WatchlistItem[]> {
  const url = `${API_BASE}/api/watchlist/${encodeURIComponent(item.ticker)}?market=${item.market}`;
  return readJsonOrThrow(await fetch(url, { method: "DELETE" }));
}
