/** Design tokens for Live Brand Check.
 *  Brand: Midnight Navy #14263D, Electric Teal #16B8A6, Soft Ivory #F7F8FA, white surfaces.
 *  Status colours: DEFAULT is the text-safe shade (WCAG AA on white), `vivid` is the brand hex for bars, dots and borders. */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  safelist: [{ pattern: /(text|bg|border|before:bg)-(blocker|warning|suggestion|approved|sensitive)(-soft|-vivid)?/ }],
  theme: {
    extend: {
      colors: {
        ink: "#14263D",
        navy: { DEFAULT: "#14263D", 2: "#1C3350", 3: "#264261", line: "#2B4566" },
        teal: { DEFAULT: "#16B8A6", dark: "#0E8A7C", soft: "#E3F6F3" },
        muted: "#64748B",
        line: "#E4E7EC",
        canvas: "#F7F8FA",
        sheet: "#FFFFFF",
        blocker: { DEFAULT: "#BF4547", soft: "#FCEEEE", vivid: "#E76F70" },
        warning: { DEFAULT: "#8A5A00", soft: "#FEF5E2", vivid: "#F4B544" },
        suggestion: { DEFAULT: "#475569", soft: "#EEF1F5", vivid: "#64748B" },
        approved: { DEFAULT: "#1C7D5A", soft: "#E6F4EE", vivid: "#239B70" },
        sensitive: { DEFAULT: "#6B46A8", soft: "#F2EDFA", vivid: "#8B6BC4" },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        proof: ['"Inter"', "system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        xl: "12px",
        "2xl": "16px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(20, 38, 61, 0.05)",
        DEFAULT: "0 1px 2px rgba(20, 38, 61, 0.04)",
        lift: "0 1px 3px rgba(20, 38, 61, 0.06), 0 12px 32px -12px rgba(20, 38, 61, 0.18)",
        xl: "0 24px 48px -16px rgba(20, 38, 61, 0.28)",
      },
    },
  },
  plugins: [],
};
