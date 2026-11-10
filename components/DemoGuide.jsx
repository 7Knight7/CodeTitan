"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ROLES } from "./RoleProvider";
import Icon from "./Icon";

const KEY = "lbc-demo-steps";

// The demo, in the order a judge would walk it. Each step signs in as the right person and opens the right screen,
// with a ready-made example where one helps. Everything still works by hand afterwards.
const STEPS = [
  { id: "catch", role: "Creator", href: "/?example=claims", title: "See what gets caught",
    body: "A post full of risky claims is checked against the brand kit and Indian ad rules. Every problem is underlined and names its source." },
  { id: "fix", role: "Creator", href: "/?example=disclosure", title: "Fix a post in one click and send it",
    body: "Press Accept fix to add #ad, then Send for review. You can also try Adapt for other platforms." },
  { id: "approve", role: "Reviewer", href: "/review", title: "Approve it as the reviewer",
    body: "Arjun sees the post, the automated checks and Priya's decisions. Approve it or ask for changes; Brand memory learns from it." },
  { id: "senior", role: "Marketing head", href: "/review", title: "Sensitive posts go to the marketing head",
    body: "The Diwali greeting mentions a festival, so only Meera can approve it." },
  { id: "patterns", role: "Marketing head", href: "/insights", title: "Spot repeated mistakes",
    body: "See which rules fire most and which ones people keep overriding. Analytics has the full numbers." },
  { id: "kit", role: "Marketing head", href: "/workspace#import", title: "Import a brand kit from a PDF",
    body: "Optional: the demo brand is already loaded. Read the sample PDF in one click and review what the app found." },
];

const readDone = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const writeDone = (ids) => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } };

export default function DemoGuide({ person }) {
  const [done, setDone] = useState([]);
  const [open, setOpen] = useState(true);
  const [going, setGoing] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDone(readDone()); }, []);

  async function go(step) {
    setGoing(step.id); setError("");
    const next = [...new Set([...done, step.id])];
    setDone(next); writeDone(next);
    try {
      if (person?.role !== step.role) await api("/session/role", { method: "POST", body: { role: step.role } });
      window.location.href = step.href;
    } catch (e) { setError(e.message); setGoing(null); }
  }

  // Put the demo back to its starting state. Only the marketing head may reset, so switch to Meera for it,
  // then return to whoever was signed in.
  async function startOver() {
    setGoing("reset"); setError("");
    try {
      const back = person?.role;
      if (back !== "Marketing head") await api("/session/role", { method: "POST", body: { role: "Marketing head" } });
      await api("/reset", { method: "POST" });
      if (back && back !== "Marketing head") await api("/session/role", { method: "POST", body: { role: back } });
      writeDone([]);
      window.location.href = "/overview";
    } catch (e) { setError(e.message); setGoing(null); }
  }

  const count = STEPS.filter((s) => done.includes(s.id)).length;
  return (
    <section className="panel overflow-hidden" aria-labelledby="guide-title">
      <div className="flex flex-wrap items-center gap-3 bg-navy px-5 py-4 text-white">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal text-ink"><Icon name="sparkle" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="guide-title" className="text-base font-semibold">Guided demo</h2>
          <p className="text-sm text-white/65">A sample brand kit is already loaded. Follow the steps, or explore on your own.</p>
        </div>
        <span className="text-xs text-white/60">{count} of {STEPS.length} done</span>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label={open ? "Hide the guided demo" : "Show the guided demo"}>
          <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div className="h-1 bg-navy-2" aria-hidden><div className="h-full bg-teal transition-all" style={{ width: `${(count / STEPS.length) * 100}%` }} /></div>
      {open && (
        <>
          <ol className="divide-y divide-line">
            {STEPS.map((s, i) => {
              const isDone = done.includes(s.id);
              const who = ROLES[s.role];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:flex-nowrap">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${isDone ? "bg-approved-soft text-approved" : "bg-canvas text-muted ring-1 ring-line"}`}>
                    {isDone ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{s.body}</p>
                  </div>
                  <button onClick={() => go(s)} disabled={!!going}
                    className={`btn btn-sm ml-11 shrink-0 sm:ml-0 ${isDone ? "btn-quiet" : "btn-teal"}`}>
                    {going === s.id ? <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" /> : null}
                    {person?.role === s.role ? (isDone ? "Open again" : "Open") : `Open as ${who.split(" (")[0]}`}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-canvas/60 px-5 py-3 text-xs text-muted">
            <span className="min-w-0 flex-1">You can switch person any time from the account menu in the top right. Everything here is fictional demo data.</span>
            {!confirmReset
              ? <button className="btn btn-ghost btn-sm" disabled={!!going} onClick={() => setConfirmReset(true)}><Icon name="refresh" className="h-3.5 w-3.5" />Start the demo over</button>
              : (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">Remove everything you created and restore the sample data?</span>
                  <button className="btn btn-primary btn-sm" disabled={!!going} onClick={startOver}>{going === "reset" ? "Restoring…" : "Yes, start over"}</button>
                  <button className="btn btn-quiet btn-sm" disabled={!!going} onClick={() => setConfirmReset(false)}>Cancel</button>
                </span>
              )}
          </div>
          {error && <p role="alert" className="border-t border-line bg-blocker-soft px-5 py-2.5 text-sm text-blocker">{error}</p>}
        </>
      )}
    </section>
  );
}
