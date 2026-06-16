// API base URL for the FastAPI backend. Defaults to localhost:8000 for dev;
// override with NEXT_PUBLIC_API_BASE in .env.local or Vercel env.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export type Market = "US" | "CN";

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
  eps: number | null;
  currency: string | null;
}

export interface Snapshot {
  ticker: string;
  market: Market;
  price: number | null;
  change_pct: number | null;
  ohlcv: OHLCV[];
  fundamentals: Fundamentals;
  source: string;
}

export async function fetchSnapshot(
  ticker: string,
  market: Market
): Promise<Snapshot> {
  const url = `${API_BASE}/api/snapshot?ticker=${encodeURIComponent(
    ticker
  )}&market=${market}`;
  const res = await fetch(url);
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
