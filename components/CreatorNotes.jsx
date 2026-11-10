"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, DRAFTS_EVENT, when } from "@/lib/api";
import { useRole } from "./RoleProvider";
import Icon from "./Icon";

/** Fetch the creator's posts that a reviewer sent back, newest first. */
export function useChangeRequests() {
  const path = usePathname();
  const { person } = useRole();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (path === "/login" || person?.role !== "Creator") { setItems([]); return; }
    const load = () => api("/drafts?status=changes_requested")
      .then((ds) => setItems(ds.filter((d) => d.author === person.name)))
      .catch(() => {});
    load();
    // Refresh as soon as a post is resubmitted (the note disappears), and when the tab regains focus.
    window.addEventListener(DRAFTS_EVENT, load);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener(DRAFTS_EVENT, load); window.removeEventListener("focus", load); };
  }, [path, person]);
  return items;
}

/** Posts waiting for a reviewer's decision (reviewers and the marketing head). */
function useReviewQueue() {
  const path = usePathname();
  const { person } = useRole();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (path === "/login" || !person || person.role === "Creator") { setItems([]); return; }
    const load = () => api("/drafts?status=in_review").then(setItems).catch(() => {});
    load();
    window.addEventListener(DRAFTS_EVENT, load);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener(DRAFTS_EVENT, load); window.removeEventListener("focus", load); };
  }, [path, person]);
  return items;
}

/** When the creator saved a new version but it was not sent (usually because a blocker is still open). */
export function UnsentNote({ d }) {
  if (!(d.version > (d.review?.version || 0))) return null;
  const b = d.open_blockers || [];
  return (
    <p className="mt-1.5 rounded-md bg-blocker-soft px-2 py-1 text-xs text-blocker">
      Version {d.version} is saved but <span className="font-semibold">not sent yet</span>
      {b.length ? `: ${b.length} blocker${b.length > 1 ? "s" : ""} still open (${b.join(", ")}). Fix it or keep it with a reason, then send.` : ". Press Send for review."}
    </p>
  );
}

/** Notification bell in the top bar. Creators see posts sent back to them (opened automatically when new ones arrive);
 *  reviewers and the marketing head see the review queue. */
export default function Notifications() {
  const { person } = useRole();
  const changes = useChangeRequests();
  const queue = useReviewQueue();
  const isCreator = person?.role === "Creator";
  const count = isCreator ? changes.length : queue.length;
  const [open, setOpen] = useState(false);
  const seen = useRef(0);
  const box = useRef(null);

  // A creator with work sent back sees the note straight away, as before; it stays closed once dismissed.
  useEffect(() => {
    if (isCreator && changes.length > seen.current) setOpen(true);
    seen.current = changes.length;
  }, [isCreator, changes.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!person) return null;
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={count ? `${count} notification${count > 1 ? "s" : ""}` : "Notifications"}
        className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-canvas ${open ? "bg-canvas text-ink" : "text-muted"}`}>
        <Icon name="bell" />
        {count > 0 && (
          <span className={`absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-2xs font-semibold ring-2 ring-white ${isCreator ? "bg-blocker-vivid text-white" : "bg-teal text-ink"}`}>{count}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="pop-in absolute right-0 top-11 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">{isCreator ? "Sent back to you" : "Waiting for review"}</p>
            {count > 0 && <span className="chip">{count}</span>}
            <button className="ml-auto rounded p-1 text-muted hover:bg-canvas hover:text-ink" onClick={() => setOpen(false)} aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {count === 0 && (
              <div className="px-4 py-8 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-approved-soft text-approved"><Icon name="check" /></span>
                <p className="mt-3 text-sm font-medium">You&rsquo;re all caught up</p>
                <p className="mt-1 text-xs text-muted">{isCreator ? "When a reviewer asks for changes, the post shows up here." : "Posts sent for review show up here."}</p>
              </div>
            )}
            {isCreator && (
              <ul className="divide-y divide-line">
                {changes.map((d) => (
                  <li key={d.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start gap-2.5">
                      <span className="dot mt-1.5 bg-warning-vivid" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{d.title}</p>
                        <p className="mt-0.5 text-muted">{d.review?.by || "Reviewer"}: &ldquo;{d.review?.comment || "Changes requested"}&rdquo;</p>
                        <UnsentNote d={d} />
                        <p className="mt-1.5 flex items-center gap-3 text-xs">
                          <span className="text-muted">{when(d.review?.at)}</span>
                          <Link href={`/?draft=${d.id}`} onClick={() => setOpen(false)} className="link">{d.version > (d.review?.version || 0) ? "Finish and send" : "Fix now"}</Link>
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!isCreator && (
              <ul className="divide-y divide-line">
                {queue.map((d) => (
                  <li key={d.id}>
                    <Link href="/review" onClick={() => setOpen(false)} className="flex items-start gap-2.5 px-4 py-3 text-sm hover:bg-canvas">
                      <span className="dot mt-1.5 bg-teal" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{d.title}</span>
                        <span className="block truncate text-muted">{d.preview}</span>
                        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                          <span>{d.author}, version {d.version}</span><span>{when(d.updated_at)}</span>
                          {d.requires_senior && <span className="font-medium text-sensitive">Needs marketing head</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
