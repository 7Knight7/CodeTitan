// Image checks run in the browser: the full image never leaves the device (only a small preview is saved).
// Steps: prepare the image for reading (enlarge, greyscale, stretch contrast, try normal and inverted),
// read the text, measure text contrast, measure how much of the image uses brand colours,
// and look for the brand logo. Only the numbers and the read text go to the server.

const lum = (r, g, b) => {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const toHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

function toLab(r, g, b) {
  const lin = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = [x, y, z].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file could not be opened as an image. Use a PNG or JPG."));
    img.src = src;
  });
}

function canvasOf(img, maxSide, minSide = 0) {
  let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (minSide && Math.max(img.width, img.height) * scale < minSide) scale = minSide / Math.max(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { c, ctx, scale };
}

// Greyscale + contrast stretch (optionally inverted) so light-on-dark and stylised text read better.
function prepared(src, invert) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data;
  let lo = 255, hi = 0;
  const g = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g[j] = v; if (v < lo) lo = v; if (v > hi) hi = v;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((g[j] - lo) * 255) / span;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

function palette(ctx, w, h, brand) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  const data = ctx.getImageData(0, 0, w, h).data;
  const brandLab = brand.map((b) => toLab(...hexRgb(b.hex)));
  const buckets = new Map();
  let total = 0, onBrand = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      const k = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      k.r += r; k.g += g; k.b += b; k.n += 1; buckets.set(key, k);
      total += 1;
      if (brandLab.length) {
        const L = toLab(r, g, b);
        if (brandLab.some((B) => Math.hypot(L[0] - B[0], L[1] - B[1], L[2] - B[2]) < 25)) onBrand += 1;
      }
    }
  }
  return {
    palette: [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 4)
      .map((k) => ({ hex: toHex(k.r / k.n, k.g / k.n, k.b / k.n), share: +(k.n / total).toFixed(2) })),
    brand_share: brandLab.length ? +(onBrand / total).toFixed(2) : null,
  };
}

function wordContrast(ctx, bbox) {
  const x = Math.max(0, Math.floor(bbox.x0)), y = Math.max(0, Math.floor(bbox.y0));
  const w = Math.max(1, Math.ceil(bbox.x1 - bbox.x0)), h = Math.max(1, Math.ceil(bbox.y1 - bbox.y0));
  const d = ctx.getImageData(x, y, w, h).data;
  const ls = [];
  for (let i = 0; i < d.length; i += 4) ls.push(lum(d[i], d[i + 1], d[i + 2]));
  ls.sort((a, b) => a - b);
  return ratio(ls[Math.floor(ls.length * 0.08)], ls[Math.floor(ls.length * 0.92)]);
}

// Logo search: normalised cross-correlation of greyscale pixels at several sizes.
// Returns the best score from -1 to 1; 0.6 or more is treated as "logo found".
function greyArr(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i + 3] < 20 ? 255 : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}
async function logoScore(sceneImg, logoSrc) {
  const logo = await loadImage(logoSrc);
  const S = canvasOf(sceneImg, 320);
  const sg = greyArr(S.ctx, S.c.width, S.c.height);
  let best = -1;
  for (const frac of [0.12, 0.18, 0.25, 0.35, 0.5]) {
    const lw = Math.round(S.c.width * frac), lh = Math.round((lw * logo.height) / logo.width);
    if (lw < 12 || lh < 8 || lh >= S.c.height) continue;
    const L = document.createElement("canvas"); L.width = lw; L.height = lh;
    const lctx = L.getContext("2d", { willReadFrequently: true });
    lctx.fillStyle = "#fff"; lctx.fillRect(0, 0, lw, lh); lctx.drawImage(logo, 0, 0, lw, lh);
    const lg = greyArr(lctx, lw, lh);
    let lm = 0; for (const v of lg) lm += v; lm /= lg.length;
    let lv = 0; for (const v of lg) lv += (v - lm) ** 2;
    if (lv < 1) continue;
    const stride = 3;
    for (let oy = 0; oy + lh <= S.c.height; oy += stride) {
      for (let ox = 0; ox + lw <= S.c.width; ox += stride) {
        let sm = 0;
        for (let y = 0; y < lh; y += 2) for (let x = 0; x < lw; x += 2) sm += sg[(oy + y) * S.c.width + ox + x];
        const n = Math.ceil(lh / 2) * Math.ceil(lw / 2); sm /= n;
        let num = 0, sv = 0, lvv = 0;
        for (let y = 0; y < lh; y += 2) for (let x = 0; x < lw; x += 2) {
          const a = sg[(oy + y) * S.c.width + ox + x] - sm, b = lg[y * lw + x] - lm;
          num += a * b; sv += a * a; lvv += b * b;
        }
        if (sv > 1) best = Math.max(best, num / Math.sqrt(sv * lvv));
      }
    }
  }
  return +best.toFixed(2);
}

export async function analyseImage(file, { brandColours = [], logo = null, onProgress } = {}) {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const view = canvasOf(img, 1600, 1200); // enlarge small images so OCR can read them
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m) => m.status === "recognizing text" && onProgress?.(Math.round(m.progress * 50)),
  });
  const runs = [];
  for (const invert of [false, true]) {
    const { data } = await worker.recognize(prepared(view.c, invert));
    const words = (data.words || []).filter((w) => w.confidence > 60 && w.text.replace(/\W/g, "").length > 1);
    const conf = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
    runs.push({ words, conf });
    onProgress?.(invert ? 90 : 50);
  }
  await worker.terminate();
  const best = runs.sort((a, b) => b.words.length * b.conf - a.words.length * a.conf)[0];

  let worst = null;
  for (const w of best.words) {
    const r = wordContrast(view.ctx, w.bbox); // contrast is measured on the original colours
    if (!worst || r < worst.ratio) worst = { ratio: r, text: w.text };
  }
  const pal = palette(view.ctx, view.c.width, view.c.height, brandColours);
  const preview = canvasOf(img, 480).c.toDataURL("image/jpeg", 0.75);
  const score = logo ? await logoScore(img, logo).catch(() => null) : null;
  URL.revokeObjectURL(url);
  onProgress?.(100);
  return {
    kind: "image",
    width: img.width,
    height: img.height,
    file_name: file.name.slice(0, 140),
    text: best.words.map((w) => w.text).join(" ").slice(0, 3000),
    ocr_confidence: +best.conf.toFixed(0),
    contrast_min: worst ? +Math.min(21, Math.max(1, worst.ratio)).toFixed(2) : null,
    contrast_text: worst ? worst.text.slice(0, 140) : "",
    palette: pal.palette,
    brand_share: pal.brand_share,
    logo_score: score,
    alt_text: "",
    preview,
  };
}

// Videos stay on the device. One frame (about a second in, or the middle of a short clip) is drawn to a
// canvas and checked like an image; its size and length are measured from the video's metadata.
export async function analyseVideo(file, opts = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("That video could not be opened here. Use an MP4 or WebM file."));
  });
  const at = Math.min(1, (video.duration || 2) / 2);
  await new Promise((resolve) => { video.onseeked = resolve; video.currentTime = at; });
  const c = document.createElement("canvas");
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.9));
  URL.revokeObjectURL(url);
  const frame = new File([blob], file.name.replace(/\.[^.]+$/, "") + "-frame.jpg", { type: "image/jpeg" });
  const m = await analyseImage(frame, opts);
  return { ...m, kind: "video", file_name: file.name.slice(0, 140), duration: +video.duration.toFixed(1),
    width: video.videoWidth, height: video.videoHeight, alt_text: "" };
}

// PDFs: the text is read on the server so it can be checked; the file itself is not stored.
export async function readPdf(file, api) {
  if (file.size > 3 * 1024 * 1024) throw new Error("PDFs up to 3 MB can be checked.");
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
  const out = await api("/extract-text", { method: "POST", body: { file_name: file.name.slice(0, 140), data_b64: b64 } });
  return { kind: "document", file_name: file.name.slice(0, 140), text: out.text, pages: out.pages, note: out.note, alt_text: "" };
}
