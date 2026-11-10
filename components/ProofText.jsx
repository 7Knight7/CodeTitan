"use client";
// Renders the draft with each caption finding underlined in its severity colour.
// The small number links the mark to its issue card.
export default function ProofText({ text, findings, activeId, onSelect, resolvedKeys = new Set() }) {
  const marks = findings
    .map((f, i) => ({ ...f, n: i + 1 }))
    .filter((f) => f.location === "caption" && f.end > f.start && !resolvedKeys.has(keyOf(f)))
    .sort((a, b) => a.start - b.start);
  const parts = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue; // overlapping marks: first one wins on screen; both stay in the list
    if (m.start > pos) parts.push(<span key={`t${pos}`}>{text.slice(pos, m.start)}</span>);
    parts.push(
      <span key={m.id} role="button" tabIndex={0}
        onClick={() => onSelect?.(m.id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect?.(m.id)}
        className={`mark mark-${m.severity} ${m.engine === "AI-generated" ? "mark-ai" : ""} ${activeId === m.id ? "mark-active" : ""}`}
        aria-label={`Issue ${m.n}: ${m.name}`}>
        {text.slice(m.start, m.end)}<span className={`ref text-${m.severity}`}>{m.n}</span>
      </span>
    );
    pos = m.end;
  }
  if (pos < text.length) parts.push(<span key={`t${pos}`}>{text.slice(pos)}</span>);
  return <p className="whitespace-pre-wrap text-[15px] leading-8 text-ink">{parts.length ? parts : text}</p>;
}

export const keyOf = (f) => `${f.rule_id}|${f.quote}|${f.location}`;
