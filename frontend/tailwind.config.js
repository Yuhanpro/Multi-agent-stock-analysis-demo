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
        // Deep-blue palette — finance/analytics vibe, easy on the eyes,
        // doesn't fight bull/bear semantic colors.
        bg:      "hsl(218, 50%, 6%)",     // near-black with strong blue cast
        surface: "hsl(218, 45%, 10%)",    // card / input bg
        border:  "hsl(218, 35%, 20%)",    // subtle border
        muted:   "hsl(218, 15%, 65%)",    // secondary text
        fg:      "hsl(210, 30%, 98%)",    // primary text, faint blue tint
        accent:  "hsl(210, 100%, 62%)",   // brighter blue against deep bg
        // semantic — slightly punched up to read against deep blue
        bull:    "hsl(142, 71%, 50%)",
        bear:    "hsl(0, 75%, 60%)",
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
