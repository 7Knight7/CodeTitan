"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, DRAFTS_EVENT, when } from "@/lib/api";
import { useRole } from "./RoleProvider";

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

/** When the creator saved a new version but it was not sent (usually because a blocker is still open). */
export function UnsentNote({ d }) {
  if (!(d.version > (d.review?.version || 0))) return null;
  const b = d.open_blockers || [];
  return (
    <p className="mt-1 rounded bg-blocker-soft px-2 py-1 text-xs text-blocker">
      Version {d.version} is saved but <span className="font-semibold">not sent yet</span>
      {b.length ? `: ${b.length} blocker${b.length > 1 ? "s" : ""} still open (${b.join(", ")}). Fix it or keep it with a reason, then send.` : ". Press Send for review."}
    </p>
  );
}

/** Small note in the top-right corner of every page telling the creator what to change on which post. */
export default function CreatorNotes() {
  const items = useChangeRequests();
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  return (
    <div className="mx-auto flex max-w-7xl justify-end px-4 pt-4">
      <div role="status" className="w-full rounded-lg border border-warning/40 bg-warning-soft text-sm text-warning shadow-sm sm:w-[24rem]">
        <button onClick={() => setOpen(!open)} aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left font-semibold">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-warning" />
          {items.length} post{items.length > 1 ? "s need" : " needs"} changes from the reviewer
          <span className="ml-auto text-xs font-normal underline">{open ? "Hide" : "Show"}</span>
        </button>
        {open && (
          <ul className="space-y-2 border-t border-warning/30 px-3 py-2">
            {items.map((d) => (
              <li key={d.id}>
                <p className="font-medium text-ink">{d.title}</p>
                <p>{d.review?.by || "Reviewer"}: &ldquo;{d.review?.comment || "Changes requested"}&rdquo;</p>
                <UnsentNote d={d} />
                <p className="mt-0.5 flex gap-3 text-xs">
                  <span className="text-muted">{when(d.review?.at)}</span>
                  <Link href={`/?draft=${d.id}`} className="font-semibold underline">{d.version > (d.review?.version || 0) ? "Finish and send" : "Fix now"}</Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
