"use client";

import { useState } from "react";
import { Paintbrush, RotateCcw, Copy, X } from "lucide-react";
import { cn } from "@/lib/format";
import { DEFAULT_THEME, hexToHsl, hslToHex, type Density, type FontPreset, type ThemeConfig, useThemeEditor } from "@/lib/theme";

const GROUPS: Array<{ title: string; fields: Array<[keyof ThemeConfig, string]> }> = [
  {
    title: "背景层",
    fields: [["bg", "页面"], ["surface", "卡片"], ["elevated", "浮层"], ["input", "输入框"]],
  },
  {
    title: "页面文字",
    fields: [["heading", "标题"], ["body", "正文"], ["muted", "说明"], ["subtle", "弱文字"]],
  },
  {
    title: "分析报告文字",
    fields: [["reportHeading", "报告标题"], ["reportBody", "报告正文"], ["reportMuted", "报告弱字"], ["reportAccent", "报告强调"]],
  },
  {
    title: "边界与图表",
    fields: [["border", "边框"], ["borderStrong", "强边框"], ["chartGrid", "图表网格"], ["chartTooltip", "图表浮层"]],
  },
  {
    title: "语义色",
    fields: [["accent", "主色"], ["bull", "涨色"], ["bear", "跌色"]],
  },
];

export function ThemeEditor() {
  const { theme, patchTheme, resetTheme, copyTheme } = useThemeEditor();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyTheme();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full",
          "border border-border bg-elevated/95 px-3 py-2 text-xs font-mono text-heading shadow-lg",
          "hover:border-accent/60 hover:text-accent transition-colors"
        )}
      >
        <Paintbrush className="h-3.5 w-3.5" />
        Theme
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/35 p-3 sm:p-5">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-heading">本地主题编辑器</div>
                <div className="text-[11px] text-subtle">只保存在当前浏览器,不影响其他访客</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-heading">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[74vh] overflow-y-auto px-4 py-4 space-y-5">
              {GROUPS.map((group) => (
                <section key={group.title} className="space-y-2">
                  <div className="text-xs font-medium text-muted">{group.title}</div>
                  <div className="grid grid-cols-2 gap-3">
                    {group.fields.map(([key, label]) => (
                      <ColorField
                        key={key}
                        label={label}
                        value={String(theme[key])}
                        onChange={(v) => patchTheme({ [key]: v } as Partial<ThemeConfig>)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted">圆角</div>
                  <input
                    type="range"
                    min={2}
                    max={26}
                    value={parseInt(theme.radius, 10) || 10}
                    onChange={(e) => patchTheme({ radius: `${e.target.value}px` })}
                    className="w-full accent-accent"
                  />
                  <div className="text-[11px] text-subtle font-mono">{theme.radius}</div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted">页面密度</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["compact", "normal", "spacious"] as Density[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => patchTheme({ density: d })}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-xs capitalize transition-colors",
                          theme.density === d
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted hover:text-heading"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted">字体</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["system", "neo", "serif", "mono"] as FontPreset[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => patchTheme({ font: f })}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-xs capitalize transition-colors",
                        theme.font === f
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border text-muted hover:text-heading"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-bg/40 p-3 space-y-2">
                <div className="text-xs text-muted">预览</div>
                <div className="rounded-lg border border-border bg-elevated p-3">
                  <div className="text-sm font-semibold text-heading">页面标题示例</div>
                  <div className="mt-1 text-xs text-body">这是页面正文颜色。</div>
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="text-sm font-semibold text-report-heading">报告标题示例</div>
                    <div className="mt-1 text-xs text-report-body">这是分析报告正文颜色。</div>
                    <div className="mt-1 text-xs text-report-muted">这是报告弱文字。</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-accent/15 px-2 py-1 text-[11px] text-accent">accent</span>
                    <span className="rounded-full bg-bull/15 px-2 py-1 text-[11px] text-bull">bull</span>
                    <span className="rounded-full bg-bear/15 px-2 py-1 text-[11px] text-bear">bear</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={resetTheme}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-heading"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-heading"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy JSON"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/85"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = hslToHex(value || DEFAULT_THEME.accent);
  return (
    <label className="space-y-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-2 py-1.5">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(hexToHsl(e.target.value))}
          className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[11px] font-mono text-heading outline-none"
        />
      </div>
    </label>
  );
}
