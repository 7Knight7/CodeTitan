"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import Icon from "./Icon";

const status = (b) => (b.empty ? "No brand kit live" : b.live ? "Brand kit live" : "Sample brand kit ready");

/* The Workspace box in the sidebar. An agency works on several brands: marketing heads see every brand and can
   add one; creators and reviewers see the brands they work on. Switching reloads the app in that brand. */
export default function BrandSwitcher({ workspace, person }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef(null);

  useEffect(() => { if (person) api("/brands").then(setD).catch(() => {}); }, [person]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setAdding(false); } };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); setAdding(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const current = d?.brands.find((b) => b.current);
  const many = (d?.brands.length || 0) > 1 || d?.can_add;

  async function pick(b) {
    if (b.current) { setOpen(false); return; }
    setBusy(true); setError("");
    try { await api("/brand", { method: "POST", body: { id: b.id } }); window.location.href = "/overview"; }
    catch (e) { setError(e.message); setBusy(false); }
  }
  async function add(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api("/brands", { method: "POST", body: { name: name.trim() } }); window.location.href = "/workspace"; }
    catch (err) { setError(err.message); setBusy(false); }
  }

  const label = current?.name || workspace?.name || "…";
  const line = current ? status(current) : workspace ? (workspace.empty ? "No brand kit live" : workspace.live ? "Brand kit live" : "Sample brand kit ready") : "Loading";
  const empty = current ? current.empty : workspace?.empty;

  return (
    <div ref={box} className="relative mx-3 mb-4" data-tour="brand-switcher">
      <button type="button" onClick={() => many && setOpen(!open)} aria-haspopup={many ? "listbox" : undefined} aria-expanded={many ? open : undefined}
        className={`w-full rounded-md border border-line bg-surface/60 px-3.5 py-3 text-left ${many ? "transition-colors hover:border-line-strong" : "cursor-default"}`}>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-2xs text-muted">{many ? `Workspace · ${d.brands.length} brand${d.brands.length === 1 ? "" : "s"}` : "Workspace"}</span>
            <span className="mt-0.5 block truncate text-sm font-medium">{label}</span>
          </span>
          {many && <Icon name="chevronDown" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-2xs text-muted">
          <span className={`dot ${empty ? "bg-warning-vivid" : "bg-approved-vivid"}`} aria-hidden />{line}
        </span>
      </button>

      {open && d && (
        <div className="pop-in absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-md border border-line bg-surface shadow-xl">
          <p className="px-3.5 pb-1 pt-2.5 text-2xs text-muted">{d.can_add ? "All brands" : "Your brands"}</p>
          <ul role="listbox" aria-label="Brands" className="max-h-64 overflow-y-auto pb-1">
            {d.brands.map((b) => (
              <li key={b.id}>
                <button type="button" role="option" aria-selected={b.current} disabled={busy} onClick={() => pick(b)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-canvas ${b.current ? "font-medium" : ""}`}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-canvas text-2xs font-semibold text-muted ring-1 ring-line">{b.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate">{b.name}</span><span className="block text-2xs font-normal text-muted">{status(b)}</span></span>
                  {b.current && <Icon name="check" className="h-4 w-4 shrink-0 text-teal-dark" />}
                </button>
              </li>
            ))}
          </ul>
          {d.can_add && (
            <div className="border-t border-line p-2.5">
              {adding ? (
                <form onSubmit={add} className="space-y-2">
                  <label className="label" htmlFor="new-brand">New brand name</label>
                  <input id="new-brand" className="field py-1.5" autoFocus required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Acme Foods" />
                  <p className="text-2xs text-muted">It starts with Indian ad rules only. Next you upload its brand kit and choose who works on it.</p>
                  <div className="flex gap-2">
                    <button className="btn btn-teal btn-sm" disabled={busy || name.trim().length < 2}>{busy ? "Adding…" : "Add brand"}</button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAdding(false)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <button type="button" className="btn btn-quiet btn-sm w-full justify-center" onClick={() => setAdding(true)}><Icon name="plus" className="h-3.5 w-3.5" />Add brand</button>
              )}
            </div>
          )}
          {error && <p role="alert" className="border-t border-line bg-blocker-soft px-3.5 py-2 text-xs text-blocker">{error}</p>}
        </div>
      )}
    </div>
  );
}
