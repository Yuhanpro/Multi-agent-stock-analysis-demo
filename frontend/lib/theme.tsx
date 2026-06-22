"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Density = "compact" | "normal" | "spacious";
export type FontPreset = "system" | "neo" | "serif" | "mono";

export interface ThemeConfig {
  bg: string;
  surface: string;
  elevated: string;
  input: string;
  border: string;
  borderStrong: string;
  heading: string;
  body: string;
  muted: string;
  subtle: string;
  reportHeading: string;
  reportBody: string;
  reportMuted: string;
  reportAccent: string;
  fg: string; // legacy alias kept for older saved themes / existing classes
  accent: string;
  bull: string;
  bear: string;
  chartGrid: string;
  chartTooltip: string;
  radius: string;
  density: Density;
  font: FontPreset;
}

export const DEFAULT_THEME: ThemeConfig = {
  // Graphite + steel-blue. Lower saturation, more editorial/terminal research
  // product than saturated blue SaaS dashboard.
  bg: "222 28% 5%",
  surface: "222 22% 9%",
  elevated: "222 19% 12%",
  input: "222 24% 7%",
  border: "220 15% 22%",
  borderStrong: "218 18% 32%",
  heading: "210 28% 98%",
  body: "214 16% 88%",
  muted: "218 10% 66%",
  subtle: "218 8% 48%",
  reportHeading: "208 24% 96%",
  reportBody: "212 14% 84%",
  reportMuted: "218 9% 60%",
  reportAccent: "202 84% 64%",
  fg: "214 16% 88%",
  accent: "202 84% 58%",
  bull: "148 58% 45%",
  bear: "2 62% 58%",
  chartGrid: "220 15% 22%",
  chartTooltip: "222 19% 12%",
  radius: "10px",
  density: "normal",
  font: "system",
};

const STORAGE_KEY = "stock-web:theme";

const CSS_VAR_MAP: Record<keyof ThemeConfig, string | null> = {
  bg: "--theme-bg",
  surface: "--theme-surface",
  elevated: "--theme-elevated",
  input: "--theme-input",
  border: "--theme-border",
  borderStrong: "--theme-border-strong",
  heading: "--theme-heading",
  body: "--theme-body",
  muted: "--theme-muted",
  subtle: "--theme-subtle",
  reportHeading: "--theme-report-heading",
  reportBody: "--theme-report-body",
  reportMuted: "--theme-report-muted",
  reportAccent: "--theme-report-accent",
  fg: "--theme-fg",
  accent: "--theme-accent",
  bull: "--theme-bull",
  bear: "--theme-bear",
  chartGrid: "--theme-chart-grid",
  chartTooltip: "--theme-chart-tooltip",
  radius: "--theme-radius",
  density: "--theme-density",
  font: "--theme-font-family",
};

interface ThemeCtx {
  theme: ThemeConfig;
  setTheme: (next: ThemeConfig) => void;
  patchTheme: (patch: Partial<ThemeConfig>) => void;
  resetTheme: () => void;
  copyTheme: () => Promise<void>;
}

const Ctx = createContext<ThemeCtx | null>(null);

function normalize(raw: unknown): ThemeConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_THEME;
  const o = raw as Partial<ThemeConfig>;
  const merged: ThemeConfig = {
    ...DEFAULT_THEME,
    ...o,
    // Back-compat: old themes only had fg/muted. Use fg as body if body missing.
    body: o.body ?? o.fg ?? DEFAULT_THEME.body,
    fg: o.fg ?? o.body ?? DEFAULT_THEME.fg,
    density: o.density === "compact" || o.density === "spacious" ? o.density : "normal",
    font: o.font === "neo" || o.font === "serif" || o.font === "mono" ? o.font : "system",
  };
  return merged;
}

function applyTheme(t: ThemeConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [key, varName] of Object.entries(CSS_VAR_MAP) as Array<[keyof ThemeConfig, string | null]>) {
    if (!varName) continue;
    const value = key === "density" ? densityScale(t.density)
      : key === "font" ? fontStack(t.font)
      : t[key];
    root.style.setProperty(varName, String(value));
  }
}

function densityScale(d: Density) {
  if (d === "compact") return "0.88";
  if (d === "spacious") return "1.12";
  return "1";
}

function fontStack(f: FontPreset) {
  if (f === "neo") return "ui-sans-serif, Inter, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif";
  if (f === "serif") return "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif";
  if (f === "mono") return "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
  return "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeConfig>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : DEFAULT_THEME;
      const next = normalize(parsed);
      setThemeState(next);
      applyTheme(next);
    } catch {
      applyTheme(DEFAULT_THEME);
    }
  }, []);

  function setTheme(next: ThemeConfig) {
    const normalized = normalize(next);
    setThemeState(normalized);
    applyTheme(normalized);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2)); } catch {}
  }

  function patchTheme(patch: Partial<ThemeConfig>) {
    setTheme({ ...theme, ...patch });
  }

  function resetTheme() {
    setTheme(DEFAULT_THEME);
  }

  async function copyTheme() {
    const text = JSON.stringify(theme, null, 2);
    await navigator.clipboard.writeText(text);
  }

  const value = useMemo(() => ({ theme, setTheme, patchTheme, resetTheme, copyTheme }), [theme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemeEditor() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemeEditor must be inside ThemeProvider");
  return ctx;
}

export function hslToHex(hsl: string): string {
  const [hRaw, sRaw, lRaw] = hsl.split(/\s+/);
  const h = Number(hRaw);
  const s = Number(sRaw?.replace("%", "")) / 100;
  const l = Number(lRaw?.replace("%", "")) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60) [r, g, b] = [c, x, 0];
  else if (60 <= h && h < 120) [r, g, b] = [x, c, 0];
  else if (120 <= h && h < 180) [r, g, b] = [0, c, x];
  else if (180 <= h && h < 240) [r, g, b] = [0, x, c];
  else if (240 <= h && h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return "#" + [r, g, b]
    .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0"))
    .join("");
}

export function hexToHsl(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
