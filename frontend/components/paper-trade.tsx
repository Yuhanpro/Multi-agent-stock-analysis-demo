"use client";

import { useState } from "react";
import { Loader2, Wallet, X } from "lucide-react";
import { placePaperOrder, type Market } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";

/** Compact "paper trade this stock" control for the snapshot card. */
export function PaperTrade({ ticker, market }: { ticker: string; market: Market }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function order(side: "buy" | "sell") {
    const n = parseFloat(shares);
    if (!n || n <= 0) return;
    setBusy(true); setMsg(null);
    try {
      const pf = await placePaperOrder({ ticker, market, side, shares: n });
      const pos = pf.positions.find((p) => p.ticker === ticker && p.market === market);
      setMsg({
        ok: true,
        text: `${side === "buy" ? t("ptrade.bought") : t("ptrade.sold")} ${n} · ${t("paper.cash")} ¥${Math.round(pf.cash).toLocaleString("zh-CN")}${pos ? ` · ${t("paper.shares")} ${pos.shares}` : ""}`,
      });
      setShares("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "error" });
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/60 hover:text-accent"
      >
        <Wallet className="h-3.5 w-3.5" />{t("ptrade.open")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t("ptrade.open")}</span>
        <input
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          inputMode="numeric"
          placeholder={t("paper.shares")}
          className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-xs tabular-nums outline-none focus:border-accent/70"
        />
        <button onClick={() => order("buy")} disabled={busy || !shares}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/85 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("ptrade.buy")}
        </button>
        <button onClick={() => order("sell")} disabled={busy || !shares}
          className="rounded-md border border-border px-3 py-1 text-xs text-muted hover:border-bear/40 hover:text-bear disabled:opacity-40">
          {t("ptrade.sell")}
        </button>
        <button onClick={() => setOpen(false)} className="text-muted/60 hover:text-heading"><X className="h-3.5 w-3.5" /></button>
      </div>
      {msg && <div className={cn("mt-1.5 text-[11px]", msg.ok ? "text-bull" : "text-bear")}>{msg.text}</div>}
    </div>
  );
}
