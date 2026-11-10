"use client";
import { useState } from "react";

const SEV = {
  blocker: { label: "Blocker", cls: "text-blocker bg-blocker-soft" },
  warning: { label: "Warning", cls: "text-warning bg-warning-soft" },
  suggestion: { label: "Suggestion", cls: "text-suggestion bg-suggestion-soft" },
};

export function SeverityTag({ severity }) {
  const s = SEV[severity];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

// One finding: what, why, source, fix, and the creator's decision.
export default function IssueCard({ finding: f, n, active, onSelect, onDecide, decision, disabled }) {
  const [mode, setMode] = useState(null); // "edit" | "reject"
  const [text, setText] = useState(f.suggestion || f.quote || "");
  const [reason, setReason] = useState("");
  const loc = f.location || "caption";
  const isMedia = /^(image|video|document) /.test(loc);
  const mediaKind = isMedia ? loc.split(" ")[0] : null;
  const fix = f.fix || (isMedia ? "manual" : f.end > f.start ? "replace" : "manual");
  const canAutoFix = !isMedia && ["replace", "append", "prepend"].includes(fix) && (f.suggestion || "").trim().length > 0;
  const canEdit = !isMedia && f.end > f.start;

  return (
    <article
      onClick={() => onSelect?.(f.id)}
      className={`panel p-4 ${active ? "ring-2 ring-suggestion" : ""} ${decision ? "opacity-70" : ""}`}
      aria-label={`Issue ${n}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-semibold text-${f.severity}`}>{n}</span>
        <SeverityTag severity={f.severity} />
        <h3 className="text-sm font-semibold">{f.name}</h3>
        <span className="ml-auto text-right text-xs text-muted">
          {f.location_label || (loc === "caption" ? "Caption" : loc)}
          {f.confidence && <span className={`ml-1 rounded px-1 ${f.confidence === "Unverified" ? "bg-canvas font-medium text-ink" : ""}`}>· {f.confidence === "Unverified" ? "Couldn't verify" : `${f.confidence} confidence`}</span>}
        </span>
      </div>
      {f.quote && <p className="mt-2 font-proof text-[0.98rem]">&ldquo;{f.quote}&rdquo;</p>}
      <p className="mt-2 text-sm">{f.why}</p>
      <div className="mt-2 text-xs text-muted">
        <span className="font-medium text-ink">Source: </span>{f.sources.join("; ")}
      </div>
      {f.outcome && f.outcome !== "Rule risk" && (
        <p className="mt-1 text-xs text-muted"><span className="font-medium text-ink">Outcome: </span>{f.outcome}</p>
      )}
      {f.suggestion && (
        <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-sm">
          <span className="font-medium">Suggested fix: </span>{f.suggestion.trim()}
        </p>
      )}

      {decision ? (
        <p className="mt-3 text-sm text-muted">
          {decision.action === "reject" ? `Kept original: ${decision.reason}` : decision.action === "edit" ? "Edited by you" : canAutoFix ? "Fix accepted" : "You said you will fix this"}
        </p>
      ) : !disabled && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          {mode === null && (
            <div className="flex flex-wrap gap-2">
              {canAutoFix && <button className="btn btn-primary" onClick={() => onDecide("accept", { newText: f.suggestion })}>Accept fix</button>}
              {isMedia && <button className="btn btn-primary" onClick={() => onDecide("accept", {})}>I will fix the {mediaKind}</button>}
              {canEdit && <button className="btn btn-quiet" onClick={() => setMode("edit")}>Edit</button>}
              {!isMedia && !canAutoFix && !canEdit && <button className="btn btn-quiet" onClick={() => onDecide("accept", {})}>I&rsquo;ll fix it</button>}
              <button className="btn btn-quiet" onClick={() => setMode("reject")}>Keep original</button>
            </div>
          )}
          {mode === "edit" && (
            <div className="space-y-2">
              <label className="label" htmlFor={`edit-${f.id}`}>Replace &ldquo;{f.quote || "(end of post)"}&rdquo; with</label>
              <input id={`edit-${f.id}`} className="field" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={() => onDecide("edit", { newText: text })}>Apply edit</button>
                <button className="btn btn-quiet" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          )}
          {mode === "reject" && (
            <div className="space-y-2">
              <label className="label" htmlFor={`why-${f.id}`}>Why keep the original? The reviewer will see this.</label>
              <input id={`why-${f.id}`} className="field" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="For example: this is a direct quote from a student" />
              <div className="flex gap-2">
                <button className="btn btn-danger" disabled={reason.trim().length < 5}
                  onClick={() => onDecide("reject", { reason })}>Keep original</button>
                <button className="btn btn-quiet" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
