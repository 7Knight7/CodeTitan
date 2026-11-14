// Runs the web app's own image checks (lib/image.js, copied into vendor/ by `npm run extension`) inside the
// extension, so captions, images and banners are measured the same way in both places. Nothing leaves the device here.
import { analyseImage } from "./vendor/image.js";

// lib/image.js asks for tesseract.js; give it the copy bundled with the extension (no remote code).
globalThis.lbcTesseract = () => ({
  createWorker: (lang, oem, opts = {}) => globalThis.Tesseract.createWorker(lang, oem, {
    ...opts,
    workerPath: chrome.runtime.getURL("vendor/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/core/"),
    workerBlobURL: false,
  }),
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== "offscreen" || msg.type !== "analyse") return false;
  (async () => {
    const blob = await (await fetch(msg.dataUrl)).blob();
    const file = new File([blob], msg.name || "post-image.jpg", { type: blob.type || "image/jpeg" });
    const meta = await analyseImage(file, { brandColours: msg.colours || [], logo: msg.logo || null });
    reply({ meta });
  })().catch((e) => reply({ error: e.message || "The image could not be read." }));
  return true;
});
