"use client";
import Icon from "./Icon";

/** The big answer to "is this a post for this brand at all?" (rule-based, from the brand kit; see api/_lbc/brandfit.py). */
export default function BrandFitBanner({ fit, compact = false }) {
  if (!fit || !fit.signals?.length) return null;
  const failed = fit.signals.filter((s) => s.status === "fail");
  const passed = fit.signals.filter((s) => s.status === "pass");
  const unknown = fit.signals.filter((s) => s.status === "unknown");

  if (fit.verdict === "yes") {
    return (
      <div className="panel flex items-start gap-3 px-4 py-3 text-sm" role="status">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-approved-soft text-approved"><Icon name="check" className="h-4 w-4" strokeWidth={2.2} /></span>
        <div className="min-w-0">
          <p className="font-medium">Brand consistency: fits {fit.brand}</p>
          {!compact && <p className="mt-0.5 text-xs text-muted">{passed.map((s) => s.label).join(", ")} checked against the brand kit.</p>}
        </div>
      </div>
    );
  }

  const no = fit.verdict === "no";
  return (
    <div role="alert" className={`overflow-hidden rounded-lg border-2 bg-surface text-sm ${no ? "border-blocker-vivid" : "border-warning-vivid"}`}>
      <div className={`flex items-start gap-3 px-4 py-3.5 ${no ? "bg-blocker-soft" : "bg-warning-soft"}`}>
        <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${no ? "bg-blocker-vivid" : "bg-warning-vivid"}`}>
          <Icon name={no ? "x" : "alert"} className="h-5 w-5" strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <p className={`text-base font-semibold leading-tight ${no ? "text-blocker" : "text-warning"}`}>
            {no ? `No: this is not a post for ${fit.brand}` : `Only partly on brand for ${fit.brand}`}
          </p>
          <p className="mt-1 text-xs text-ink/80">
            {no
              ? "It doesn't match the brand kit. Rework it for this brand before sending it for review."
              : "Some brand signals are missing. Check them before sending."}
          </p>
        </div>
      </div>
      <ul className="space-y-2 px-4 py-3">
        {failed.map((s) => (
          <li key={s.id} className="flex gap-2.5">
            <Icon name="x" className={`mt-0.5 h-4 w-4 shrink-0 ${no ? "text-blocker" : "text-warning"}`} strokeWidth={2.2} />
            <span><span className="font-medium">{s.label}:</span> {s.detail} <span className="block text-xs text-muted">Source: {s.source}</span></span>
          </li>
        ))}
        {!compact && passed.map((s) => (
          <li key={s.id} className="flex gap-2.5 text-muted">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-approved" strokeWidth={2.2} />
            <span><span className="font-medium text-ink">{s.label}:</span> {s.detail}</span>
          </li>
        ))}
        {!compact && unknown.map((s) => (
          <li key={s.id} className="flex gap-2.5 text-muted">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
            <span><span className="font-medium text-ink">{s.label}:</span> Couldn&rsquo;t verify. {s.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
