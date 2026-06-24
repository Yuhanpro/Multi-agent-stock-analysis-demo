"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart2, Clock, Flame, Menu, Star, Stethoscope, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";
import { AuthWidget } from "./auth-widget";
import { LanguageSwitcher } from "./language-switcher";

const NAV = [
  { href: "/", icon: BarChart2, key: "nav.analyze" as const },
  { href: "/overview", icon: Flame, key: "nav.overview" as const },
  { href: "/diagnose", icon: Stethoscope, key: "nav.diagnose" as const },
  { href: "/watchlist", icon: Star, key: "nav.watchlist" as const },
  { href: "/reports", icon: Clock, key: "nav.reports" as const },
];

function SidebarBody({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-4 py-4 text-accent">
        <Activity className="h-4 w-4" />
        <span className="text-sm font-semibold">{t("hero.eyebrow")}</span>
      </Link>
      <nav className="flex-1 space-y-1 px-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-accent text-white" : "text-muted hover:bg-border/40 hover:text-heading"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-border bg-surface/40 lg:block">
        <SidebarBody pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 border-r border-border bg-surface shadow-2xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-2 top-3 text-muted hover:text-heading"
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarBody pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: account + language pinned top-right, on every page */}
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOpen(true)}
              aria-label="menu"
              className="text-muted hover:text-heading lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/" className="flex items-center gap-2 text-accent lg:hidden">
              <Activity className="h-4 w-4" />
              <span className="text-sm font-semibold">stock-web</span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <AuthWidget showReportsLink={false} />
            <LanguageSwitcher />
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
