// API base URL for the FastAPI backend. Defaults to localhost:8000 for dev;
// override with NEXT_PUBLIC_API_BASE in .env.local or at build time.
import { authHeaders } from "./token";

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
  return readJsonOrThrow(await fetch(`${API_BASE}/api/watchlist`, { headers: authHeaders() }));
}

export async function addWatchlistItem(item: WatchlistItem): Promise<WatchlistItem[]> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    })
  );
}

export async function deleteWatchlistItem(item: Pick<WatchlistItem, "ticker" | "market">): Promise<WatchlistItem[]> {
  const url = `${API_BASE}/api/watchlist/${encodeURIComponent(item.ticker)}?market=${item.market}`;
  return readJsonOrThrow(await fetch(url, { method: "DELETE", headers: authHeaders() }));
}

// ---------- auth + reports --------------------------------------------------

export interface User {
  id: number;
  email: string;
  created_at: string;
  is_admin: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ReportMeta {
  id: string;
  ticker: string;
  market: Market;
  mode: AnalysisMode;
  language: string;
  title: string;
  decision: string | null;
  cost_usd: number;
  created_at: string;
  is_public: boolean;
}

export interface Report extends ReportMeta {
  content: string;
}

export async function registerApi(email: string, password: string, inviteCode?: string): Promise<AuthResponse> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, invite_code: inviteCode || null }),
    })
  );
}

export async function loginApi(email: string, password: string): Promise<AuthResponse> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  );
}

export async function fetchMe(): Promise<User> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() }));
}

export async function fetchReports(): Promise<ReportMeta[]> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/reports`, { headers: authHeaders() }));
}

export async function fetchReport(id: string): Promise<Report> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}`, { headers: authHeaders() }));
}

export async function deleteReport(id: string): Promise<{ ok: boolean }> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() })
  );
}

export async function shareReport(id: string, isPublic: boolean): Promise<Report> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ public: isPublic }),
    })
  );
}

export async function fetchPublicReport(id: string): Promise<Report> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/public/reports/${encodeURIComponent(id)}`));
}

// ---------- financials ------------------------------------------------------

export interface FinPeriod {
  period: string;
  end_date: string;
  is_annual: boolean;
  revenue: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  net_income: number | null;
  eps: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  total_equity: number | null;
  cash: number | null;
  total_debt: number | null;
  operating_cash_flow: number | null;
  capex: number | null;
  free_cash_flow: number | null;
}

export interface Financials {
  ticker: string;
  market: Market;
  currency: string | null;
  annual: FinPeriod[];
  quarterly: FinPeriod[];
  ratios: Record<string, number | null>;
  source: string;
}

export async function fetchFinancials(ticker: string, market: Market): Promise<Financials> {
  const url = `${API_BASE}/api/financials?ticker=${encodeURIComponent(ticker)}&market=${market}`;
  return readJsonOrThrow(await fetch(url));
}

// ---------- market overview -------------------------------------------------

export interface HotIndustry {
  name: string;
  change_pct: number | null;
  amount: number | null;
  num_companies: number | null;
  leader_name: string | null;
  leader_change: number | null;
}

export interface HotCompany {
  code: string;
  name: string;
  market: Market;
  price: number | null;
  change_pct: number | null;
  amount: number | null;
}

export interface SiteTop {
  ticker: string;
  market: Market;
  count: number;
}

export interface MarketOverview {
  hot_industries: HotIndustry[];
  hot_companies: HotCompany[];
  site_top: SiteTop[];
  source: string;
}

export async function fetchMarketOverview(market: Market = "CN"): Promise<MarketOverview> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/market-overview?market=${market}`));
}

// ---------- admin + tracking ------------------------------------------------

export interface InviteCode {
  code: string;
  note: string;
  max_uses: number;
  uses: number;
  active: boolean;
  created_at: string;
}

export interface PathHit { path: string; count: number; }
export interface DailyPoint { date: string; views: number; visitors: number; runs: number; signups: number; cost: number; }
export interface ModeCount { mode: string; count: number; }
export interface TickerHit { ticker: string; market: Market; count: number; }
export interface SignupPoint { date: string; count: number; }
export interface HourPoint { hour: number; count: number; }
export interface UserActivity { email: string; runs: number; last_seen: string | null; }

export interface AdminStats {
  total_views: number;
  today_views: number;
  total_visitors: number;
  today_visitors: number;
  total_users: number;
  top_paths: PathHit[];
  daily: DailyPoint[];
  runs_total: number;
  cost_total: number;
  runs_by_mode: ModeCount[];
  top_tickers: TickerHit[];
  clicks_by_mode: ModeCount[];
  invites_total: number;
  invites_used: number;
  invites_active: number;
  new_today: number;
  returning_today: number;
  signups_daily: SignupPoint[];
  hourly: HourPoint[];
  top_users: UserActivity[];
}

export interface SessionPath {
  anon_id: string;
  last_seen: string;
  user_email: string | null;
  paths: string[];
}

export async function fetchInvites(): Promise<InviteCode[]> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/admin/invites`, { headers: authHeaders() }));
}

export async function createInvites(count: number, note: string, max_uses: number): Promise<InviteCode[]> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/admin/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ count, note, max_uses }),
    })
  );
}

export async function revokeInvite(code: string): Promise<{ ok: boolean }> {
  return readJsonOrThrow(
    await fetch(`${API_BASE}/api/admin/invites/${encodeURIComponent(code)}`, { method: "DELETE", headers: authHeaders() })
  );
}

export async function fetchAdminStats(): Promise<AdminStats> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/admin/stats`, { headers: authHeaders() }));
}

export async function fetchAdminPaths(): Promise<SessionPath[]> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/admin/paths`, { headers: authHeaders() }));
}

// ---------- funds -----------------------------------------------------------

export interface NavPoint { date: string; nav: number | null; growth: number | null; }
export interface FundHolding { ticker: string; name: string; pct: number | null; }
export interface FundRealtime {
  price: number | null;
  iopv: number | null;
  premium: number | null;
  change_pct: number | null;
  amount: number | null;
  updated: string | null;
}

export interface Fund {
  code: string;
  name: string;
  full_name: string | null;
  type: string | null;
  company: string | null;
  manager: string | null;
  scale: string | null;
  inception: string | null;
  benchmark: string | null;
  strategy: string | null;
  nav: NavPoint[];
  holdings: FundHolding[];
  holdings_quarter: string | null;
  returns: Record<string, number | null>;
  max_drawdown: number | null;
  is_etf: boolean;
  realtime: FundRealtime | null;
  source: string;
}

export interface FundSuggestion { code: string; name: string; type: string | null; }

export async function fetchFund(code: string): Promise<Fund> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/fund?code=${encodeURIComponent(code)}`));
}

export async function searchFunds(q: string, limit = 12): Promise<FundSuggestion[]> {
  return readJsonOrThrow(await fetch(`${API_BASE}/api/fund-search?q=${encodeURIComponent(q)}&limit=${limit}`));
}

export function trackEvent(anonId: string, path: string): void {
  // Fire-and-forget; never block navigation or throw.
  try {
    fetch(`${API_BASE}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ anon_id: anonId, path }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
