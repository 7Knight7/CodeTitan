// Every request carries X-LBC: 1. The server rejects state-changing requests without it,
// which blocks cross-site form posts (CSRF). The session cookie is HttpOnly, so scripts can't read it.
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "X-LBC": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && path !== "/login" && typeof window !== "undefined" && window.location.pathname !== "/login") {
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
