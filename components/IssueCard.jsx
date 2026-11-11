"use client";
import { useState } from "react";
import Icon from "./Icon";

const SEV = {
  blocker: { label: "Critical", cls: "text-blocker bg-blocker-soft ring-blocker-vivid/30", bar: "bg-blocker-vivid", icon: "alertCircle" },
  warning: { label: "Warning", cls: "text-warning bg-warning-soft ring-warning-vivid/40", bar: "bg-warning-vivid", icon: "alert" },
  suggestion: { label: "Suggestion", cls: "text-suggestion bg-suggestion-soft ring-suggestion-vivid/30", bar: "bg-suggestion-vivid", icon: "info" },
};

export function SeverityTag({ severity }) {
  const s = SEV[severity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      <Icon name={s.icon} className="h-3 w-3" strokeWidth={2.2} />{s.label}
    </span>
  );
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
  const s = SEV[f.severity];
  const unverified = f.confidence === "Unverified";

  return (
    <article
      onClick={() => onSelect?.(f.id)}
      className={`panel relative overflow-hidden transition-shadow ${active ? "shadow-lift ring-2 ring-teal" : "hover:shadow-lift"} ${decision ? "bg-canvas/60" : ""}`}
      aria-label={`Issue ${n}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${decision ? "bg-line" : s.bar}`} aria-hidden />
      <div className="p-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded bg-canvas px-1 text-xs font-semibold tabular-nums text-muted ring-1 ring-line">{n}</span>
          <SeverityTag severity={f.severity} />
          {f.engine === "AI-generated" && <span className="chip py-0"><Icon name="sparkle" className="h-3 w-3" />AI suggestion</span>}
          <span className="ml-auto text-right text-xs text-muted">{f.location_label || (loc === "caption" ? "Caption" : loc)}</span>
        </div>
        <h3 className={`mt-2.5 text-sm font-semibold ${decision ? "text-muted" : ""}`}>{f.name}</h3>

        {f.quote && (
          <p className={`mt-2 rounded-md px-3 py-2 text-sm ${decision ? "bg-surface text-muted ring-1 ring-line" : `bg-${f.severity}-soft`}`}>
            <span className={canAutoFix && !decision ? "line-through decoration-1 opacity-80" : ""}>&ldquo;{f.quote}&rdquo;</span>
          </p>
        )}
        <p className="mt-2.5 text-sm leading-6 text-ink/90">{f.why}</p>

        {f.suggestion && (
          <div className="mt-3 rounded-md border border-teal/30 bg-teal-soft/60 px-3 py-2 text-sm">
            <p className="flex items-center gap-1.5 text-xs font-medium text-teal-dark"><Icon name="checker" className="h-3.5 w-3.5" />Suggested fix</p>
            <p className="mt-0.5">{f.suggestion.trim()}</p>
          </div>
        )}

        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
          <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted">Source</dt><dd className="min-w-0">{f.sources.join("; ")}</dd></div>
          {f.outcome && f.outcome !== "Rule risk" && <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted">Outcome</dt><dd>{f.outcome}</dd></div>}
          {f.confidence && (
            <div className="flex items-center gap-2"><dt className="w-16 shrink-0 text-muted">Confidence</dt>
              <dd className="flex items-center gap-1.5">
                {unverified
                  ? <span className="font-medium text-warning">Couldn&rsquo;t verify</span>
                  : <><Meter level={f.confidence} />{f.confidence}</>}
              </dd>
            </div>
          )}
        </dl>

        {decision ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-surface px-3 py-2 text-sm ring-1 ring-line">
            <Icon name={decision.action === "reject" ? "user" : "check"} className={`mt-0.5 h-4 w-4 shrink-0 ${decision.action === "reject" ? "text-muted" : "text-approved"}`} />
            <span>
              <span className="font-medium">{decision.action === "reject" ? "Kept original" : decision.action === "edit" ? "Edited by you" : canAutoFix ? "Fix accepted" : "You said you will fix this"}</span>
              {decision.action === "reject" && <span className="text-muted">: {decision.reason}</span>}
              <span className="block text-xs text-muted">Your decision. The reviewer will see it.</span>
            </span>
          </p>
        ) : !disabled && (
          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
            {mode === null && (
              <div className="flex flex-wrap gap-2">
                {canAutoFix && <button className="btn btn-teal btn-sm" onClick={() => onDecide("accept", { newText: f.suggestion })}><Icon name="check" className="h-3.5 w-3.5" />Accept fix</button>}
                {isMedia && <button className="btn btn-primary btn-sm" onClick={() => onDecide("accept", {})}>I will fix the {mediaKind}</button>}
                {canEdit && <button className="btn btn-quiet btn-sm" onClick={() => setMode("edit")}>Edit</button>}
                {!isMedia && !canAutoFix && !canEdit && <button className="btn btn-quiet btn-sm" onClick={() => onDecide("accept", {})}>I&rsquo;ll fix it</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setMode("reject")}>Keep original</button>
              </div>
            )}
            {mode === "edit" && (
              <div className="space-y-2 rounded-md bg-canvas p-3">
                <label className="label" htmlFor={`edit-${f.id}`}>Replace &ldquo;{f.quote || "(end of post)"}&rdquo; with</label>
                <input id={`edit-${f.id}`} className="field" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
                <div className="flex gap-2">
                  <button className="btn btn-teal btn-sm" onClick={() => onDecide("edit", { newText: text })}>Apply edit</button>
                  <button className="btn btn-quiet btn-sm" onClick={() => setMode(null)}>Cancel</button>
                </div>
              </div>
            )}
            {mode === "reject" && (
              <div className="space-y-2 rounded-md bg-canvas p-3">
                <label className="label" htmlFor={`why-${f.id}`}>Why keep the original? The reviewer will see this.</label>
                <input id={`why-${f.id}`} className="field" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
                  placeholder="For example: this is a direct quote from a student" />
                <div className="flex gap-2">
                  <button className="btn btn-danger btn-sm" disabled={reason.trim().length < 5}
                    onClick={() => onDecide("reject", { reason })}>Keep original</button>
                  <button className="btn btn-quiet btn-sm" onClick={() => setMode(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Meter({ level }) {
  const n = { High: 3, Medium: 2, Low: 1 }[level] || 0;
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {[1, 2, 3].map((i) => <span key={i} className={`w-1 rounded-sm ${i <= n ? "bg-teal" : "bg-line"}`} style={{ height: `${4 + i * 3}px` }} />)}
    </span>
  );
}
