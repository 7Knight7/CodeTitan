/** Design tokens: ink-and-proof palette. Severity colours double as the underline colours. */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  safelist: [{ pattern: /(text|bg)-(blocker|warning|suggestion|approved|sensitive)(-soft)?/ }],
  theme: {
    extend: {
      colors: {
        ink: "#17233B",
        muted: "#5A6478",
        line: "#D5DBE5",
        canvas: "#EEF1F5",
        sheet: "#FFFFFF",
        blocker: { DEFAULT: "#B42318", soft: "#FDECEA" },
        warning: { DEFAULT: "#9A5B06", soft: "#FDF3E1" },
        suggestion: { DEFAULT: "#2457B5", soft: "#E8EFFB" },
        approved: { DEFAULT: "#1D7A4C", soft: "#E5F4EC" },
        sensitive: { DEFAULT: "#6E3FB0", soft: "#F1EAFB" },
        brand: { navy: "#1F3A68", saffron: "#F2A33A" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        proof: ['"Source Serif 4"', "Georgia", "Cambria", "serif"],
      },
    },
  },
  plugins: [],
};
