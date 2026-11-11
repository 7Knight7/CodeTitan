"use client";
import { useEffect, useState } from "react";
import { STATUS_LABEL } from "@/lib/api";
import Icon from "./Icon";

/** Circular progress ring. Draws from empty to `pct` once, then follows changes. Only pass a real, computed share. */
export function ScoreRing({ pct, size = 120, stroke = 10, tone = "accent", label, sub }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = setTimeout(() => setShown(pct), 60); return () => clearTimeout(t); }, [pct]);
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const color = { accent: "stroke-teal", approved: "stroke-approved-vivid", warning: "stroke-warning-vivid", blocker: "stroke-blocker-vivid" }[tone];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${pct}%${label ? ` ${label}` : ""}`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className={`${color} ring-draw`}
          strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-semibold tabular-nums tracking-tight" style={{ fontSize: size * 0.24 }}>{pct}%</span>
        {sub && <span className="mt-0.5 max-w-[70%] text-2xs leading-tight text-muted">{sub}</span>}
      </span>
    </div>
  );
}

/** Shared building blocks so every page uses the same surfaces, chips and empty states. */

export function Card({ title, sub, action, children, className = "", bodyClass = "p-5", tour }) {
  return (
    <section className={`panel min-w-0 ${className}`} data-tour={tour}>
      {(title || action) && (
        <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="section-title">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
          </div>
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const STATUS_STYLE = {
  draft: "bg-canvas text-muted ring-line",
  in_review: "bg-teal-soft text-teal-dark ring-teal/25",
  changes_requested: "bg-warning-soft text-warning ring-warning-vivid/30",
  approved: "bg-approved-soft text-approved ring-approved-vivid/25",
};

export function StatusChip({ status, className = "" }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status] || STATUS_STYLE.draft} ${className}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function EmptyState({ icon = "info", title, body, children }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-muted ring-1 ring-line"><Icon name={icon} /></span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Horizontal bar whose length is value/max, split into coloured parts. */
export function Bar({ value, max, parts }) {
  const width = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-canvas" aria-hidden>
      <div className="flex h-full gap-px" style={{ width: `${width}%` }}>
        {parts.filter((p) => p.n > 0).map((p, i) => <span key={i} className={`h-full ${p.cls} first:rounded-l-full last:rounded-r-full`} style={{ flexGrow: p.n }} />)}
      </div>
    </div>
  );
}

/** A short coloured notice: error, success, warning or neutral information. */
export function Notice({ tone = "info", children, role, className = "" }) {
  const s = {
    error: ["bg-blocker-soft text-blocker ring-blocker-vivid/30", "alertCircle"],
    success: ["bg-approved-soft text-approved ring-approved-vivid/25", "checkCircle"],
    warning: ["bg-warning-soft text-warning ring-warning-vivid/35", "alert"],
    info: ["bg-surface text-muted ring-line", "info"],
    sensitive: ["bg-sensitive-soft text-sensitive ring-sensitive-vivid/30", "shield"],
  }[tone];
  return (
    <div role={role} className={`flex items-start gap-2.5 rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset ${s[0]} ${className}`}>
      <Icon name={s[1]} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
