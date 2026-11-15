"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ROLES } from "./RoleProvider";
import Icon from "./Icon";
import { resetTour } from "./Tour";
import { becomePerson, NO_DEMO_ACCOUNT } from "@/lib/person";
import { STAGES, goToStage, readJourney } from "@/lib/journey";

const KEY = "lbc-demo-steps";

// The demo, in the order a judge would walk it. Each step signs in as the right person and opens the right screen,
// with a ready-made example where one helps. Everything still works by hand afterwards.
// Steps with `find` open the history of an approved post whose approval rests on an approved fact.
// The main story is the guided journey (lib/journey.js). These are extra things to explore afterwards.
const STEPS = [
  { id: "fix", role: "Creator", href: "/?example=disclosure", title: "Fix a post in one click",
    body: "Press Accept fix to add #ad, then try Adapt for other platforms: one post, checked for each platform." },
  { id: "senior", role: "Marketing head", href: "/review", title: "Sensitive posts go to the marketing head",
    body: "The Diwali greeting mentions a festival, so only Meera can approve it." },
  { id: "history", role: "Reviewer", find: "evidence", title: "See the tamper-proof history",
    body: "Open an approved post: every version side by side, the facts its approval rests on, a log where each entry is fingerprinted and linked to the one before, and a PDF approval record." },
  { id: "reopen", role: "Marketing head", find: "evidence", query: "?demo=reopen", title: "Change a fact, and the approval reopens",
    body: "That approval relied on an approved fact. Change the fact as Meera and watch the post go back to review, with the reason, in the tamper-proof log." },
  { id: "patterns", role: "Marketing head", href: "/insights", title: "Spot repeated mistakes",
    body: "See which rules fire most and which ones people keep overriding. Analytics has the full numbers." },
  { id: "kit", role: "Marketing head", href: "/workspace#import", title: "Import a brand kit from a PDF",
    body: "Optional: the demo brand is already loaded. Read the sample PDF in one click and review what the app found." },
];

const readDone = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const writeDone = (ids) => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } };

// The guided demo uses the sample brand. With several brands, open it first.
async function openSampleBrand() {
  const d = await api("/brands").catch(() => null);
  const sample = d?.brands.find((b) => b.sample);
  if (sample && !sample.current) await api("/brand", { method: "POST", body: { id: sample.id } });
}

async function approvedPost(query = "") {
  const posts = await api("/drafts?status=approved").catch(() => []);
  const p = posts.find((x) => x.evidence > 0) || posts[0];
  return `/drafts/${p ? p.id : "s1"}${query}`;
}

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
      if (!(await becomePerson(step.role, person))) { setError(NO_DEMO_ACCOUNT); setGoing(null); return; }
      await openSampleBrand();
      window.location.href = step.find ? await approvedPost(step.query) : step.href;
    } catch (e) { setError(e.message); setGoing(null); }
  }

  // Put the demo back to its starting state. Only the marketing head may reset, so act as Meera for it,
  // then return to whoever was signed in. (Personal accounts are kept by the reset.)
  async function startOver() {
    setGoing("reset"); setError("");
    try {
      const back = person?.role;
      if (!(await becomePerson("Marketing head", person))) { setError(NO_DEMO_ACCOUNT); setGoing(null); return; }
      await api("/reset", { method: "POST" });
      if (back && back !== "Marketing head") await becomePerson(back, { ...person, role: "Marketing head" });
      writeDone([]);
      resetTour(); // the tips start again too
      window.location.href = "/overview";
    } catch (e) { setError(e.message); setGoing(null); }
  }

  const [journey, setJourney] = useState(null);
  useEffect(() => {
    const sync = () => setJourney(readJourney());
    sync();
    window.addEventListener("lbc:journey-change", sync);
    return () => window.removeEventListener("lbc:journey-change", sync);
  }, []);
  async function startJourney(i = 0) {
    setGoing(`j${i}`); setError("");
    try { if (!(await goToStage(i, person))) { setError(NO_DEMO_ACCOUNT); setGoing(null); } }
    catch (e) { setError(e.message); setGoing(null); }
  }
  return (
    <section className="panel overflow-hidden" aria-labelledby="guide-title" data-tour="guide">
      <div className="flex flex-wrap items-center gap-3 bg-navy px-5 py-4 text-white">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal text-ink"><Icon name="sparkle" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="guide-title" className="text-base font-semibold">Guided demo</h2>
          <p className="text-sm text-white/65">One story across the creator, the reviewer and the marketing head, ending with the Chrome extension on real Instagram. About 10 minutes.</p>
        </div>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label={open ? "Hide the guided demo" : "Show the guided demo"}>
          <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <button className="btn btn-teal" disabled={!!going} onClick={() => startJourney(journey ? journey.i : 0)} data-tour="guide-step-1">
              {going === `j${journey ? journey.i : 0}` ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="sparkle" className="h-4 w-4" />}
              {journey ? `Continue the guided demo (step ${journey.i + 1} of ${STAGES.length})` : "Start the guided demo"}
            </button>
            <span className="text-xs text-muted">A guide card follows you from page to page and switches person for you at each step.</span>
          </div>
          <ol className="divide-y divide-line">
            {STAGES.map((s, i) => {
              const now = journey?.i === i, past = journey && journey.i > i;
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:flex-nowrap ${now ? "bg-teal-soft/40" : ""}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${past ? "bg-approved-soft text-approved" : now ? "bg-teal text-ink" : "bg-canvas text-muted ring-1 ring-line"}`}>
                    {past ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="text-sm font-medium">{s.title} <span className="font-normal text-muted">· {s.who}</span></p>
                  </div>
                  <button onClick={() => startJourney(i)} disabled={!!going} className="btn btn-quiet btn-sm ml-11 shrink-0 sm:ml-0">
                    {going === `j${i}` ? <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" /> : null}Open
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="border-t border-line bg-canvas/60 px-5 pb-1 pt-3 text-xs font-medium text-muted">More to explore afterwards</p>
          <ol className="divide-y divide-line">
            {STEPS.map((s, i) => {
              const isDone = done.includes(s.id);
              const who = ROLES[s.role];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:flex-nowrap">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${isDone ? "bg-approved-soft text-approved" : "bg-canvas text-muted ring-1 ring-line"}`}>
                    {isDone ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} /> : <Icon name="sparkle" className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{s.body}</p>
                  </div>
                  <button onClick={() => go(s)} disabled={!!going} className="btn btn-quiet btn-sm ml-11 shrink-0 sm:ml-0">
                    {going === s.id ? <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" /> : null}
                    {person?.role === s.role ? (isDone ? "Open again" : "Open") : `Open as ${who.split(" (")[0]}`}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-canvas/60 px-5 py-3 text-xs text-muted">
            <span className="min-w-0 flex-1">{person?.uid ? "Each step signs in with the right demo account for you." : "You can switch person any time from the account menu in the top right."} Everything here is fictional demo data.</span>
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
