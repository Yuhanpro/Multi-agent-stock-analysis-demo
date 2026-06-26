"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart2, Clock, Flame, HelpCircle, Menu, MessagesSquare, PieChart, Shield, Star, Stethoscope, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { track } from "@/lib/track";
import { cn } from "@/lib/format";
import { AuthWidget } from "./auth-widget";
import { LanguageSwitcher } from "./language-switcher";
import { Onboarding } from "./onboarding";

const ONBOARD_KEY = "stock-web:onboarded";

type NavItem = { href: string; icon: typeof Flame; key: string };

const NAV: NavItem[] = [
  { href: "/", icon: BarChart2, key: "nav.analyze" },
  { href: "/overview", icon: Flame, key: "nav.overview" },
  { href: "/fund", icon: PieChart, key: "nav.funds" },
  { href: "/diagnose", icon: Stethoscope, key: "nav.diagnose" },
  { href: "/watchlist", icon: Star, key: "nav.watchlist" },
  { href: "/reports", icon: Clock, key: "nav.reports" },
  { href: "/feedback", icon: MessagesSquare, key: "nav.feedback" },
];

function SidebarBody({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = useT();
  const { user } = useAuth();
  const items: NavItem[] = [...NAV];
  if (user?.is_admin) items.push({ href: "/admin", icon: Shield, key: "nav.admin" });
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-4 py-4 text-accent">
        <Activity className="h-4 w-4" />
        <span className="text-sm font-semibold">{t("hero.eyebrow")}</span>
      </Link>
      <nav className="flex-1 space-y-1 px-2">
        {items.map((item) => {
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
              <span className="truncate">{t(item.key as never)}</span>
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
  const [helpOpen, setHelpOpen] = useState(false);

  // Record a page view on every route change (fire-and-forget).
  useEffect(() => {
    track(pathname);
  }, [pathname]);

  // Auto-show the onboarding guide on a visitor's first ever visit.
  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARD_KEY)) setHelpOpen(true);
    } catch {}
  }, []);

  function closeHelp() {
    setHelpOpen(false);
    try {
      localStorage.setItem(ONBOARD_KEY, "1");
    } catch {}
  }

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
            <button
              onClick={() => setHelpOpen(true)}
              aria-label="help"
              className="text-muted hover:text-heading"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <AuthWidget showReportsLink={false} />
            <LanguageSwitcher />
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>

      {helpOpen && <Onboarding onClose={closeHelp} />}
    </div>
  );
}
