// Live Brand Check on Instagram and Facebook: watches the post composer while you write and shows the
// findings in a small panel. It only reads: it never changes your caption, never clicks Share/Post,
// and never sends anything anywhere except your own Live Brand Check server.
(() => {
  if (window.__lbcLoaded) return;
  window.__lbcLoaded = true;
  const site = location.hostname.includes("facebook") ? "facebook" : "instagram";
  const SEV = { blocker: ["Critical", "#b42318", "#fde7e5"], warning: ["Warning", "#a15c07", "#fdf1dc"], suggestion: ["Suggestion", "#3156b8", "#e6edfb"] };
  let root = null, timer = null, last = "", busy = false, open = true;

  // ---------- the panel (in a shadow root so the page's styles can't touch it) ----------
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    :host{all:initial} *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .card{width:340px;max-width:calc(100vw - 32px);max-height:70vh;display:flex;flex-direction:column;background:#fff;color:#16181d;border:1px solid #dde1e8;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.18);overflow:hidden;font-size:13px;line-height:1.45}
    header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #eceef2;background:#f7f8fb;cursor:pointer}
    header b{flex:1;font-size:13px} .dot{width:9px;height:9px;border-radius:50%;background:#9aa3b2}
    .body{overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
    .muted{color:#5b6472;font-size:12px} .row{display:flex;gap:6px;flex-wrap:wrap}
    .pill{border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600}
    .f{border:1px solid #eceef2;border-radius:10px;padding:8px} .f q{display:block;margin:4px 0;font-style:italic;color:#333}
    .src{color:#5b6472;font-size:11px;margin-top:4px} .fix{margin-top:4px} .fix b{color:#1f6f43}
    button{font:inherit;border:1px solid #dde1e8;background:#fff;border-radius:8px;padding:5px 10px;cursor:pointer}
    a{color:#3156b8} .banner{border-radius:10px;padding:8px;font-weight:600}
    @media (prefers-color-scheme: dark){.card{background:#1b1e24;color:#e8eaee;border-color:#2c313a}header{background:#22262d;border-color:#2c313a}.f{border-color:#2c313a}.f q{color:#cfd3da}.muted,.src{color:#9aa3b2}button{background:#22262d;color:#e8eaee;border-color:#2c313a}.fix b{color:#7fd1a0}a{color:#8fa9ec}}
  </style>
  <div class="card" role="complementary" aria-label="Live Brand Check">
    <header><span class="dot"></span><b>Live Brand Check</b><button id="again" title="Check again">Check</button><button id="toggle" aria-expanded="true">–</button></header>
    <div class="body" id="body"><p class="muted">Start writing a post. Captions, images and banners in the composer are checked as you go.</p></div>
  </div>`;
  const $ = (id) => shadow.getElementById(id);
  const dot = shadow.querySelector(".dot");
  $("toggle").onclick = (e) => { e.stopPropagation(); open = !open; $("body").style.display = open ? "" : "none"; $("toggle").textContent = open ? "–" : "+"; $("toggle").setAttribute("aria-expanded", open); };
  $("again").onclick = (e) => { e.stopPropagation(); last = ""; run(); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const show = (html, colour) => { $("body").innerHTML = html; dot.style.background = colour || "#9aa3b2"; if (!host.isConnected) document.documentElement.appendChild(host); };

  // ---------- first time on Instagram or Facebook: how to try it ----------
  chrome.storage.local.get({ lbcGuideSeen: false }).then(({ lbcGuideSeen }) => {
    if (lbcGuideSeen || root) return;
    const where = site === "facebook" ? "Facebook" : "Instagram";
    const steps = site === "facebook"
      ? ["Click <b>What's on your mind?</b> to start a post.", "Add a photo if you like, and type your caption.", "This panel checks it as you type. Fix what you agree with."]
      : ["Click <b>Create</b> (+) in the left menu, then <b>Post</b>.", "<b>Select from computer</b>: choose an image (try the sample banner from the extension page), then <b>Next</b>, <b>Next</b>.", "Type in <b>Write a caption…</b>. This panel checks the caption and the image as you go."];
    show(`<p><b>Live Brand Check is on ✓</b></p><p class="muted">Try it on a new ${where} post:</p>`
      + steps.map((t, i) => `<div class="row" style="flex-wrap:nowrap"><span class="pill" style="background:#e6edfb;color:#3156b8">${i + 1}</span><span>${t}</span></div>`).join("")
      + `<p class="muted">Nothing is posted or changed for you: don't press Share while testing.</p><button id="lbc-got-it">Got it</button>`, "#3156b8");
    $("lbc-got-it").onclick = () => { chrome.storage.local.set({ lbcGuideSeen: true }); show("<p class='muted'>Start writing a post. Captions, images and banners in the composer are checked as you go.</p>"); };
  }).catch(() => {});

  // ---------- reading the composer ----------
  const isBox = (el) => el && (el.tagName === "TEXTAREA" || (el.isContentEditable && el.getAttribute("role") === "textbox") || el.getAttribute?.("contenteditable") === "true");
  const composerOf = (el) => el.closest('[role="dialog"]') || el.closest("form") || el.parentElement?.parentElement?.parentElement || document.body;
  const textOf = (r) => [...r.querySelectorAll('textarea, [contenteditable="true"]')].map((b) => b.value ?? b.innerText).join("\n").trim();

  function imagesOf(r) {
    const out = [], seen = new Set();
    const add = (src, alt, el) => {
      if (!src || seen.has(src) || src.startsWith("data:image/svg")) return;
      const box = el.getBoundingClientRect();
      if (box.width < 120 || box.height < 120) return; // skip avatars and icons
      seen.add(src);
      const item = { src, alt: alt || "" };
      if (src.startsWith("blob:") && el.tagName === "IMG" && el.complete) { // page-only URL: copy it here
        try {
          const c = document.createElement("canvas"), k = Math.min(1, 1600 / Math.max(el.naturalWidth, el.naturalHeight));
          c.width = el.naturalWidth * k; c.height = el.naturalHeight * k;
          c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
          item.dataUrl = c.toDataURL("image/jpeg", 0.9);
        } catch { return; }
      }
      out.push(item);
    };
    r.querySelectorAll("img").forEach((img) => { if (!/profile picture|avatar/i.test(img.alt)) add(img.currentSrc || img.src, img.alt, img); });
    r.querySelectorAll('[style*="background-image"]').forEach((el) => { const m = /url\(["']?([^"')]+)/.exec(el.style.backgroundImage); if (m && !m[1].startsWith("blob:")) add(m[1], "", el); });
    return out.slice(0, 5);
  }

  function schedule(r) {
    root = r;
    clearTimeout(timer);
    timer = setTimeout(run, 1500);
  }

  document.addEventListener("input", (e) => { if (isBox(e.target)) schedule(composerOf(e.target)); }, true);
  document.addEventListener("focusin", (e) => { if (isBox(e.target) && e.target.closest('[role="dialog"]')) schedule(composerOf(e.target)); }, true);
  new MutationObserver(() => { if (root && root.isConnected && !busy) { const sig = textOf(root) + imagesOf(root).map((i) => i.src).join("|"); if (sig !== last) schedule(root); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  // ---------- checking ----------
  async function run() {
    if (!root || !root.isConnected || busy) return;
    const text = textOf(root), images = imagesOf(root);
    const sig = text + images.map((i) => i.src).join("|");
    if (sig === last) return;
    last = sig;
    busy = true;
    show(`<p class="muted">Checking${images.length ? ` the caption and ${images.length} image${images.length > 1 ? "s" : ""} (images are read on this device)` : " the caption"}…</p>`);
    try {
      const res = await chrome.runtime.sendMessage({ type: "check", text, images, site });
      render(res);
    } catch (e) {
      show(`<p>Couldn't reach the extension: ${esc(e.message)}. Reload this page.</p>`, "#a15c07");
    } finally {
      busy = false;
    }
  }

  function render(res) {
    if (!res) return show("<p class='muted'>No answer from the checker.</p>");
    if (res.off) return show("<p class='muted'>Checking is paused. Turn it on from the extension button.</p>");
    if (res.error) {
      if (res.status === 401) return show(`<p><b>Sign in to check posts.</b></p><p class="muted">Open <a href="${esc(res.server)}/login" target="_blank" rel="noopener">Live Brand Check</a> in this browser, sign in, then press Check.</p>`, "#a15c07");
      return show(`<p><b>Couldn't check this post.</b></p><p class="muted">${esc(res.error)}</p>`, "#a15c07");
    }
    if (res.empty) return show("<p class='muted'>Nothing to check yet.</p>");
    const fs = res.findings || [], s = res.summary || {};
    const colour = s.blocker ? "#b42318" : s.warning ? "#a15c07" : "#1f6f43";
    const fit = s.brand_fit;
    let h = "";
    if (fit && fit.verdict === "no") h += `<div class="banner" style="background:#fde7e5;color:#b42318">Not a post for ${esc(fit.brand)}</div>`;
    h += `<div class="row"><span class="muted">${esc(res.brand || "Brand kit")}:</span>${["blocker", "warning", "suggestion"].map((k) => `<span class="pill" style="color:${SEV[k][1]};background:${SEV[k][2]}">${s[k] || 0} ${SEV[k][0].toLowerCase()}${(s[k] || 0) === 1 ? "" : "s"}</span>`).join("")}</div>`;
    if (s.checks_run) h += `<p class="muted">${s.checks_passed} of ${s.checks_run} checks passed.</p>`;
    for (const f of fs.slice(0, 12)) {
      const [label, fg, bg] = SEV[f.severity] || SEV.suggestion;
      h += `<div class="f"><div class="row"><span class="pill" style="color:${fg};background:${bg}">${label}</span><b>${esc(f.name)}</b>${f.engine === "AI-generated" ? '<span class="pill" style="background:#efe9fb;color:#5b3aa8">AI</span>' : ""}</div>`
        + (f.quote ? `<q>${esc(f.quote)}</q>` : "")
        + `<div>${esc(f.why)}</div>`
        + (f.suggestion ? `<div class="fix">Try: <b>${esc(f.suggestion)}</b></div>` : "")
        + `<div class="src">${esc(f.location_label || f.location)} · Source: ${esc((f.sources || []).join("; "))}${f.outcome === "Couldn't verify" ? " · Couldn't verify" : ""}</div></div>`;
    }
    if (fs.length > 12) h += `<p class="muted">${fs.length - 12} more in Live Brand Check.</p>`;
    if (!fs.length) h += "<p>No issues found by any check.</p>";
    for (const u of res.unread || []) h += `<p class="muted">Couldn't verify image ${u.n}: ${esc(u.reason)}</p>`;
    if (s.tone?.message) h += `<p class="muted">Tone: ${esc(s.tone.message)}</p>`;
    h += `<p class="muted">Nothing on this page is changed or posted for you. Fix what you agree with, then send the post for review in <a href="${esc(res.server)}/" target="_blank" rel="noopener">Live Brand Check</a>.</p>`;
    show(h, colour);
  }
})();
