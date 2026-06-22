"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  addWatchlistItem,
  deleteWatchlistItem,
  fetchWatchlist,
  patchWatchlistItem,
  type AnalysisMode,
  type Market,
  type WatchlistItem,
} from "@/lib/api";
import { cn } from "@/lib/format";
import { useT } from "@/lib/i18n";

const MODE_OPTIONS: AnalysisMode[] = ["snapshot", "quick", "serenity", "debate"];

export default function WatchlistPage() {
  const { t } = useT();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<WatchlistItem>({
    ticker: "",
    market: "US",
    enabled: true,
    modes: ["snapshot", "quick"],
    note: "",
  });

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchWatchlist());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addItem() {
    const ticker = form.ticker.trim().toUpperCase();
    if (!ticker) return;
    setError(null);
    try {
      setItems(await addWatchlistItem({ ...form, ticker }));
      setForm({ ticker: "", market: form.market, enabled: true, modes: form.modes, note: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function patch(item: WatchlistItem, patch: Partial<Omit<WatchlistItem, "ticker" | "market">>) {
    setError(null);
    try {
      setItems(await patchWatchlistItem(item, patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function del(item: WatchlistItem) {
    setError(null);
    try {
      setItems(await deleteWatchlistItem(item));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const enabledCount = useMemo(() => items.filter((x) => x.enabled).length, [items]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-4">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("watch.back")}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("watch.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{t("watch.lead")}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
            {items.length} {t("watch.total")} / {enabledCount} {t("watch.enabled")}
          </div>
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_120px_1.4fr_auto]">
          <input
            value={form.ticker}
            onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value }))}
            placeholder={t("watch.ticker.placeholder")}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
          />
          <select
            value={form.market}
            onChange={(e) => setForm((f) => ({ ...f, market: e.target.value as Market }))}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
          >
            <option value="US">US</option>
            <option value="CN">CN</option>
          </select>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder={t("watch.note.placeholder")}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/70"
          />
          <button
            onClick={addItem}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/85"
          >
            <Plus className="h-4 w-4" />
            {t("watch.add")}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => setForm((f) => ({
                ...f,
                modes: f.modes.includes(m) ? f.modes.filter((x) => x !== m) : [...f.modes, m],
              }))}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                form.modes.includes(m) ? "border-accent/60 bg-accent/10 text-accent" : "border-border text-muted hover:text-fg"
              )}
            >
              {modeLabel(m)}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="mt-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>}

      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("watch.loading")}</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">{t("watch.empty")}</div>
        ) : (
          <div className="divide-y divide-border/70">
            {items.map((item) => (
              <WatchRow key={`${item.market}:${item.ticker}`} item={item} onPatch={patch} onDelete={del} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function WatchRow({ item, onPatch, onDelete }: {
  item: WatchlistItem;
  onPatch: (item: WatchlistItem, patch: Partial<Omit<WatchlistItem, "ticker" | "market">>) => void;
  onDelete: (item: WatchlistItem) => void;
}) {
  const { t } = useT();
  const defaultMode = item.modes[0] ?? "snapshot";
  const href = `/?ticker=${encodeURIComponent(item.ticker)}&market=${item.market}&mode=${defaultMode}&run=1`;

  return (
    <div className={cn("grid gap-3 p-4 md:grid-cols-[1fr_220px_auto] md:items-center", !item.enabled && "opacity-45")}>
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-semibold">{item.ticker}</span>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{item.market}</span>
          <label className="ml-1 inline-flex items-center gap-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => onPatch(item, { enabled: e.target.checked })}
              className="accent-accent"
            />
            {t("watch.enabled")}
          </label>
        </div>
        <input
          value={item.note}
          onChange={(e) => onPatch(item, { note: e.target.value })}
          placeholder={t("watch.note.placeholder")}
          className="mt-2 w-full bg-transparent text-sm text-muted outline-none placeholder:text-muted/40"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MODE_OPTIONS.map((m) => (
          <button
            key={m}
            onClick={() => onPatch(item, { modes: item.modes.includes(m) ? item.modes.filter((x) => x !== m) : [...item.modes, m] })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              item.modes.includes(m) ? "border-accent/60 bg-accent/10 text-accent" : "border-border text-muted hover:text-fg"
            )}
          >
            {modeLabel(m)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 justify-end">
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-fg"
        >
          {t("watch.analyze")}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <button
          onClick={() => onDelete(item)}
          className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:border-bear/40 hover:text-bear"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function modeLabel(m: AnalysisMode) {
  if (m === "quick") return "Buffett";
  if (m === "serenity") return "Serenity";
  if (m === "debate") return "Debate";
  return "Snapshot";
}
