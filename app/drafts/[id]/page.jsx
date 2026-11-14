"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, when } from "@/lib/api";
import { SeverityTag } from "@/components/IssueCard";
import BrandFitBanner from "@/components/BrandFitBanner";
import { useRole } from "@/components/RoleProvider";
import Icon from "@/components/Icon";
import { Card, Notice, StatusChip } from "@/components/ui";
import { useTour } from "@/components/Tour";
import VersionDiff from "@/components/VersionDiff";

// Recomputes every fingerprint in the audit log on the server and says whether the chain is intact.
function LogCheck() {
  const [v, setV] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/audit/verify").then(setV).catch((e) => setErr(e.message)); }, []);
  if (err) return null;
  if (!v) return <p className="text-xs text-muted">Checking the log&rsquo;s fingerprints&hellip;</p>;
  return v.ok ? (
    <p className="flex items-start gap-1.5 rounded-md bg-approved-soft px-3 py-2 text-xs text-approved" data-testid="log-check">
      <Icon name="shield" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>Tamper check passed: all {v.entries} log entries recompute and link to the one before{v.legacy ? ` (${v.legacy} older entries predate fingerprints)` : ""}.</span>
    </p>
  ) : (
    <p className="flex items-start gap-1.5 rounded-md bg-blocker-soft px-3 py-2 text-xs text-blocker" role="alert" data-testid="log-check">
      <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>Tamper check failed at entry #{v.broken_at.seq}{v.broken_at.action ? ` (${v.broken_at.action})` : ""}: {v.broken_at.reason}</span>
    </p>
  );
}

// Guided demo only (/drafts/<id>?demo=reopen, marketing head): change a fact this approval relied on, in one click,
// to show the approval reopening. "Start the demo over" on the overview restores the sample data.
function nudge(f) {
  if (f.kind === "fee") return { amount: (f.amount || 0) + 1000 };
  if (f.kind === "offer") return { percent: f.percent >= 100 ? 99 : (f.percent || 0) + 2 };
  return { full_course: (f.full_course || 0) + 1 };
}
const showValue = (f) => (f.kind === "fee" ? `Rs ${(f.amount || 0).toLocaleString("en-IN")}` : f.kind === "offer" ? `${f.percent}% off` : `${f.full_course} paid`);

function ReopenDemo({ d, person, onChanged }) {
  const [fact, setFact] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const id = d.evidence?.[0]?.fact_id;
  useEffect(() => { if (id) api("/workspace").then((w) => setFact(w.facts.find((f) => f.id === id) || null)).catch(() => {}); }, [id]);
  if (!id || !fact) return null;
  const after = { ...fact, ...nudge(fact) };
  async function change() {
    setBusy(true); setErr("");
    try { await api(`/facts/${id}`, { method: "PUT", body: nudge(fact) }); await onChanged(); } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="panel border-teal/40 p-4" data-tour="demo-reopen">
      <p className="text-sm font-semibold">Try it: change the fact this approval relied on</p>
      <p className="mt-1 text-sm text-muted">
        This post was approved because it quotes <span className="font-medium text-ink">{fact.label}</span> correctly ({showValue(fact)}).
        Change it to {showValue(after)} as the marketing head would, and the approval reopens: the post goes back to review with the reason.
      </p>
      {person?.role === "Marketing head"
        ? <button className="btn btn-teal btn-sm mt-3" disabled={busy} onClick={change}>{busy ? "Changing…" : `Change it to ${showValue(after)}`}</button>
        : <p className="mt-2 text-xs text-muted">Only the marketing head can change approved facts. Open this step as Meera.</p>}
      {err && <p role="alert" className="mt-2 text-xs text-blocker">{err}</p>}
      <p className="mt-2 text-xs text-muted">Demo data only. &ldquo;Start the demo over&rdquo; on the overview puts the fact back.</p>
    </div>
  );
}

function VersionImages({ images }) {
  if (images === null || images === undefined) {
    return <p className="rounded-md border border-dashed border-line p-3 text-sm text-muted">The images for this version were not kept (it was saved before version images were stored).</p>;
  }
  if (!images.length) return null;
  return (
    <div className="space-y-3">
      {images.map((m, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-lg bg-canvas p-3 text-sm ring-1 ring-line sm:flex-row">
          {m.preview
            ? <img src={m.preview} alt={m.alt_text || `Post image ${i + 1}`} className="max-h-72 w-full shrink-0 rounded-md border border-line bg-surface object-contain sm:w-56" />
            : <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-surface p-2 text-center text-xs text-muted sm:w-40">No preview saved</div>}
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1">
            <dt className="col-span-2 mb-1 font-medium">Image {i + 1}: <span className="font-normal text-muted">{m.file_name}</span></dt>
            <dt className="text-muted">Text in image</dt><dd>{m.text || "none"}</dd>
            <dt className="text-muted">Alt text</dt><dd>{m.alt_text || "missing"}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

// Icon and colour for each kind of audit event, so human decisions stand out from automatic saves.
function eventStyle(action = "") {
  const a = action.toLowerCase();
  if (a.includes("approv")) return ["check", "bg-approved-soft text-approved"];
  if (a.includes("change")) return ["message", "bg-warning-soft text-warning"];
  if (a.includes("kept") || a.includes("overr") || a.includes("reject")) return ["user", "bg-warning-soft text-warning"];
  if (a.includes("submit") || a.includes("sent")) return ["send", "bg-teal-soft text-teal-dark"];
  if (a.includes("accept") || a.includes("edit") || a.includes("fix")) return ["checker", "bg-teal-soft text-teal-dark"];
  return ["file", "bg-canvas text-muted"];
}

export default function HistoryPage({ params }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(null);
  const [compare, setCompare] = useState(false);
  const [pair, setPair] = useState([1, 1]);
  const [demo, setDemo] = useState(false);
  const { person } = useRole();
  const reopenDemo = demo && d?.status === "approved" && d?.evidence?.length > 0 && !d?.archived;
  useTour("history", !!d && !demo);
  useTour("history-demo", !!reopenDemo);
  useTour("history-reopened", !!d?.reopened && d?.status === "in_review");
  const load = () => api(`/drafts/${params.id}`).then((x) => { setD(x); setShown(x.version); setPair([Math.max(1, (x.approved_version && x.approved_version < x.version ? x.approved_version : x.version - 1)), x.version]); });
  useEffect(() => { setDemo(new URLSearchParams(window.location.search).get("demo") === "reopen"); }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Notice tone="error" role="alert">{error}</Notice>;
  if (!d) return <div className="space-y-4"><div className="skeleton h-8 w-72" /><div className="grid gap-6 lg:grid-cols-2"><div className="skeleton h-80" /><div className="skeleton h-80" /></div></div>;
  const v = d.versions.find((x) => x.version === shown) || d.versions.at(-1);
  const toReview = d.status === "in_review" || (person && person.role !== "Creator");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="page-title">{d.title}</h1>
            <StatusChip status={d.status} />
          </div>
          <p className="page-sub">{d.channel}, by {d.author}{d.approved_version ? `. Version ${d.approved_version} approved.` : "."}</p>
        </div>
        {d.status === "approved" && (
          <a href={`/api/drafts/${d.id}/record.pdf`} download className="btn btn-quiet" data-testid="record-pdf" data-tour="record-pdf">
            <Icon name="download" className="h-4 w-4" />Approval record (PDF)
          </a>
        )}
        {!d.archived && (
          <Link href={toReview ? "/review" : `/?draft=${d.id}`} className="btn btn-quiet">
            <Icon name={toReview ? "review" : "checker"} className="h-4 w-4" />{toReview ? "Open in review" : "Open in editor"}
          </Link>
        )}
      </div>
      {d.reopened && d.status === "in_review" && (
        <div data-tour="reopened"><Notice tone="warning" role="alert">
          <span className="font-medium">Approval reopened {when(d.reopened.at)}.</span> Version {d.reopened.version} was approved, but evidence it relied on changed: {d.reopened.reasons.join(" ")} It needs a new review.
        </Notice></div>
      )}
      {d.evidence?.length > 0 && d.status === "approved" && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted" data-tour="evidence">
          <Icon name="facts" className="h-4 w-4" />Approval relies on:
          {d.evidence.map((e) => <span key={e.fact_id} className="chip py-0" title={`Fact fingerprint ${e.fingerprint}`}>{e.label}{e.valid_until ? `, until ${e.valid_until}` : ""}</span>)}
          <span className="text-xs">If any of these changes or expires, the approval reopens.</span>
        </p>
      )}
      {reopenDemo && <ReopenDemo d={d} person={person} onChanged={load} />}
      {demo && !reopenDemo && !d.reopened && (
        <Notice tone="info">This post has no approval that rests on an approved fact (or it was already reopened). Use &ldquo;Start the demo over&rdquo; on the overview to restore the sample posts.</Notice>
      )}
      {d.archived && (
        <Notice tone="info">
          Read-only history: this post belongs to the earlier brand kit <span className="font-medium text-ink">{d.kit_name || "an earlier brand"}</span>, archived {when(d.archived_at)}.
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel min-w-0" data-tour="versions">
          <div className="border-b border-line px-5 py-3.5">
            <div className="flex items-center gap-3">
              <h2 className="section-title">Versions</h2>
              {d.versions.length > 1 && (
                <button className="btn btn-quiet ml-auto py-1 text-sm" aria-pressed={compare} onClick={() => setCompare(!compare)} data-testid="compare-toggle" data-tour="compare">
                  <Icon name="columns" className="h-4 w-4" />{compare ? "Show one version" : "Compare side by side"}
                </button>
              )}
            </div>
            {!compare && <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Versions">
              {d.versions.map((x) => (
                <button key={x.version} role="tab" aria-selected={x.version === v.version} onClick={() => setShown(x.version)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${x.version === v.version ? "border-ink bg-ink text-surface" : "border-line bg-surface hover:bg-canvas"}`}>
                  Version {x.version}
                  {x.version === d.approved_version && <Icon name="check" className={`h-3.5 w-3.5 ${x.version === v.version ? "text-teal" : "text-approved"}`} strokeWidth={2.4} />}
                </button>
              ))}
            </div>}
          </div>
          {compare ? <div className="p-5"><VersionDiff d={d} left={pair[0]} right={pair[1]} onLeft={(n) => setPair([n, pair[1]])} onRight={(n) => setPair([pair[0], n])} /></div> : <div className="space-y-4 p-5">
            <p className="text-xs text-muted">Saved by {v.by}, {when(v.at)}{(v.channel || d.channel) ? `. ${v.channel || d.channel}` : ""}{v.version === d.approved_version ? ". This is the approved version." : ""}</p>
            {v.fields && Object.keys(v.fields).length > 0 && (
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                {Object.entries(v.fields).map(([k, val]) => <div key={k} className="contents"><dt className="text-muted first-letter:uppercase">{k.replace(/_/g, " ")}</dt><dd className="whitespace-pre-wrap">{val}</dd></div>)}
              </dl>
            )}
            <VersionImages images={v.images ?? (v.version === d.version ? (d.images || []) : (v.content ? [] : null))} />
            {v.content
              ? <div><p className="mb-1 text-xs font-medium text-muted">Caption</p><p className="whitespace-pre-wrap rounded-lg border border-line px-4 py-3 text-[15px] leading-7">{v.content}</p></div>
              : <p className="text-sm text-muted">No caption in this version.</p>}
            {v.version === d.version && (
              <div className="border-t border-line pt-4">
                {d.summary?.brand_fit && d.summary.brand_fit.verdict !== "yes" && <div className="mb-3"><BrandFitBanner fit={d.summary.brand_fit} compact /></div>}
                <p className="text-sm font-semibold">Issues in this version <span className="chip ml-1 py-0">{d.findings?.length || 0}</span></p>
                <ul className="mt-3 space-y-2 text-sm">
                  {(d.findings || []).map((f) => (
                    <li key={f.id} className="flex items-start gap-2.5"><SeverityTag severity={f.severity} /><span>{f.name}{f.location !== "caption" ? <span className="text-muted"> ({f.location})</span> : null}</span></li>
                  ))}
                  {!d.findings?.length && <li className="flex items-center gap-2 text-approved"><Icon name="checkCircle" className="h-4 w-4" />None.</li>}
                </ul>
              </div>
            )}
          </div>}
        </section>
        <Card tour="audit" title="Audit history" sub="Every save and decision, oldest first. Each entry is fingerprinted and linked to the one before, so any later change shows.">
          <div className="mb-4" data-tour="log-check"><LogCheck /></div>
          <ol className="relative space-y-5">
            <span className="absolute bottom-2 left-[13px] top-2 w-px bg-line" aria-hidden />
            {d.events.map((e) => {
              const [icon, cls] = eventStyle(e.action);
              return (
                <li key={e.id} className="relative flex gap-3 text-sm">
                  <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${cls}`}><Icon name={icon} className="h-3.5 w-3.5" strokeWidth={2} /></span>
                  <div className="min-w-0 pt-0.5">
                    <p><span className="font-medium">{e.action}</span> <span className="text-muted">by {e.actor} ({e.role})</span></p>
                    {e.detail && <p className="mt-0.5 text-muted">{e.detail}</p>}
                    <p className="mt-0.5 text-xs text-muted">{when(e.at)}{e.hash && <span className="font-mono" title={`Fingerprint ${e.hash}\nPrevious ${e.prev}`}> &middot; #{e.seq} &middot; {e.hash.slice(0, 10)}</span>}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
