"use client";

import { Languages } from "lucide-react";
import { useT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/format";

export function LanguageSwitcher() {
  const { lang, setLang, t } = useT();

  return (
    <div className="inline-flex items-center bg-surface border border-border rounded-lg overflow-hidden">
      <span className="pl-2.5 pr-1 text-muted">
        <Languages className="h-3.5 w-3.5" />
      </span>
      {(["en", "zh"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={cn(
            "px-2.5 py-1.5 text-xs font-medium transition-colors",
            lang === l
              ? "bg-accent text-white"
              : "text-muted hover:text-fg hover:bg-border/40"
          )}
        >
          {t(l === "en" ? "lang.switcher.en" : "lang.switcher.zh")}
        </button>
      ))}
    </div>
  );
}
