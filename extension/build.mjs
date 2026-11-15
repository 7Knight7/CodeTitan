// Builds extension/vendor/: the OCR engine (tesseract.js, bundled so no remote code runs) and a copy of
// lib/image.js, so the extension measures images exactly like the web app. Run: npm run extension
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const vendor = join(here, "vendor");
rmSync(vendor, { recursive: true, force: true });
mkdirSync(join(vendor, "core"), { recursive: true });

const nm = (p) => join(root, "node_modules", p);
copyFileSync(nm("tesseract.js/dist/tesseract.min.js"), join(vendor, "tesseract.min.js"));
copyFileSync(nm("tesseract.js/dist/worker.min.js"), join(vendor, "worker.min.js"));
// The extension reads text with the LSTM engine only, so only those two cores are needed (with and without SIMD).
for (const f of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) {
  copyFileSync(nm(`tesseract.js-core/${f}`), join(vendor, "core", f));
}

const src = readFileSync(join(root, "lib", "image.js"), "utf8");
const hook = 'await import("tesseract.js")';
if (!src.includes(hook)) throw new Error("lib/image.js no longer loads tesseract.js the expected way; update extension/build.mjs");
writeFileSync(join(vendor, "image.js"),
  "// Copied from lib/image.js by extension/build.mjs. Do not edit here.\n" + src.replace(hook, "globalThis.lbcTesseract()"));
console.log("Extension built: load the extension/ folder in chrome://extensions (Developer mode, Load unpacked).");
