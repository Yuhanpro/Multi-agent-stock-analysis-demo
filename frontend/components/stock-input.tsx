"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import type { Market } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";

interface Props {
  defaultTicker?: string;
  defaultMarket?: Market;
  loading?: boolean;
  onSubmit: (ticker: string, market: Market) => void;
}

export function StockInput({
  defaultTicker = "AAPL",
  defaultMarket = "US",
  loading = false,
  onSubmit,
}: Props) {
  const { t } = useT();
  const [ticker, setTicker] = useState(defaultTicker);
  const [market, setMarket] = useState<Market>(defaultMarket);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    onSubmit(t, market);
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 w-full">
      <div className="flex bg-surface border border-border rounded-lg overflow-hidden">
        {(["US", "CN"] as Market[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              market === m
                ? "bg-accent text-white"
                : "text-muted hover:text-fg hover:bg-border/40"
            )}
          >
            {m === "US" ? t("input.market.us") : t("input.market.cn")}
          </button>
        ))}
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder={market === "US" ? t("input.placeholder.us") : t("input.placeholder.cn")}
          spellCheck={false}
          className={cn(
            "w-full pl-10 pr-3 py-2 text-sm",
            "bg-surface border border-border rounded-lg",
            "placeholder:text-muted/60",
            "focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50"
          )}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className={cn(
          "px-5 py-2 rounded-lg text-sm font-medium transition-colors",
          "bg-accent text-white hover:bg-accent/85",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        {loading ? t("input.submit.loading") : t("input.submit")}
      </button>
    </form>
  );
}
