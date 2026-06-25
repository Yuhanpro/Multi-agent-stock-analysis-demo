// Page-view tracking: a stable per-browser anon id + a fire-and-forget beacon.
import { trackEvent } from "./api";

const KEY = "stock-web:anon";

function anonId(): string {
  if (typeof window === "undefined") return "";
  let id = "";
  try {
    id = window.localStorage.getItem(KEY) || "";
  } catch {}
  if (!id) {
    try {
      id = crypto.randomUUID();
    } catch {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    try {
      window.localStorage.setItem(KEY, id);
    } catch {}
  }
  return id;
}

export function track(path: string): void {
  const id = anonId();
  if (id) trackEvent(id, path);
}
