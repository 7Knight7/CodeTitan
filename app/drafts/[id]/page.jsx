"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, STATUS_LABEL, when } from "@/lib/api";
import { SeverityTag } from "@/components/IssueCard";
import BrandFitBanner from "@/components/BrandFitBanner";
import { useRole } from "@/components/RoleProvider";

function VersionImages({ images }) {
  if (images === null || images === undefined) {
    return <p className="mt-4 rounded border border-dashed border-line p-3 text-sm text-muted">The images for this version were not kept (it was saved before version images were stored).</p>;
  }
  if (!images.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {images.map((m, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-md bg-canvas p-3 text-sm sm:flex-row">
          {m.preview
            ? <img src={m.preview} alt={m.alt_text || `Post image ${i + 1}`} className="max-h-72 w-full shrink-0 rounded border border-line bg-white object-contain sm:w-56" />
            : <div className="flex h-28 w-full shrink-0 items-center justify-center rounded border border-dashed border-line p-2 text-center text-xs text-muted sm:w-40">No preview saved</div>}
          <div className="min-w-0">
            <p className="font-medium">Image {i + 1}: {m.file_name}</p>
            <p><span className="text-muted">Text in image:</span> {m.text || "none"}</p>
            <p><span className="text-muted">Alt text:</span> {m.alt_text || "missing"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HistoryPage({ params }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(null);
  const { person } = useRole();
  useEffect(() => { api(`/drafts/${params.id}`).then((x) => { setD(x); setShown(x.version); }).catch((e) => setError(e.message)); }, [params.id]);
  if (error) return <p role="alert" className="text-blocker">{error}</p>;
  if (!d) return <p className="text-muted">Loading…</p>;
  const v = d.versions.find((x) => x.version === shown) || d.versions.at(-1);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-proof text-2xl font-semibold">{d.title}</h1>
        <span className="text-sm text-muted">{STATUS_LABEL[d.status]}{d.approved_version ? `, version ${d.approved_version} approved` : ""}</span>
        {(() => {
          if (d.archived) return null;
          const toReview = d.status === "in_review" || (person && person.role !== "Creator");
          return (
            <Link href={toReview ? "/review" : `/?draft=${d.id}`} className="ml-auto text-sm text-suggestion underline">
              {toReview ? "Open in review" : "Open in editor"}
            </Link>
          );
        })()}
      </div>
      {d.archived && (
        <p className="rounded-md bg-canvas px-4 py-3 text-sm text-muted">
          Read-only history: this post belongs to the earlier brand kit <span className="font-medium text-ink">{d.kit_name || "an earlier brand"}</span>, archived {when(d.archived_at)}.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-sm font-semibold text-muted">Versions</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {d.versions.map((x) => (
              <button key={x.version} onClick={() => setShown(x.version)}
                className={`btn ${x.version === v.version ? "btn-primary" : "btn-quiet"}`}>
                Version {x.version}{x.version === d.approved_version ? " (approved)" : ""}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Saved by {v.by} on {when(v.at)}{(v.channel || d.channel) ? ` · ${v.channel || d.channel}` : ""}</p>
          {v.fields && Object.keys(v.fields).length > 0 && (
            <dl className="mt-3 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              {Object.entries(v.fields).map(([k, val]) => <div key={k} className="contents"><dt className="text-muted">{k.replace(/_/g, " ")}</dt><dd className="whitespace-pre-wrap">{val}</dd></div>)}
            </dl>
          )}
          <VersionImages images={v.images ?? (v.version === d.version ? (d.images || []) : (v.content ? [] : null))} />
          {v.content
            ? <div className="mt-4"><p className="text-sm text-muted">Caption</p><p className="whitespace-pre-wrap font-proof text-lg leading-8">{v.content}</p></div>
            : <p className="mt-4 text-sm text-muted">No caption in this version.</p>}
          {v.version === d.version && (
            <div className="mt-4 border-t border-line pt-3">
              {d.summary?.brand_fit && d.summary.brand_fit.verdict !== "yes" && <div className="mb-3"><BrandFitBanner fit={d.summary.brand_fit} compact /></div>}
              <p className="text-sm font-semibold">Issues in this version ({d.findings?.length || 0})</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {(d.findings || []).map((f) => (
                  <li key={f.id} className="flex gap-2"><SeverityTag severity={f.severity} /><span>{f.name}{f.location !== "caption" ? <span className="text-muted"> ({f.location})</span> : null}</span></li>
                ))}
                {!d.findings?.length && <li className="text-approved">None.</li>}
              </ul>
            </div>
          )}
        </section>
        <section className="panel p-5">
          <h2 className="text-sm font-semibold text-muted">Audit history</h2>
          <ol className="mt-3 space-y-3 border-l border-line pl-4">
            {d.events.map((e) => (
              <li key={e.id} className="text-sm">
                <p><span className="font-medium">{e.action}</span> <span className="text-muted">by {e.actor} ({e.role})</span></p>
                {e.detail && <p className="text-muted">{e.detail}</p>}
                <p className="text-xs text-muted">{when(e.at)}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
