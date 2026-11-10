"use client";

/** The big answer to "is this a post for this brand at all?" (rule-based, from the brand kit; see api/_lbc/brandfit.py). */
export default function BrandFitBanner({ fit, compact = false }) {
  if (!fit || !fit.signals?.length) return null;
  const failed = fit.signals.filter((s) => s.status === "fail");
  const passed = fit.signals.filter((s) => s.status === "pass");
  const unknown = fit.signals.filter((s) => s.status === "unknown");

  if (fit.verdict === "yes") {
    return (
      <div className="rounded-lg border border-approved/40 bg-approved-soft px-4 py-3 text-sm text-approved" role="status">
        <p className="font-semibold">✓ Fits {fit.brand}</p>
        {!compact && <p className="mt-1 text-xs text-ink">{passed.map((s) => s.label).join(" · ")} checked against the brand kit.</p>}
      </div>
    );
  }

  const no = fit.verdict === "no";
  return (
    <div role="alert"
      className={`rounded-lg border-2 px-4 py-4 text-sm ${no ? "border-blocker bg-blocker-soft" : "border-warning bg-warning-soft"}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-black text-white ${no ? "bg-blocker" : "bg-warning"}`}>
          {no ? "✕" : "!"}
        </span>
        <div className="min-w-0">
          <p className={`text-lg font-extrabold leading-tight ${no ? "text-blocker" : "text-warning"}`}>
            {no ? `NO: this is not a post for ${fit.brand}` : `Only partly on brand for ${fit.brand}`}
          </p>
          <p className="mt-1 text-xs text-ink">
            {no
              ? "It doesn't match the brand kit. Rework it for this brand before sending it for review."
              : "Some brand signals are missing. Check them before sending."}
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {failed.map((s) => (
          <li key={s.id} className="flex gap-2">
            <span aria-hidden className={no ? "text-blocker" : "text-warning"}>✕</span>
            <span><span className="font-semibold">{s.label}:</span> {s.detail} <span className="text-xs text-muted">Source: {s.source}</span></span>
          </li>
        ))}
        {!compact && passed.map((s) => (
          <li key={s.id} className="flex gap-2 text-muted">
            <span aria-hidden className="text-approved">✓</span>
            <span><span className="font-medium text-ink">{s.label}:</span> {s.detail}</span>
          </li>
        ))}
        {!compact && unknown.map((s) => (
          <li key={s.id} className="flex gap-2 text-muted">
            <span aria-hidden>?</span>
            <span><span className="font-medium text-ink">{s.label}:</span> Couldn&rsquo;t verify. {s.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
