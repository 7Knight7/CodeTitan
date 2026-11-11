/** Design tokens for Live Brand Check (glass theme).
 *  Every colour is a CSS variable holding "R G B" channels, defined for light and dark themes in app/globals.css,
 *  so one set of classes serves both themes and opacity modifiers (bg-teal/20) still work.
 *  Token names are kept from earlier versions: `teal` is now the accent (soft electric blue #5278D8),
 *  `ink` is primary text, `sheet`/`surface` are solid card fills, `canvas` is a subtle fill. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  safelist: [{ pattern: /(text|bg|border|before:bg)-(blocker|warning|suggestion|approved|sensitive)(-soft|-vivid)?/ }],
  theme: {
    extend: {
      colors: {
        ink: v("ink"),
        muted: v("muted"),
        faint: v("faint"),
        line: { DEFAULT: v("line"), strong: v("line-strong") },
        canvas: v("canvas"),
        sheet: v("surface"),
        surface: v("surface"),
        navy: { DEFAULT: v("navy"), 2: v("navy-2"), 3: v("navy-3"), line: v("navy-line") },
        teal: { DEFAULT: v("accent"), dark: v("accent-text"), soft: v("accent-soft") },
        blocker: { DEFAULT: v("blocker"), soft: v("blocker-soft"), vivid: v("blocker-vivid") },
        warning: { DEFAULT: v("warning"), soft: v("warning-soft"), vivid: v("warning-vivid") },
        suggestion: { DEFAULT: v("suggestion"), soft: v("suggestion-soft"), vivid: v("suggestion-vivid") },
        approved: { DEFAULT: v("approved"), soft: v("approved-soft"), vivid: v("approved-vivid") },
        sensitive: { DEFAULT: v("sensitive"), soft: v("sensitive-soft"), vivid: v("sensitive-vivid") },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        proof: ['"Inter"', "system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        DEFAULT: "8px",
        md: "12px",
        lg: "22px",
        xl: "26px",
        "2xl": "28px",
      },
      boxShadow: {
        sm: "0 1px 2px rgb(var(--shadow) / 0.06)",
        DEFAULT: "0 1px 2px rgb(var(--shadow) / 0.04), 0 8px 24px -10px rgb(var(--shadow) / 0.12)",
        lift: "0 1px 2px rgb(var(--shadow) / 0.05), 0 18px 40px -16px rgb(var(--shadow) / 0.22)",
        xl: "0 30px 60px -20px rgb(var(--shadow) / 0.35)",
      },
    },
  },
  plugins: [],
};
