"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { searchSymbols, type Market, type SymbolSuggestion } from "@/lib/api";
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
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTicker(defaultTicker);
    setMarket(defaultMarket);
  }, [defaultTicker, defaultMarket]);

  useEffect(() => {
    const q = ticker.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await searchSymbols(q, "ALL", 8);
        if (!ctl.signal.aborted) {
          setSuggestions(res);
          setOpen(res.length > 0);
        }
      } catch {
        if (!ctl.signal.aborted) setSuggestions([]);
      }
    }, 140);
    return () => {
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [ticker]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setOpen(false);
    onSubmit(t, market);
  }

  function choose(s: SymbolSuggestion) {
    setTicker(s.ticker);
    setMarket(s.market);
    setOpen(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 w-full">
      <div className="flex bg-surface border border-border rounded-lg overflow-hidden">
        {(["US", "CN", "HK"] as Market[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              market === m
                ? "bg-accent text-white"
                : "text-muted hover:text-heading hover:bg-border/40"
            )}
          >
            {m === "US" ? t("input.market.us") : m === "CN" ? t("input.market.cn") : t("input.market.hk")}
          </button>
        ))}
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <input
          value={ticker}
          onFocus={() => setOpen(suggestions.length > 0)}
          onChange={(e) => setTicker(e.target.value)}
          placeholder={market === "US" ? t("input.placeholder.us") : market === "CN" ? t("input.placeholder.cn") : t("input.placeholder.hk")}
          spellCheck={false}
          className={cn(
            "w-full pl-10 pr-3 py-2 text-sm",
            "bg-surface border border-border rounded-lg",
            "placeholder:text-muted/60",
            "focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50"
          )}
        />
        {open && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl">
            {suggestions.map((s) => (
              <button
                key={`${s.market}:${s.ticker}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-border/35"
              >
                <div className="min-w-0">
                  <div className="font-mono font-semibold text-heading">{s.ticker} · {s.name}</div>
                  {s.aliases.length > 0 && (
                    <div className="truncate text-xs text-muted">{s.aliases.slice(0, 3).join(" / ")}</div>
                  )}
                </div>
                <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                  {s.market}
                </span>
              </button>
            ))}
          </div>
        )}
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
