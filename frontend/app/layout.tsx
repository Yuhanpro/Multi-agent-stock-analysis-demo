import type { Metadata } from "next";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { ThemeEditor } from "@/components/theme-editor";
import "./globals.css";

export const metadata: Metadata = {
  title: "stock-web — multi-agent stock analysis",
  description:
    "Run TradingAgents debate or a Buffett-style single-agent review on any ticker. Powered by DeepSeek.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <I18nProvider>
            {children}
            <ThemeEditor />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
