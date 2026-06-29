// Non-React token storage shared by api.ts, sse.ts, and the auth context.
// The token is a Bearer JWT-style string kept in localStorage. Over Stage A's
// plain HTTP it is sniffable on the wire — acceptable for a demo.

const KEY = "stock-web:token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {}
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}

// Stable per-browser anonymous id (same key as analytics). Lets personal
// features (watchlist, paper trading) work without an account, keyed server-side
// to a shadow user; the Bearer token (when present) takes precedence.
function anonId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem("stock-web:anon") || "";
  } catch {
    return "";
  }
}

export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  const a = anonId();
  if (a) h["X-Anon-Id"] = a;
  return h;
}
