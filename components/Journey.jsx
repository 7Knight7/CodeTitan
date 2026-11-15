"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { STAGES, goToStage, readJourney, writeJourney } from "@/lib/journey";
import { NO_DEMO_ACCOUNT } from "@/lib/person";
import { useRole } from "./RoleProvider";
import Icon from "./Icon";

/* The guided demo's coach: a card on every page that says which step of the story you are on, what to do,
   and, once that's done, offers to continue as the next person. Start it from "Guided demo" on the overview. */
export default function Journey() {
  const { person } = useRole();
  const path = usePathname();
  const [j, setJ] = useState(null);
  const [open, setOpen] = useState(true);
  const [going, setGoing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setJ(readJourney());
    sync();
    window.addEventListener("lbc:journey-change", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("lbc:journey-change", sync); window.removeEventListener("storage", sync); };
  }, []);

  // A step is done when the page reports the event it waits for.
  useEffect(() => {
    const onEvent = (e) => {
      const cur = readJourney();
      if (cur && !cur.done && STAGES[cur.i]?.doneOn === e.detail) { writeJourney({ ...cur, done: true }); setOpen(true); }
    };
    window.addEventListener("lbc:journey", onEvent);
    return () => window.removeEventListener("lbc:journey", onEvent);
  }, []);

  // While a screen tip is open, step aside so only one guide shows at a time; come back when it closes.
  const [tipOpen, setTipOpen] = useState(false);
  useEffect(() => {
    setTipOpen(!!window.__lbcTipOpen);
    const onTip = (e) => setTipOpen(!!e.detail);
    window.addEventListener("lbc:tip", onTip);
    return () => window.removeEventListener("lbc:tip", onTip);
  }, []);

  // Point at the part of the screen the step is about.
  const stage = j ? STAGES[j.i] : null;
  useEffect(() => {
    if (!stage?.highlight) return undefined;
    let el = null;
    const t = setInterval(() => {
      el = document.querySelector(`[data-tour="${stage.highlight}"]`);
      if (el) { el.classList.add("lbc-highlight"); clearInterval(t); }
    }, 300);
    return () => { clearInterval(t); el?.classList.remove("lbc-highlight"); };
  }, [stage?.highlight, path]);

  if (!j || !stage || !person || tipOpen) return null;
  const last = j.i === STAGES.length - 1;
  const next = STAGES[j.i + 1];
  const wrongPerson = person.role !== stage.role;
  const ready = j.done || !stage.doneOn;

  async function go(i) {
    setGoing(true); setError("");
    try { if (!(await goToStage(i, person))) { setError(NO_DEMO_ACCOUNT); setGoing(false); } }
    catch (e) { setError(e.message); setGoing(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-navy px-4 py-2.5 text-sm font-medium text-white shadow-xl">
        <Icon name="sparkle" className="h-4 w-4 text-teal" />Guided demo · step {j.i + 1} of {STAGES.length}
      </button>
    );
  }

  return (
    <aside aria-label="Guided demo" className="pop-in fixed inset-x-4 bottom-4 z-40 overflow-hidden rounded-lg border border-line bg-surface shadow-xl sm:left-auto sm:w-[23rem]">
      <div className="flex items-center gap-2 bg-navy px-4 py-2.5 text-white">
        <Icon name="sparkle" className="h-4 w-4 text-teal" />
        <span className="flex-1 text-xs font-medium">Guided demo · step {j.i + 1} of {STAGES.length} · {stage.who}</span>
        <button onClick={() => setOpen(false)} aria-label="Minimise the guided demo" className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"><Icon name="chevronDown" className="h-4 w-4" /></button>
        <button onClick={() => writeJourney(null)} aria-label="End the guided demo" className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"><Icon name="close" className="h-4 w-4" /></button>
      </div>
      <div className="h-1 bg-canvas" aria-hidden><div className="h-full bg-teal transition-all" style={{ width: `${((j.i + (ready ? 1 : 0.5)) / STAGES.length) * 100}%` }} /></div>
      <div className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">{stage.title}</h2>
        {wrongPerson ? (
          <p className="text-sm text-muted">This step is for {stage.who}.</p>
        ) : (
          <p className="text-sm leading-6 text-muted">{stage.body}</p>
        )}
        {stage.links && !wrongPerson && (
          <div className="flex flex-wrap gap-1.5">{stage.links.map((l) => <Link key={l.href} href={l.href} className="chip hover:border-line-strong">{l.label}</Link>)}</div>
        )}
        {j.done && stage.doneText && <p className="flex items-center gap-2 rounded-md bg-approved-soft px-3 py-2 text-sm text-approved"><Icon name="checkCircle" className="h-4 w-4 shrink-0" />{stage.doneText}</p>}
        {!ready && !wrongPerson && <p className="text-xs text-muted">The next step opens when you&rsquo;ve done this.</p>}
        {ready && !wrongPerson && next && next.role !== stage.role && (
          <p className="flex items-start gap-2 rounded-md bg-teal-soft px-3 py-2 text-sm text-ink">
            <Icon name="user" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />
            <span>{stage.doneOn ? `${stage.who.split(" (")[0]}'s part is done. Next, ` : "When you've looked around, "}<b>{next.who}</b> takes over: press the button to switch.</span>
          </p>
        )}
        {error && <p role="alert" className="rounded bg-blocker-soft px-2 py-1 text-xs text-blocker">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {wrongPerson ? (
            <button className="btn btn-teal btn-sm" disabled={going} onClick={() => go(j.i)}>{going ? "Opening…" : `Open as ${stage.who.split(" (")[0]}`}</button>
          ) : last ? (
            <button className="btn btn-teal btn-sm" onClick={() => writeJourney(null)}>Finish the demo</button>
          ) : (
            <button className={`btn btn-sm ${ready ? "btn-teal" : "btn-quiet"}`} disabled={going} onClick={() => go(j.i + 1)}>
              {going ? "Opening…" : !ready ? "Skip this step" : next.role === stage.role ? `Next: ${next.title}` : `Continue as ${next.who.split(" (")[0]}`}<Icon name="arrowRight" className="h-3.5 w-3.5" />
            </button>
          )}
          {path !== stage.href.split("#")[0].split("?")[0] && !wrongPerson && (
            <Link href={stage.href} className="btn btn-quiet btn-sm">Go to this step&rsquo;s page</Link>
          )}
          {j.i > 0 && <button className="ml-auto text-xs text-muted hover:text-ink" disabled={going} onClick={() => go(j.i - 1)}>Back</button>}
        </div>
      </div>
    </aside>
  );
}
