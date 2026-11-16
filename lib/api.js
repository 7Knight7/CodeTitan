// Pages anyone can open without signing in (they handle their own errors).
export const PUBLIC_PAGES = ["/login", "/setup", "/invite"];

// Every request carries X-LBC: 1. The server rejects state-changing requests without it,
// which blocks cross-site form posts (CSRF). The session cookie is HttpOnly, so scripts can't read it.
// Speed: identical GET requests made at the same moment share one call, and answers are reused briefly
// (fixed platform data for 10 minutes, everything else for 2 seconds). Any change (POST, PUT, PATCH, DELETE)
// clears the cache, so the screen never shows data older than the change that was just made.
const cache = new Map(); // path -> { at, ttl, promise }
const ttlFor = (path) => (/^\/(platforms|input-schema|validation-profile)\b/.test(path) ? 600000 : 2000);

export function api(path, opts = {}) {
  const method = opts.method || "GET";
  if (method !== "GET") {
    cache.clear();
    return request(path, opts);
  }
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise.then(copy);
  const promise = request(path, opts);
  cache.set(path, { at: Date.now(), ttl: ttlFor(path), promise });
  promise.catch(() => cache.delete(path)); // never keep a failed answer
  return promise.then(copy);
}

const copy = (data) => (data === null || typeof data !== "object" ? data : structuredClone(data));

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "X-LBC": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  const open = typeof window !== "undefined" && PUBLIC_PAGES.includes(window.location.pathname);
  if (res.status === 401 && !path.startsWith("/login") && typeof window !== "undefined" && !open) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (!res.ok) {
    const d = data?.detail;
    const message = typeof d === "string" ? d : d?.message || (Array.isArray(d) ? "Some input is too long or invalid." : `Request failed (${res.status})`);
    const err = new Error(message);
    err.detail = d;
    throw err;
  }
  return data;
}

// Tell other parts of the page (e.g. the creator's change-request note) that a post's status changed.
export const DRAFTS_EVENT = "lbc:drafts-changed";
export function draftsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DRAFTS_EVENT));
}

export const STATUS_LABEL = {
  draft: "Draft",
  in_review: "Waiting for review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export function when(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
