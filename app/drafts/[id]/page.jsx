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
            ? <img src={m.preview} alt={m.alt_text || `Post image ${i + 1}`} className="max-h-72 w-full shrink-0 rounded-md border border-line bg-white object-contain sm:w-56" />
            : <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-white p-2 text-center text-xs text-muted sm:w-40">No preview saved</div>}
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
  const { person } = useRole();
  useTour("history", !!d);
  useEffect(() => { api(`/drafts/${params.id}`).then((x) => { setD(x); setShown(x.version); }).catch((e) => setError(e.message)); }, [params.id]);
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
        {!d.archived && (
          <Link href={toReview ? "/review" : `/?draft=${d.id}`} className="btn btn-quiet">
            <Icon name={toReview ? "review" : "checker"} className="h-4 w-4" />{toReview ? "Open in review" : "Open in editor"}
          </Link>
        )}
      </div>
      {d.archived && (
        <Notice tone="info">
          Read-only history: this post belongs to the earlier brand kit <span className="font-medium text-ink">{d.kit_name || "an earlier brand"}</span>, archived {when(d.archived_at)}.
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel min-w-0" data-tour="versions">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="section-title">Versions</h2>
            <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Versions">
              {d.versions.map((x) => (
                <button key={x.version} role="tab" aria-selected={x.version === v.version} onClick={() => setShown(x.version)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${x.version === v.version ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-canvas"}`}>
                  Version {x.version}
                  {x.version === d.approved_version && <Icon name="check" className={`h-3.5 w-3.5 ${x.version === v.version ? "text-teal" : "text-approved"}`} strokeWidth={2.4} />}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-4 p-5">
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
          </div>
        </section>
        <Card tour="audit" title="Audit history" sub="Every save and decision, oldest first. Nothing here can be edited.">
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
                    <p className="mt-0.5 text-xs text-muted">{when(e.at)}</p>
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
