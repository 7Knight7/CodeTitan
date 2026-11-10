"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, STATUS_LABEL, when } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import ProofText from "@/components/ProofText";
import { SeverityTag } from "@/components/IssueCard";
import { UnsentNote, useChangeRequests } from "@/components/CreatorNotes";
import PostPreview from "@/components/PostPreview";
import BrandFitBanner from "@/components/BrandFitBanner";

const LAYOUT = { instagram: "visual", linkedin: "text", facebook: "social", whatsapp: "message", website: "banner" };
const LAYERS = [["platform", "Platform requirements"], ["regulation", "Indian advertising regulations"], ["brand", "Brand governance"],
  ["facts", "Factual verification"], ["visual", "Visual intelligence"]];

export default function ReviewPage() {
  const { person } = useRole();
  const mustDo = useChangeRequests();
  const [showPreview, setShowPreview] = useState(false);
  const [schema, setSchema] = useState(null);
  const [brand, setBrand] = useState("");
  useEffect(() => { api("/workspace").then((w) => setBrand(w.meta?.name || "")).catch(() => {}); }, []);
  const [queue, setQueue] = useState([]);
  const [recent, setRecent] = useState([]);
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [q, r] = await Promise.all([api("/drafts?status=in_review"), api("/drafts?status=approved,changes_requested")]);
    setQueue(q); setRecent(r.slice(0, 6));
    return q;
  }, []);

  useEffect(() => { load().then((q) => q[0] && open(q[0].id)).catch((e) => setError(e.message)); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(id) {
    setError(""); setNotice(""); setComment(""); setShowPreview(false); setSchema(null);
    try {
      const d = await api(`/drafts/${id}`);
      setSelected(d);
      if (d.platform) api(`/input-schema?platform=${d.platform}&format=${d.format}&context=${d.context || "organic"}`).then(setSchema).catch(() => {});
    } catch (e) { setError(e.message); }
  }

  async function decide(action) {
    setBusy(true); setError(""); setNotice("");
    try {
      const d = await api(`/drafts/${selected.id}/review`, { method: "POST", body: { action, comment } });
      setNotice(action === "approve" ? `Approved version ${d.version}. It is now recorded in the history.` : "Sent back to the creator with your comment.");
      await load();
      setSelected(await api(`/drafts/${d.id}`));
      setComment("");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const isCreator = person?.role === "Creator";
  const kept = selected?.decisions?.filter((d) => d.action === "reject") || [];
  const fixed = selected?.decisions?.filter((d) => d.action !== "reject") || [];

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        <h1 className="font-proof text-2xl font-semibold">Review</h1>
        {isCreator && (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
            You are acting as the creator. Switch to Arjun or Meera in the header to approve posts.
          </p>
        )}
        {isCreator && mustDo.length > 0 && (
          <div role="alert" className="rounded-md border border-blocker/40 bg-blocker-soft px-3 py-2 text-sm text-blocker">
            <p className="font-semibold">Must do now: {mustDo.length} post{mustDo.length > 1 ? "s" : ""} sent back to you</p>
            <ul className="mt-2 space-y-2">
              {mustDo.map((d) => (
                <li key={d.id}>
                  <span className="font-medium text-ink">{d.title}</span>: &ldquo;{d.review?.comment}&rdquo;{" "}
                  <span className="text-xs">({d.review?.by})</span>
                  <UnsentNote d={d} />
                  <span className="mt-0.5 flex gap-3 text-xs">
                    <button className="underline" onClick={() => open(d.id)}>View</button>
                    <Link href={`/?draft=${d.id}`} className="font-semibold underline">Fix now</Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <List title="Waiting for review" items={queue} selected={selected} open={open} empty="Nothing is waiting. Send a post from Write and check." />
        <List title="Recently decided" items={recent} selected={selected} open={open} />
      </aside>

      <section className="min-w-0 space-y-4">
        {error && <p role="alert" className="rounded-md bg-blocker-soft px-4 py-3 text-sm text-blocker">{error}</p>}
        {notice && <p role="status" className="rounded-md bg-approved-soft px-4 py-3 text-sm text-approved">{notice}</p>}
        {!selected ? (
          <p className="panel p-6 text-muted">Pick a post on the left.</p>
        ) : (
          <>
            <div className="panel p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <span className="text-sm text-muted">{selected.channel}, version {selected.version}, by {selected.author}</span>
                <span className="ml-auto text-sm font-medium">{STATUS_LABEL[selected.status]}</span>
              </div>
              {selected.status === "changes_requested" && selected.review?.comment && (
                <div role="alert" className="mt-3 rounded-md border border-blocker/40 bg-blocker-soft px-3 py-2 text-sm text-blocker">
                  <p className="font-semibold">{isCreator ? "Must do now: " : ""}Changes requested by {selected.review.by} on {when(selected.review.at)}</p>
                  <p className="mt-1 text-ink">&ldquo;{selected.review.comment}&rdquo;</p>
                  {selected.version > (selected.review.version || 0) && (
                    <p className="mt-1 text-ink">
                      {isCreator ? "You" : selected.author} saved version {selected.version} but {isCreator ? "haven't" : "hasn't"} sent it back yet
                      {selected.open_blockers?.length ? ` (${selected.open_blockers.length} blocker still open: ${selected.open_blockers.join(", ")})` : ""}.
                      {!isCreator && " You can approve or ask for changes once it is sent."}
                    </p>
                  )}
                  {isCreator && <Link href={`/?draft=${selected.id}`} className="mt-1 inline-block font-semibold underline">Open the post and fix it</Link>}
                </div>
              )}
              {selected.status === "in_review" && selected.review?.action === "request_changes" && (
                <div className="mt-3 rounded-md bg-suggestion-soft px-3 py-2 text-sm text-suggestion">
                  <p className="font-semibold">
                    Resubmitted as version {selected.version}
                    {selected.version > selected.review.version ? ` (was version ${selected.review.version})` : " with no changes since the last review"}
                  </p>
                  <p className="mt-1 text-ink">{selected.review.by} had asked: &ldquo;{selected.review.comment}&rdquo;</p>
                </div>
              )}
              {selected.requires_senior && (
                <p className="mt-3 rounded bg-sensitive-soft px-3 py-2 text-sm text-sensitive">Mentions a sensitive topic. Only the marketing head can approve it.</p>
              )}
              {selected.summary?.brand_fit && selected.summary.brand_fit.verdict !== "yes" && (
                <div className="mt-3"><BrandFitBanner fit={selected.summary.brand_fit} /></div>
              )}
              {(selected.images || []).map((m, i) => (
                <div key={i} className="mt-3 flex flex-col gap-3 rounded-md bg-canvas p-3 text-sm sm:flex-row">
                  {m.preview
                    ? <img src={m.preview} alt={m.alt_text || `Post image ${i + 1}`} className="max-h-72 w-full shrink-0 rounded border border-line bg-white object-contain sm:w-64" />
                    : <div className="flex h-32 w-full shrink-0 items-center justify-center rounded border border-dashed border-line p-2 text-center text-xs text-muted sm:w-40">No preview saved. Ask the creator to check the post again.</div>}
                  <div className="min-w-0">
                    <p className="font-medium">Image {i + 1}: {m.file_name}</p>
                    <p><span className="text-muted">Text in image:</span> {m.text || "none"}</p>
                    <p><span className="text-muted">Alt text:</span> {m.alt_text || "missing"}</p>
                  </div>
                </div>
              ))}
              {selected.content && <div className="mt-4"><p className="text-sm text-muted">{schema?.fields.find((x) => x.id === "main_text")?.label || "Caption"}</p><ProofText text={selected.content} findings={selected.findings || []} /></div>}
              {selected.platform && Object.keys(selected.fields || {}).length > 0 && (
                <dl className="mt-4 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
                  {Object.entries(selected.fields).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted">{schema?.fields.find((x) => x.id === k)?.label || k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>
                  ))}
                </dl>
              )}
              {selected.platform && (
                <div className="mt-4">
                  <button className="btn btn-quiet" onClick={() => setShowPreview(!showPreview)}>{showPreview ? "Hide preview" : "Show as it will appear"}</button>
                  {showPreview && (
                    <div className="mt-3 rounded-lg bg-canvas p-4">
                      <PostPreview layout={LAYOUT[selected.platform]} platform={selected.platform} format={selected.format} context={selected.context}
                        contextLabel={(selected.channel || "").split(" · ")[2] || ""} brand={brand || "Your brand"} text={selected.content || ""}
                        fields={selected.fields || {}} media={selected.images || []} />
                    </div>
                  )}
                </div>
              )}
              <p className="mt-4 text-sm"><Link className="text-suggestion underline" href={`/drafts/${selected.id}`}>Full history and versions</Link></p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="panel p-4">
                <h3 className="text-sm font-semibold">Issues still in this version ({selected.findings?.length || 0})</h3>
                {LAYERS.map(([lid, label]) => {
                  const list = (selected.findings || []).filter((f) => (f.layer || "brand") === lid);
                  if (!list.length) return null;
                  return (
                    <div key={lid} className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
                      <ul className="mt-1 space-y-2 text-sm">
                        {list.map((f) => (
                          <li key={f.id} className="flex gap-2">
                            <SeverityTag severity={f.severity} />
                            <span>{f.name}{f.quote ? <>: <span className="font-proof">&ldquo;{f.quote}&rdquo;</span></> : null}
                              <span className="block text-xs text-muted">{f.location_label || f.location}{f.confidence ? ` · ${f.confidence === "Unverified" ? "couldn't verify" : `${f.confidence.toLowerCase()} confidence`}` : ""} · {f.sources?.[0]}</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {!selected.findings?.length && <p className="mt-2 text-sm text-approved">None. The last check found no issues.</p>}
              </div>
              <div className="panel p-4">
                <h3 className="text-sm font-semibold">Creator decisions</h3>
                {kept.length > 0 && (
                  <ul className="mt-2 space-y-2 text-sm">
                    {kept.map((d) => (
                      <li key={d.id} className="rounded bg-warning-soft px-2 py-1">
                        <span className="font-medium">Kept original</span> for {d.name}{d.quote ? ` (“${d.quote}”)` : ""}: {d.reason}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-sm text-muted">{fixed.length} fix{fixed.length === 1 ? "" : "es"} accepted or edited before review.</p>
              </div>
            </div>

            {selected.status === "in_review" && !isCreator && (
              <div className="panel space-y-3 p-4">
                <label className="label" htmlFor="comment">Comment for the creator</label>
                <textarea id="comment" className="field min-h-[4rem]" value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="Required when asking for changes" />
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-approve" disabled={busy} onClick={() => decide("approve")}>Approve version {selected.version}</button>
                  <button className="btn btn-danger" disabled={busy} onClick={() => decide("request_changes")}>Request changes</button>
                </div>
                <p className="text-xs text-muted">Signed in as {person?.name}. Your decision is saved to the audit history.</p>
              </div>
            )}
            {selected.review && selected.status !== "in_review" && (
              <p className="text-sm text-muted">
                {selected.review.action === "approve" ? "Approved" : "Changes requested"} by {selected.review.by} ({selected.review.role}) on {when(selected.review.at)}
                {selected.review.comment ? `: ${selected.review.comment}` : "."}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function List({ title, items, selected, open, empty }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-muted">{title}</h2>
      {items.length === 0 && empty && <p className="text-sm text-muted">{empty}</p>}
      <ul className="space-y-2">
        {items.map((d) => (
          <li key={d.id}>
            <button onClick={() => open(d.id)}
              className={`panel w-full px-3 py-2 text-left text-sm hover:bg-canvas ${selected?.id === d.id ? "ring-2 ring-suggestion" : ""}`}>
              <span className="block font-medium">{d.title}</span>
              <span className="block truncate text-xs text-muted">{d.preview}</span>
              {d.requires_senior && <span className="mt-1 inline-block text-xs text-sensitive">Needs marketing head</span>}
              {d.status === "changes_requested" && <span className="mt-1 block text-xs font-medium text-blocker">Changes requested{d.review?.comment ? `: ${d.review.comment}` : ""}</span>}
              {d.status === "approved" && <span className="mt-1 block text-xs text-approved">Approved</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
