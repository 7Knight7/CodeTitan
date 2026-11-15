// Live Brand Check extension: background service worker.
// It talks to the Live Brand Check API with the user's own signed-in session (the same cookie the web app
// uses), so the server decides who they are and computes every finding. Images are read on this device
// in an offscreen page (OCR, contrast, colours, logo); only the read text, the measurements and a small
// preview go to the server, exactly like the web app.

const DEFAULT_SERVER = "https://live-brand-check.vercel.app";
const imageCache = new Map(); // image src -> measurements (so each image is read once)
let kitCache = null; // { at, server, colours, logo }

async function settings() {
  const s = await chrome.storage.sync.get({ server: DEFAULT_SERVER, enabled: true });
  return { server: s.server.replace(/\/+$/, ""), enabled: s.enabled };
}

async function call(server, path, opts = {}) {
  const r = await fetch(server + "/api" + path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-LBC": "1", ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(typeof body.detail === "string" ? body.detail : body.detail?.message || `Error ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return body;
}

async function brandKit(server) {
  if (kitCache && kitCache.server === server && Date.now() - kitCache.at < 10 * 60 * 1000) return kitCache;
  const ws = await call(server, "/workspace");
  kitCache = { at: Date.now(), server, name: ws.meta?.name, colours: (ws.meta?.brand_colours || []).filter((c) => c?.hex).map((c) => ({ name: c.name || "", hex: c.hex })), logo: ws.meta?.logo || null };
  return kitCache;
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  try {
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "Read the text in post images on this device (OCR)" });
  } catch (e) {
    if (!String(e.message).includes("single offscreen")) throw e;
  }
}

async function toDataUrl(src) {
  if (src.startsWith("data:")) return src;
  const blob = await (await fetch(src)).blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(bin)}`;
}

async function measure(img, kit, n) {
  const key = img.src.slice(0, 500);
  if (imageCache.has(key)) return imageCache.get(key);
  await ensureOffscreen();
  const dataUrl = img.dataUrl || (await toDataUrl(img.src));
  const res = await chrome.runtime.sendMessage({ target: "offscreen", type: "analyse", dataUrl, name: `post-image-${n}.jpg`, colours: kit.colours, logo: kit.logo });
  if (!res || res.error) throw new Error(res?.error || "The image could not be read.");
  const meta = { ...res.meta, alt_text: img.alt || "" };
  imageCache.set(key, meta);
  if (imageCache.size > 40) imageCache.delete(imageCache.keys().next().value);
  return meta;
}

async function check({ text, images, site }) {
  const { server, enabled } = await settings();
  if (!enabled) return { off: true };
  const kit = await brandKit(server);
  const metas = [], unread = [];
  for (const [i, img] of images.slice(0, 5).entries()) {
    try { metas.push(await measure(img, kit, i + 1)); } catch (e) { unread.push({ n: i + 1, reason: e.message }); }
  }
  if (!text.trim() && !metas.length) return { empty: true, unread, brand: kit.name };
  const channel = site === "facebook" ? "Facebook post" : "Instagram post";
  const res = await call(server, "/check", { method: "POST", body: JSON.stringify({ content: text.slice(0, 5000), channel, images: metas }) });
  return { ...res, unread, brand: kit.name, server };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.target === "offscreen") return false; // handled by the offscreen page
  if (msg?.type === "check") {
    check(msg).then(reply).catch(async (e) => reply({ error: e.message, status: e.status, server: (await settings()).server }));
    return true;
  }
  if (msg?.type === "session") {
    settings().then(({ server }) => call(server, "/session").then((s) => reply({ ok: true, ...s, server }))
      .catch((e) => reply({ ok: false, error: e.message, status: e.status, server })));
    return true;
  }
  if (msg?.type === "forget") { kitCache = null; imageCache.clear(); reply({ ok: true }); }
  return false;
});
