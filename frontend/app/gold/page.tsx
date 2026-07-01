"use client";

import { Coins } from "lucide-react";
import { GoldPanel } from "@/components/gold-panel";
import { useT } from "@/lib/i18n";

export default function GoldPage() {
  const { t, lang } = useT();
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-accent">
          <Coins className="h-4 w-4" />
          <span className="text-sm font-semibold">{t("nav.gold")}</span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-body">{t("gold.lead")}</p>
      </header>
      <GoldPanel lang={lang} />
    </main>
  );
}
