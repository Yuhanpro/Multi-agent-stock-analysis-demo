/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Runtime-tweakable via CSS variables. See ThemeProvider / ThemeEditor.
        bg:      "hsl(var(--theme-bg))",
        surface: "hsl(var(--theme-surface))",
        elevated: "hsl(var(--theme-elevated))",
        input: "hsl(var(--theme-input))",
        border:  "hsl(var(--theme-border))",
        heading: "hsl(var(--theme-heading))",
        body: "hsl(var(--theme-body))",
        muted:   "hsl(var(--theme-muted))",
        subtle: "hsl(var(--theme-subtle))",
        fg:      "hsl(var(--theme-fg))",
        accent:  "hsl(var(--theme-accent))",
        bull:    "hsl(var(--theme-bull))",
        bear:    "hsl(var(--theme-bear))",
      },
      borderRadius: {
        theme: "var(--theme-radius)",
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
