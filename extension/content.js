// Live Brand Check on Instagram and Facebook: watches the post composer while you write and shows the
// findings in a small panel. It only reads: it never changes your caption, never clicks Share/Post,
// and never sends anything anywhere except your own Live Brand Check server.
(() => {
  if (window.__lbcLoaded) return;
  window.__lbcLoaded = true;
  const site = location.hostname.includes("facebook") ? "facebook" : "instagram";
  const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5 5 6.5v8.2c0 7 4.7 12.6 11 14.8 6.3-2.2 11-7.8 11-14.8V6.5z" fill="#1F3A68"/><circle cx="14.5" cy="14.5" r="5.2" fill="none" stroke="#F2A33A" stroke-width="2.6"/><path d="m18.4 18.4 4.2 4.2" stroke="#F2A33A" stroke-width="2.8" stroke-linecap="round"/></svg>`;
  const SEV = { blocker: ["Critical", "#b42318", "#fde7e5"], warning: ["Warning", "#a15c07", "#fdf1dc"], suggestion: ["Suggestion", "#3156b8", "#e6edfb"] };
  let root = null, timer = null, last = "", busy = false, open = false;
  let closed = false; // × pressed: nothing is shown on this page until it is reloaded
  let enabled = true; // the "Check posts on Instagram and Facebook" switch in the extension button
  let state = "idle", count = 0, blockers = 0, brand = "", lastHtml = "", warnedSig = "", bubbleTimer = null;

  // ---------- the panel (in a shadow root so the page's styles can't touch it) ----------
  // Two forms: the open card with a coloured status strip, and, when minimised, a round badge that keeps the
  // result visible (coloured ring, issue count, a pulse when a new critical issue appears).
  const STATES = {
    idle: ["#3156b8", "Live Brand Check is on"],
    checking: ["#3156b8", "Checking your post…"],
    blocker: ["#b42318", ""],
    warning: ["#a15c07", ""],
    clean: ["#1f6f43", ""],
    attention: ["#a15c07", ""],
    paused: ["#5b6472", "Checking is paused"],
  };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    :host{all:initial} *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .wrap{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
    .card{width:360px;max-width:calc(100vw - 32px);max-height:72vh;display:flex;flex-direction:column;background:#fff;color:#16181d;border:1px solid #dde1e8;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.28);overflow:hidden;font-size:13px;line-height:1.45}
    .card[hidden],.badge[hidden],.bubble[hidden]{display:none}
    .strip{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;color:#fff;background:var(--c,#3156b8);transition:background .3s}
    .strip .t{flex:1;min-width:0} .strip b{display:block;font-size:14px;line-height:1.25}
    .strip small{display:flex;align-items:center;gap:6px;font-size:12px;opacity:.92;margin-top:2px}
    .live{width:8px;height:8px;border-radius:50%;background:#fff;flex:none}
    .live.on{animation:blink 1.4s ease-in-out infinite}
    .strip button{background:rgba(255,255,255,.16);color:#fff;border-color:rgba(255,255,255,.45)}
    .strip button:hover{background:rgba(255,255,255,.28)}
    .logo{width:28px;height:28px;flex:none}
    .body{overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
    .muted{color:#5b6472;font-size:12px} .row{display:flex;gap:6px;flex-wrap:wrap}
    .pill{border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600}
    .f{border:1px solid #eceef2;border-radius:10px;padding:8px} .f q{display:block;margin:4px 0;font-style:italic;color:#333}
    .src{color:#5b6472;font-size:11px;margin-top:4px} .fix{margin-top:4px} .fix b{color:#1f6f43}
    button{font:inherit;border:1px solid #dde1e8;background:#fff;color:#16181d;border-radius:8px;padding:5px 10px;cursor:pointer}
    button:focus-visible{outline:2px solid #fff;outline-offset:2px}
    a{color:#3156b8} .banner{border-radius:10px;padding:8px;font-weight:600}
    .warn{border:2px solid #b42318;background:#fde7e5;color:#7a1610;border-radius:10px;padding:10px;font-weight:600}
    .warn span{display:block;font-weight:400;font-size:12px;margin-top:2px}
    .badge{position:relative;width:60px;height:60px;border-radius:50%;padding:0;border:4px solid var(--c,#3156b8);background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s,border-color .3s}
    .badge:hover{transform:scale(1.06)} .badge:focus-visible{outline:3px solid #3156b8;outline-offset:3px}
    .badge .logo{width:30px;height:30px}
    .count{position:absolute;top:-6px;right:-6px;min-width:24px;height:24px;padding:0 6px;border-radius:12px;background:var(--c,#3156b8);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
    .count[hidden]{display:none}
    .badge.pulse::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:4px solid var(--c);animation:ring 1.2s ease-out 3}
    .bubble{max-width:240px;background:#16181d;color:#fff;border-radius:12px;padding:8px 12px;font-size:13px;font-weight:600;box-shadow:0 8px 20px rgba(0,0,0,.3);animation:pop .25s ease-out}
    .enter{animation:slidein .4s cubic-bezier(.2,.8,.2,1),glow 1.6s ease-out .4s 2}
    @keyframes slidein{from{transform:translateX(calc(100% + 24px));opacity:0}to{transform:none;opacity:1}}
    @keyframes glow{0%{box-shadow:0 16px 40px rgba(15,23,42,.28),0 0 0 0 rgba(49,86,184,.55)}100%{box-shadow:0 16px 40px rgba(15,23,42,.28),0 0 0 14px rgba(49,86,184,0)}}
    @keyframes ring{from{transform:scale(1);opacity:.9}to{transform:scale(1.55);opacity:0}}
    @keyframes blink{50%{opacity:.25}}
    @keyframes pop{from{transform:translateY(6px);opacity:0}to{transform:none;opacity:1}}
    @media (prefers-reduced-motion: reduce){.enter,.badge.pulse::after,.live.on,.bubble{animation:none}}
    @media (prefers-color-scheme: dark){.card{background:#1b1e24;color:#e8eaee;border-color:#2c313a}.f{border-color:#2c313a}.f q{color:#cfd3da}.muted,.src{color:#9aa3b2}.body button{background:#22262d;color:#e8eaee;border-color:#2c313a}.fix b{color:#7fd1a0}a{color:#8fa9ec}.count{border-color:#1b1e24}.warn{background:#3a1512;color:#ffd9d4}}
  </style>
  <div class="wrap">
    <div class="card" id="card" role="complementary" aria-label="Live Brand Check" hidden>
      <div class="strip" id="strip">
        ${LOGO}
        <div class="t"><b id="title">Live Brand Check is on</b><small><span class="live" id="live"></span><span id="sub">Open a new post to start</span></small></div>
        <button id="again" title="Check again">Check</button>
        <button id="toggle" aria-expanded="true" title="Minimise" aria-label="Minimise">–</button>
        <button id="close" title="Close on this page (it comes back when you reload)" aria-label="Close Live Brand Check on this page">×</button>
      </div>
      <div class="body" id="body" aria-live="polite"><p class="muted">Start writing a post. Captions, images and banners in the composer are checked as you go.</p></div>
    </div>
    <div class="bubble" id="bubble" role="status" hidden></div>
    <button class="badge" id="badge" aria-label="Open Live Brand Check">${LOGO}<span class="count" id="count" hidden></span></button>
  </div>`;
  const $ = (id) => shadow.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function paint() {
    const [colour, fixed] = STATES[state] || STATES.idle;
    host.style.setProperty("--c", colour);
    $("strip").style.setProperty("--c", colour);
    $("badge").style.setProperty("--c", colour);
    $("count").style.setProperty("--c", colour);
    let title = fixed, sub = "";
    const watching = root && root.isConnected;
    if (state === "blocker") { title = `${plural(blockers, "critical issue")}`; sub = "Fix before posting"; }
    else if (state === "warning") { title = plural(count, "warning"); sub = "Worth fixing before you post"; }
    else if (state === "clean") { title = brand ? `Looks good for ${brand}` : "Looks good"; sub = "No critical issues or warnings"; }
    else if (state === "attention") { title = "Needs your attention"; sub = "See below"; }
    else if (state === "checking") sub = "Images are read on this device";
    else if (state === "paused") sub = "Turn it on from the extension button";
    if (watching && state !== "checking" && state !== "paused") sub = sub ? `Watching this post · ${sub}` : "Watching this post";
    if (!sub) sub = "Open a new post to start";
    $("title").textContent = title;
    $("sub").textContent = sub;
    $("live").classList.toggle("on", !!watching || state === "checking");
    $("card").hidden = !open;
    $("badge").hidden = open;
    $("toggle").setAttribute("aria-expanded", String(open));
    const n = state === "blocker" || state === "warning" ? count : 0;
    $("count").hidden = !n;
    $("count").textContent = n > 9 ? "9+" : String(n);
    $("badge").setAttribute("aria-label", `Open Live Brand Check: ${title}`);
    if (closed || !enabled) { host.remove(); return; }
    if (!host.isConnected) document.documentElement.appendChild(host);
  }
  const show = (html, s) => { lastHtml = html; $("body").innerHTML = html; if (s) state = s; paint(); };
  function setOpen(v, animate) {
    open = v;
    paint();
    if (v && animate) { const c = $("card"); c.classList.remove("enter"); void c.offsetWidth; c.classList.add("enter"); }
    if (v) $("bubble").hidden = true;
  }
  function nudge(text) { // minimised: pulse the badge and say what changed, for a few seconds
    const b = $("badge");
    b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse");
    if (!text || open) return;
    $("bubble").textContent = text;
    $("bubble").hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { $("bubble").hidden = true; }, 6000);
  }
  $("toggle").onclick = (e) => { e.stopPropagation(); setOpen(false); };
  $("close").onclick = (e) => { e.stopPropagation(); closed = true; clearTimeout(timer); host.remove(); };

  // The switch in the extension button turns the panel off (or on) in every open tab straight away.
  chrome.storage.sync.get({ enabled: true }).then((v) => { enabled = v.enabled !== false; paint(); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) { enabled = changes.enabled.newValue !== false; last = ""; paint(); }
  });
  $("badge").onclick = () => setOpen(true, true);
  $("again").onclick = (e) => { e.stopPropagation(); last = ""; run(); };
  paint();

  // ---------- first time on Instagram or Facebook: how to try it ----------
  chrome.storage.local.get({ lbcGuideSeen: false }).then(({ lbcGuideSeen }) => {
    if (lbcGuideSeen || root) return;
    const where = site === "facebook" ? "Facebook" : "Instagram";
    const steps = site === "facebook"
      ? ["Click <b>What's on your mind?</b> to start a post.", "Add a photo if you like, and type your caption.", "This panel checks it as you type. Fix what you agree with."]
      : ["Click <b>Create</b> (+) in the left menu, then <b>Post</b>.", "<b>Select from computer</b>: choose an image (try the sample banner from the extension page), then <b>Next</b>, <b>Next</b>.", "Type in <b>Write a caption…</b>. This panel checks the caption and the image as you go."];
    show(`<p><b>Live Brand Check is on</b></p><p class="muted">Try it on a new ${where} post:</p>`
      + steps.map((t, i) => `<div class="row" style="flex-wrap:nowrap"><span class="pill" style="background:#e6edfb;color:#3156b8">${i + 1}</span><span>${t}</span></div>`).join("")
      + `<p class="muted">Nothing is posted or changed for you: don't press Share while testing.</p><button id="lbc-got-it">Got it</button>`, "idle");
    setOpen(true, true);
    $("lbc-got-it").onclick = () => { chrome.storage.local.set({ lbcGuideSeen: true }); show("<p class='muted'>Start writing a post. Captions, images and banners in the composer are checked as you go.</p>", "idle"); setOpen(false); };
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
    if (closed || !enabled) return;
    if (r !== root) { // a new composer: announce ourselves even if the panel was minimised
      root = r; last = ""; warnedSig = "";
      state = "idle"; show("<p class='muted'>Watching this post. Captions, images and banners are checked as you write.</p>");
      setOpen(true, true);
    }
    root = r;
    clearTimeout(timer);
    timer = setTimeout(run, 1500);
  }

  document.addEventListener("input", (e) => { if (isBox(e.target)) schedule(composerOf(e.target)); }, true);
  document.addEventListener("focusin", (e) => { if (isBox(e.target) && e.target.closest('[role="dialog"]')) schedule(composerOf(e.target)); }, true);
  const COMPOSER = /create (new )?post|what's on your mind|create post|write a caption/i;
  let pending = false;
  function onMutations() {
    pending = false;
    if (root && !root.isConnected) { // composer closed: back to the badge
      root = null; last = ""; state = "idle";
      show("<p class='muted'>Start writing a post. Captions, images and banners in the composer are checked as you go.</p>");
      setOpen(false);
      return;
    }
    if (!root) { // a composer dialog just opened (before anything is typed)
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.getClientRects().length > 0 && COMPOSER.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || "").slice(0, 400)));
      if (d) schedule(d);
      return;
    }
    if (!busy) { const sig = textOf(root) + imagesOf(root).map((i) => i.src).join("|"); if (sig !== last) schedule(root); }
  }
  new MutationObserver(() => { if (!pending) { pending = true; setTimeout(onMutations, 400); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  // ---------- before Share / Post: make sure unfixed critical issues are seen (never blocks or clicks) ----------
  const isShare = (el) => {
    const b = el?.closest?.('[role="button"], button');
    if (!b || !root || !root.contains(b)) return false;
    return /^(share|post|publish|post now)$/i.test((b.getAttribute("aria-label") || b.innerText || "").trim());
  };
  function warnBeforeShare(e) {
    if (closed || !enabled || !blockers || !isShare(e.target) || warnedSig === last) return;
    warnedSig = last;
    $("body").innerHTML = `<div class="warn" role="alert">Before you post: ${plural(blockers, "critical issue")} ${blockers === 1 ? "hasn't" : "haven't"} been fixed.<span>Live Brand Check doesn't stop you posting. Fix them, or send the post for review instead.</span></div>` + lastHtml;
    setOpen(true, true);
  }
  ["pointerover", "focusin", "pointerdown"].forEach((t) => document.addEventListener(t, warnBeforeShare, true));

  // ---------- checking ----------
  async function run() {
    if (!root || !root.isConnected || busy) return;
    const text = textOf(root), images = imagesOf(root);
    const sig = text + images.map((i) => i.src).join("|");
    if (sig === last) return;
    last = sig;
    busy = true;
    state = "checking";
    show(`<p class="muted">Checking${images.length ? ` the caption and ${images.length} image${images.length > 1 ? "s" : ""} (images are read on this device)` : " the caption"}…</p>`);
    try {
      const res = await chrome.runtime.sendMessage({ type: "check", text, images, site });
      render(res);
    } catch (e) {
      show(`<p>Couldn't reach the extension: ${esc(e.message)}. Reload this page.</p>`, "attention");
    } finally {
      busy = false;
    }
  }

  function render(res) {
    const before = blockers;
    blockers = 0; count = 0;
    if (!res) return show("<p class='muted'>No answer from the checker.</p>", "attention");
    if (res.off) return show("<p class='muted'>Checking is paused. Turn it on from the extension button.</p>", "paused");
    if (res.error) {
      if (res.status === 401) return show(`<p><b>Sign in to check posts.</b></p><p class="muted">Open <a href="${esc(res.server)}/login" target="_blank" rel="noopener">Live Brand Check</a> in this browser, sign in, then press Check.</p>`, "attention");
      if (!res.status && /fetch|network|load/i.test(res.error)) {
        return show(`<p><b>Can't reach Live Brand Check.</b></p><p class="muted">The extension is set to <b>${esc(res.server)}</b>. Check that this address opens in a new tab (for a local copy, the app must be running), or change it from the extension button. Then press Check.</p><p class="muted">To hide this panel, press × above.</p>`, "attention");
      }
      return show(`<p><b>Couldn't check this post.</b></p><p class="muted">${esc(res.error)}</p>`, "attention");
    }
    if (res.empty) return show("<p class='muted'>Nothing to check yet.</p>", "idle");
    const fs = res.findings || [], s = res.summary || {};
    brand = res.brand || brand;
    blockers = s.blocker || 0;
    count = blockers + (s.warning || 0);
    const next = blockers ? "blocker" : s.warning ? "warning" : (res.unread || []).length ? "attention" : "clean";
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
    show(h, next);
    if (blockers > before) nudge(`${plural(blockers, "critical issue")} found`);
  }
})();
