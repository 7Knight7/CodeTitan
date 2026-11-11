"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useRole } from "./RoleProvider";
import Icon from "./Icon";

/* First-run walkthrough. The first time someone opens a screen (or reaches a new state, such as their first check
   results), a small tip card points at the part of the screen that matters and ends with what to do next.
   Tips never block the page: the highlighted control stays clickable. The "?" button in the top bar replays them.
   Targets are elements marked with data-tour="<name>". Progress lives in this browser only. */

const KEY = "lbc-tour";
const read = () => { try { return { off: false, seen: [], ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { off: false, seen: [] }; } };
const write = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } };
export const resetTour = () => { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

const NAV = ["nav", "menu-button"]; // sidebar on large screens, menu button on small ones

export const TOURS = {
  overview: [
    { welcome: true, title: "Welcome to Live Brand Check",
      body: "It checks marketing posts against a brand kit and Indian advertising rules before they go out. A sample brand is already loaded, so you can try everything straight away. These tips show you around." },
    { target: "guide", title: "Start here", body: "The guided demo walks you through the product. Each step opens the right screen as the right person." },
    { target: NAV, title: "Every screen is here", body: "Content checker to write and check posts, Review & approvals, Brand guidelines, Insights and Analytics." },
    { target: "account", title: "Switch person any time", body: "Priya writes posts, Arjun reviews them, and Meera (marketing head) approves sensitive posts and manages the brand kit." },
    { target: "help", title: "Tips are always here", body: "Press this to see the tips for any screen again." },
    { target: "guide-step-1", title: "Your next step", body: "Press Open on step 1 to see what the checker catches." },
  ],
  checker: [
    { target: "examples", title: "Try a ready-made example", body: "Pick any example: it fills in a real post and checks it for you. You can also write your own." },
    { target: "setup", title: "Where it will be published", body: "The platform, the format and whether it is paid decide which fields you fill in and which rules apply." },
    { target: "check-button", title: "Your next step: check the post", body: "Pick an example above, or fill in the fields and press Check post. Results appear next to the post." },
  ],
  "checker-viewer": [
    { target: "examples", title: "Ready-made examples", body: "Each example fills in a real post and checks it. Only creators can run checks." },
    { target: "account", title: "Your next step", body: "To check and send posts, switch to Priya (social media).", action: { label: "Switch to Priya", role: "Creator", href: "/" } },
  ],
  "checker-results": [
    { target: "verdict", title: "Can this post go out?", body: "This says whether the post can be sent for review, and what each layer of checks found." },
    { target: "issue", title: "Each issue explains itself", body: "What is wrong, why, the rule or approved fact it comes from, and a fix. Accept the fix, edit it, or keep the original with a reason." },
    { target: "proof-text", title: "Problems are marked in the text", body: "Click an underlined phrase to jump to its issue." },
    { target: "send", title: "Your next step: send it for review", body: "When no blockers are left, press Send for review. Each blocker must be fixed, or kept with a reason, first." },
  ],
  "checker-sent": [
    { target: "sent", title: "Sent. Next: review it", body: "The post is now waiting for the reviewer. Switch to Arjun to approve it or ask for changes.",
      action: { label: "Open Review as Arjun", role: "Reviewer", href: "/review" } },
  ],
  review: [
    { target: "queue", title: "Posts to review", body: "Posts waiting for a decision are listed here, newest first. Pick one to open it." },
    { target: "review-checks", title: "Checks and the creator's choices", body: "What the automatic checks found, next to what the creator fixed or kept and why. Only a person approves." },
    { target: "decision", title: "Your next step: decide", body: "Approve the post, or ask for changes with a comment for the creator. Sensitive posts can only be approved by the marketing head." },
    { target: NAV, title: "Then: spot patterns", body: "Insights and Analytics show which mistakes keep coming back. Meera (marketing head) can open them." },
  ],
  "review-creator": [
    { target: "queue", title: "Where your posts are", body: "Posts you sent for review, and the ones sent back to you, are listed here with their status." },
    { target: "account", title: "Your next step", body: "Reviewers approve posts. Switch to Arjun to see the review side.", action: { label: "Switch to Arjun", role: "Reviewer", href: "/review" } },
  ],
  workspace: [
    { target: "identity", title: "The brand kit in use", body: "Every check uses this brand's colours, approved facts, rules and guidelines. The sample brand is already loaded." },
    { target: "facts", title: "Approved facts", body: "Fees, offers and results in posts are compared with these, including the dates they are valid." },
    { target: "import", title: "Your next step: import a brand kit", body: "To see how a new brand is set up, read the sample PDF in one click. The demo brand can be restored afterwards." },
  ],
  insights: [
    { target: "scope", title: "Which posts count", body: "Numbers cover posts checked against the current brand kit. Choose All history to include earlier brands." },
    { target: "repeated", title: "Mistakes that keep coming back", body: "How often each rule fired, how often the fix was accepted, and how often people kept the original. Rules overridden a lot are flagged for review." },
  ],
  analytics: [
    { target: "kpis", title: "The headline numbers", body: "How many checks passed, and how many critical issues, warnings and suggestions were found." },
    { target: "common", title: "What goes wrong most", body: "The most frequent issues across all posts, by severity." },
  ],
  history: [
    { target: "versions", title: "Every version is kept", body: "Pick a version to see exactly what it said and which issues it had." },
    { target: "audit", title: "Full audit trail", body: "Every save, fix and decision, with who did it and when. Nothing here can be edited." },
  ],
};

const visible = (el) => !!el && el.getClientRects().length > 0;
function findTarget(target) {
  for (const t of [].concat(target || [])) {
    const el = [...document.querySelectorAll(`[data-tour="${t}"]`)].find(visible);
    if (el) return el;
  }
  return null;
}

const Ctx = createContext(null);
export const useTourControls = () => useContext(Ctx);

/** Shows a page's tips once its condition is true. `ok` lets a page wait for data or a state (such as results). */
export function useTour(id, ok = true) {
  const ctx = useContext(Ctx);
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.setReady(id, !!ok);
    return () => ctx.setReady(id, false);
  }, [ctx, id, ok]);
}

export function TourProvider({ children }) {
  const path = usePathname();
  const [prefs, setPrefs] = useState(null); // null until read from this browser
  const [active, setActive] = useState(null); // { id, i }
  const [readyIds, setReadyIds] = useState([]);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;

  useEffect(() => { setPrefs(read()); }, []);
  useEffect(() => { setActive(null); }, [path]);

  const update = useCallback((fn) => setPrefs((p) => { const n = fn(p || read()); write(n); return n; }), []);
  const finish = useCallback((id) => { update((p) => ({ ...p, seen: [...new Set([...p.seen, id])] })); setActive(null); }, [update]);
  const turnOff = useCallback(() => { update((p) => ({ ...p, off: true })); setActive(null); }, [update]);

  // Returning the same array when nothing changes avoids needless re-renders.
  const setReady = useCallback((id, ok) => {
    setReadyIds((cur) => {
      if (ok) return cur.includes(id) ? cur : [...cur, id];
      return cur.includes(id) ? cur.filter((x) => x !== id) : cur;
    });
  }, []);
  const readyRef = useRef(readyIds); readyRef.current = readyIds;

  // A tour whose condition stops holding (for example the results replaced the empty composer) ends quietly.
  useEffect(() => {
    if (active && !readyIds.includes(active.id)) finish(active.id);
  }, [active, readyIds, finish]);

  // Start the first ready tour that hasn't been seen.
  useEffect(() => {
    if (!prefs || prefs.off || active) return;
    const id = readyIds.find((x) => TOURS[x] && !prefs.seen.includes(x));
    if (id) setActive({ id, i: 0 });
  }, [prefs, active, readyIds]);

  // Stable (reads the ready list from a ref) so pages registering tips never re-trigger each other.
  const replay = useCallback(() => {
    const id = readyRef.current.find((x) => TOURS[x]);
    update((p) => ({ off: false, seen: p.seen.filter((x) => x !== id) }));
    if (id) setActive({ id, i: 0 });
  }, [update]);

  const activeRef = useRef(active); activeRef.current = active;
  const go = useCallback((i) => setActive((a) => (a ? { ...a, i } : a)), []);
  const done = useCallback(() => { if (activeRef.current) finish(activeRef.current.id); }, [finish]);

  const ctx = useMemo(() => ({ setReady, replay }), [setReady, replay]);
  return (
    <Ctx.Provider value={ctx}>
      {children}
      {active && <TipCard key={`${active.id}-${active.i}`} tourId={active.id} index={active.i} onGo={go} onDone={done} onOff={turnOff} />}
    </Ctx.Provider>
  );
}

/** The "?" button in the top bar: replays the tips for this screen. */
export function TourHelp() {
  const ctx = useTourControls();
  if (!ctx) return null;
  return (
    <button onClick={ctx.replay} data-tour="help" aria-label="Show tips for this screen" title="Show tips for this screen"
      className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-canvas hover:text-ink">
      <Icon name="help" />
    </button>
  );
}

function TipCard({ tourId, index, onGo, onDone, onOff }) {
  const { person } = useRole();
  const steps = TOURS[tourId];
  const step = steps[index];
  const [el, setEl] = useState(null);
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState(null);
  const [going, setGoing] = useState(false);
  const card = useRef(null);
  const last = index === steps.length - 1;

  // Find the target (it may still be rendering); skip the step if it never appears.
  useEffect(() => {
    if (step.welcome || !step.target) return undefined;
    let tries = 0;
    const look = () => {
      const t = findTarget(step.target);
      if (t) {
        const r = t.getBoundingClientRect();
        // Instant scroll: smooth scrolling is unreliable in background tabs and nested scroll areas.
        if (r.top < 72 || r.bottom > window.innerHeight - 24) t.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? "start" : "center" });
        setEl(t);
        return true;
      }
      return false;
    };
    if (look()) return undefined;
    const timer = setInterval(() => {
      tries += 1;
      if (look()) clearInterval(timer);
      else if (tries > 10) { clearInterval(timer); last ? onDone() : onGo(index + 1); }
    }, 150);
    return () => clearInterval(timer);
  }, [step, index, last, onGo, onDone]);

  // Follow the target while the page scrolls or resizes.
  useEffect(() => {
    if (!el) return undefined;
    // Measured directly (not on animation frames, which pause in background tabs); the card lives only briefly.
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    const settle = setTimeout(measure, 450); // after a smooth scroll finishes
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(settle); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
  }, [el]);

  // Place the card below the target, or above it when there is no room. Phones get a fixed card at the bottom.
  useLayoutEffect(() => {
    if (!card.current) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (step.welcome || !rect) { setPos(null); return; }
    if (vw < 640) { setPos({ mobile: true }); return; }
    const w = card.current.offsetWidth, h = card.current.offsetHeight, gap = 14, minTop = 72;
    const clampTop = (t) => Math.min(Math.max(minTop, t), vh - h - 12);
    const clampLeft = (l) => Math.min(Math.max(16, l), vw - w - 16);
    // Below, then above, then beside (for tall targets such as a results column), else overlapping the top edge.
    const onScreen = rect.bottom > minTop && rect.top < vh;
    if (onScreen && rect.bottom + gap + h <= vh - 12) {
      const left = clampLeft(rect.left + rect.width / 2 - w / 2);
      setPos({ top: clampTop(rect.bottom + gap), left, side: "below", arrow: Math.min(Math.max(20, rect.left + rect.width / 2 - left), w - 20) });
    } else if (onScreen && rect.top - gap - h >= minTop) {
      const left = clampLeft(rect.left + rect.width / 2 - w / 2);
      setPos({ top: clampTop(rect.top - gap - h), left, side: "above", arrow: Math.min(Math.max(20, rect.left + rect.width / 2 - left), w - 20) });
    } else if (rect.left - gap - w >= 16 || rect.right + gap + w <= vw - 16) {
      const onLeft = rect.left - gap - w >= 16;
      const top = clampTop(Math.max(rect.top, minTop));
      setPos({ top, left: onLeft ? rect.left - gap - w : rect.right + gap, side: onLeft ? "left" : "right",
        arrow: Math.min(Math.max(20, Math.min(rect.top + 24, vh - 24) - top), h - 20) });
    } else {
      // A section taller and wider than the free space: sit in its lower right corner so its heading stays readable.
      setPos({ top: clampTop(Math.min(rect.bottom, vh) - h - 16), left: clampLeft(Math.min(rect.right, vw) - w - 16), side: "over" });
    }
  }, [rect, step.welcome]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  async function act(a) {
    setGoing(true);
    try {
      if (person?.role !== a.role) await api("/session/role", { method: "POST", body: { role: a.role } });
      onDone();
      window.location.href = a.href;
    } catch { setGoing(false); }
  }

  const waiting = !step.welcome && step.target && !rect;
  const counter = steps.length > 1 && !step.welcome ? `${index + (steps[0].welcome ? 0 : 1)} of ${steps.length - (steps[0].welcome ? 1 : 0)}` : null;

  if (step.welcome) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy/40 p-4 backdrop-blur-[2px] sm:items-center" role="presentation">
        <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" className="pop-in w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
          <div className="bg-navy px-6 pb-5 pt-6 text-white">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal text-ink"><Icon name="sparkle" className="h-5 w-5" /></span>
            <h2 id="tour-title" className="mt-4 text-lg font-semibold">{step.title}</h2>
          </div>
          <p className="px-6 pt-4 text-sm leading-6 text-muted">{step.body}</p>
          <div className="flex flex-wrap items-center gap-2 px-6 pb-6 pt-5">
            <button className="btn btn-teal" autoFocus onClick={() => onGo(index + 1)}>Show me around</button>
            <button className="btn btn-ghost" onClick={onOff}>Skip the tips</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {rect && (
        <div aria-hidden className="pointer-events-none fixed z-[55] rounded-lg ring-2 ring-teal transition-all duration-200"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 6px rgba(22,184,166,.18)" }} />
      )}
      <div ref={card} role="dialog" aria-labelledby="tour-title" aria-live="polite"
        className={`pop-in fixed z-[60] rounded-lg border border-line bg-white shadow-xl ${pos?.mobile ? "inset-x-4 bottom-4" : "w-[22rem]"} ${waiting || (!pos && !step.welcome) ? "invisible" : ""}`}
        style={pos && !pos.mobile ? { top: pos.top, left: pos.left } : undefined}>
        {pos && !pos.mobile && pos.side !== "over" && (
          <span aria-hidden className={`absolute h-3 w-3 rotate-45 border-line bg-white ${{
            below: "-top-1.5 border-l border-t", above: "-bottom-1.5 border-b border-r",
            left: "-right-1.5 border-r border-t", right: "-left-1.5 border-b border-l" }[pos.side]}`}
            style={pos.side === "left" || pos.side === "right" ? { top: pos.arrow - 6 } : { left: pos.arrow - 6 }} />
        )}
        <div className="relative p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal-dark"><Icon name="sparkle" className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1">
              <h2 id="tour-title" className="text-sm font-semibold">{step.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted">{step.body}</p>
            </div>
            <button onClick={onDone} aria-label="Close tips for this screen" className="-mr-1 -mt-1 rounded p-1 text-muted hover:bg-canvas hover:text-ink"><Icon name="close" className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {counter && <span className="mr-auto text-xs tabular-nums text-muted">{counter}</span>}
            {!counter && <button className="mr-auto text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={onOff}>Turn off tips</button>}
            {index > (steps[0].welcome ? 1 : 0) && <button className="btn btn-quiet btn-sm" onClick={() => onGo(index - 1)}>Back</button>}
            {step.action && <button className="btn btn-teal btn-sm" disabled={going} onClick={() => act(step.action)}>{going ? "Opening…" : step.action.label}</button>}
            <button className={`btn btn-sm ${step.action ? "btn-quiet" : "btn-teal"}`} autoFocus={!step.action} onClick={() => (last ? onDone() : onGo(index + 1))}>
              {last ? "Got it" : "Next"}
            </button>
          </div>
          {counter && <button className="mt-3 text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={onOff}>Turn off tips</button>}
        </div>
      </div>
    </>
  );
}
