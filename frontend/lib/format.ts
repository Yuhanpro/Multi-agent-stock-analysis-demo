import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNumber(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 1e12) return (v / 1e12).toFixed(digits) + "T";
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(digits) + "B";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(digits) + "M";
  if (Math.abs(v) >= 1e3) return v.toLocaleString(undefined, { maximumFractionDigits: digits });
  return v.toFixed(digits);
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(digits)}%`;
}

export function fmtPrice(v: number | null | undefined, currency?: string | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sym = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  return `${sym}${v.toFixed(2)}`;
}
