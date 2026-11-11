"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import ProofText from "@/components/ProofText";
import { SeverityTag } from "@/components/IssueCard";
import { UnsentNote, useChangeRequests } from "@/components/CreatorNotes";
import PostPreview from "@/components/PostPreview";
import BrandFitBanner from "@/components/BrandFitBanner";
import Icon from "@/components/Icon";
import { Card, EmptyState, Notice, PageHeader, StatusChip } from "@/components/ui";
import { useTour } from "@/components/Tour";

const LAYOUT = { instagram: "visual", linkedin: "text", facebook: "social", whatsapp: "message", website: "banner" };
const LAYERS = [["platform", "Platform requirements"], ["regulation", "Indian advertising regulations"], ["brand", "Brand governance"],
  ["facts", "Factual verification"], ["visual", "Visual intelligence"]];
const FILTERS = [["all", "All"], ["in_review", "Waiting"], ["approved", "Approved"], ["changes_requested", "Sent back"]];

export default function ReviewPage() {
  const { person } = useRole();
  const mustDo = useChangeRequests();
  const [showPreview, setShowPreview] = useState(false);
  const [schema, setSchema] = useState(null);
  const [brand, setBrand] = useState("");
  useEffect(() => { api("/workspace").then((w) => setBrand(w.meta?.name || "")).catch(() => {}); }, []);
  const [queue, setQueue] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [q, r] = await Promise.all([api("/drafts?status=in_review"), api("/drafts?status=approved,changes_requested")]);
    setQueue(q); setRecent(r.slice(0, 6)); setLoaded(true);
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
  useTour(isCreator ? "review-creator" : "review", loaded && !!person && (isCreator || !!selected || queue.length + recent.length === 0));
  const kept = selected?.decisions?.filter((d) => d.action === "reject") || [];
  const fixed = selected?.decisions?.filter((d) => d.action !== "reject") || [];
  const visible = [...queue, ...recent].filter((d) => filter === "all" || d.status === filter);
  const counts = { all: queue.length + recent.length, in_review: queue.length, approved: recent.filter((d) => d.status === "approved").length, changes_requested: recent.filter((d) => d.status === "changes_requested").length };

  return (
    <div className="space-y-6">
      <PageHeader title="Review & approvals"
        sub="Approve posts or send them back with a comment. Automated check results and the creator's own decisions are shown separately; only a person approves." />

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          {isCreator && (
            <Notice tone="info">You are acting as the creator. Switch to Arjun or Meera from the account menu to approve posts.</Notice>
          )}
          {person?.role === "Reviewer" && loaded && queue.every((d) => d.requires_senior) && (
            <Notice tone="info">
              {queue.length ? "The only post waiting needs the marketing head. " : "Nothing is waiting for you. "}
              To have one to approve, open the <Link href="/overview" className="font-medium text-teal-dark underline">guided demo</Link> and run step 2, or send any post from the content checker as Priya.
            </Notice>
          )}
          {isCreator && mustDo.length > 0 && (
            <div role="alert" className="overflow-hidden rounded-lg border border-blocker-vivid/40 bg-surface">
              <p className="flex items-center gap-2 bg-blocker-soft px-4 py-2.5 text-sm font-semibold text-blocker"><Icon name="alertCircle" className="h-4 w-4" />Must do now: {mustDo.length} post{mustDo.length > 1 ? "s" : ""} sent back to you</p>
              <ul className="divide-y divide-line">
                {mustDo.map((d) => (
                  <li key={d.id} className="px-4 py-3 text-sm">
                    <p className="font-medium">{d.title}</p>
                    <p className="mt-0.5 text-muted">&ldquo;{d.review?.comment}&rdquo; <span className="text-xs">({d.review?.by})</span></p>
                    <UnsentNote d={d} />
                    <p className="mt-2 flex gap-2">
                      <button className="btn btn-quiet btn-sm" onClick={() => open(d.id)}>View</button>
                      <Link href={`/?draft=${d.id}`} className="btn btn-teal btn-sm">Fix now</Link>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel overflow-hidden" data-tour="queue">
            <div className="border-b border-line p-2">
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter posts">
                {FILTERS.map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${filter === id ? "bg-ink text-surface" : "text-muted hover:bg-canvas hover:text-ink"}`}>
                    {label} <span className="opacity-60">{counts[id]}</span>
                  </button>
                ))}
              </div>
            </div>
            {!loaded ? (
              <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 w-full" />)}</div>
            ) : visible.length === 0 ? (
              <EmptyState icon="review" title={filter === "in_review" || (filter === "all" && !counts.all) ? "Nothing is waiting" : "No posts here"}
                body={filter === "in_review" || filter === "all" ? "Send a post from the content checker and it will appear here." : "Recently decided posts appear here."} />
            ) : (
              <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
                {visible.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => open(d.id)} aria-current={selected?.id === d.id}
                      className={`relative block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-canvas ${selected?.id === d.id ? "bg-teal-soft/50" : ""}`}>
                      {selected?.id === d.id && <span className="absolute inset-y-0 left-0 w-0.5 bg-teal" aria-hidden />}
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                        <StatusChip status={d.status} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{d.preview}</span>
                      <span className="mt-1 flex flex-wrap gap-x-3 text-2xs text-muted">
                        <span>{d.author}</span><span>{when(d.updated_at)}</span>
                        {d.requires_senior && <span className="font-medium text-sensitive">Needs marketing head</span>}
                      </span>
                      {d.status === "changes_requested" && d.review?.comment && <span className="mt-1 block truncate text-xs text-warning">&ldquo;{d.review.comment}&rdquo;</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {error && <Notice tone="error" role="alert">{error}</Notice>}
          {notice && <Notice tone="success" role="status">{notice}</Notice>}
          {!selected ? (
            <div className="panel"><EmptyState icon="eye" title="Pick a post on the left" body="Its content, check results and the creator's decisions open here." /></div>
          ) : (
            <>
              <div className="panel">
                <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold tracking-tight">{selected.title}</h2>
                    <p className="mt-0.5 text-sm text-muted">{selected.channel}, version {selected.version}, by {selected.author}</p>
                  </div>
                  <StatusChip status={selected.status} />
                </div>
                <div className="space-y-4 p-5">
                  {selected.status === "changes_requested" && selected.review?.comment && (
                    <Notice tone="error" role="alert">
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
                    </Notice>
                  )}
                  {selected.status === "in_review" && selected.review?.action === "request_changes" && (
                    <Notice tone="info">
                      <p className="font-semibold text-ink">
                        Resubmitted as version {selected.version}
                        {selected.version > selected.review.version ? ` (was version ${selected.review.version})` : " with no changes since the last review"}
                      </p>
                      <p className="mt-1">{selected.review.by} had asked: &ldquo;{selected.review.comment}&rdquo;</p>
                    </Notice>
                  )}
                  {selected.requires_senior && <Notice tone="sensitive">Mentions a sensitive topic. Only the marketing head can approve it.</Notice>}
                  {selected.summary?.brand_fit && selected.summary.brand_fit.verdict !== "yes" && <BrandFitBanner fit={selected.summary.brand_fit} />}
                  {(selected.images || []).map((m, i) => (
                    <div key={i} className="flex flex-col gap-4 rounded-lg bg-canvas p-3 text-sm ring-1 ring-line sm:flex-row">
                      {m.preview
                        ? <img src={m.preview} alt={m.alt_text || `Post image ${i + 1}`} className="max-h-72 w-full shrink-0 rounded-md border border-line bg-surface object-contain sm:w-64" />
                        : <div className="flex h-32 w-full shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-surface p-2 text-center text-xs text-muted sm:w-40">No preview saved. Ask the creator to check the post again.</div>}
                      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1">
                        <dt className="col-span-2 mb-1 font-medium">Image {i + 1}: <span className="font-normal text-muted">{m.file_name}</span></dt>
                        <dt className="text-muted">Text in image</dt><dd>{m.text || "none"}</dd>
                        <dt className="text-muted">Alt text</dt><dd>{m.alt_text || "missing"}</dd>
                      </dl>
                    </div>
                  ))}
                  {selected.content && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted">{schema?.fields.find((x) => x.id === "main_text")?.label || "Caption"}</p>
                      <div className="rounded-lg border border-line px-4 py-3"><ProofText text={selected.content} findings={selected.findings || []} /></div>
                    </div>
                  )}
                  {selected.platform && Object.keys(selected.fields || {}).length > 0 && (
                    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
                      {Object.entries(selected.fields).map(([k, v]) => (
                        <div key={k} className="contents"><dt className="text-muted">{schema?.fields.find((x) => x.id === k)?.label || k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>
                      ))}
                    </dl>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    {selected.platform && (
                      <button className="btn btn-quiet btn-sm" onClick={() => setShowPreview(!showPreview)} aria-expanded={showPreview}>
                        <Icon name="eye" className="h-3.5 w-3.5" />{showPreview ? "Hide preview" : "Show as it will appear"}
                      </button>
                    )}
                    <Link className="btn btn-ghost btn-sm" href={`/drafts/${selected.id}`}><Icon name="history" className="h-3.5 w-3.5" />Full history and versions</Link>
                  </div>
                  {selected.platform && showPreview && (
                    <div className="rounded-lg bg-canvas p-4">
                      <PostPreview layout={LAYOUT[selected.platform]} platform={selected.platform} format={selected.format} context={selected.context}
                        contextLabel={(selected.channel || "").split(" · ")[2] || ""} brand={brand || "Your brand"} text={selected.content || ""}
                        fields={selected.fields || {}} media={selected.images || []} />
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2" data-tour="review-checks">
                <Card title={<span className="flex items-center gap-2"><Icon name="shield" className="h-4 w-4 text-muted" />Automated checks</span>}
                  sub={`Issues still in this version: ${selected.findings?.length || 0}`}>
                  {LAYERS.map(([lid, label]) => {
                    const list = (selected.findings || []).filter((f) => (f.layer || "brand") === lid);
                    if (!list.length) return null;
                    return (
                      <div key={lid} className="mb-4 last:mb-0">
                        <p className="text-xs font-medium text-muted">{label}</p>
                        <ul className="mt-2 space-y-2.5 text-sm">
                          {list.map((f) => (
                            <li key={f.id} className="flex items-start gap-2.5">
                              <SeverityTag severity={f.severity} />
                              <span className="min-w-0">{f.name}{f.quote ? <>: <span className="text-muted">&ldquo;{f.quote}&rdquo;</span></> : null}
                                <span className="mt-0.5 block text-xs text-muted">{f.location_label || f.location}{f.confidence ? `, ${f.confidence === "Unverified" ? "couldn't verify" : `${f.confidence.toLowerCase()} confidence`}` : ""}. {f.sources?.[0]}</span></span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                  {!selected.findings?.length && <p className="flex items-center gap-2 text-sm text-approved"><Icon name="checkCircle" className="h-4 w-4" />None. The last check found no issues.</p>}
                </Card>
                <Card title={<span className="flex items-center gap-2"><Icon name="user" className="h-4 w-4 text-muted" />Creator decisions</span>}
                  sub={`${fixed.length} fix${fixed.length === 1 ? "" : "es"} accepted or edited before review`}>
                  {kept.length > 0 ? (
                    <ul className="space-y-2 text-sm">
                      {kept.map((d) => (
                        <li key={d.id} className="rounded-md bg-warning-soft px-3 py-2">
                          <span className="font-medium">Kept original</span> for {d.name}{d.quote ? ` (“${d.quote}”)` : ""}
                          <span className="mt-0.5 block text-ink/80">Reason: {d.reason}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">No flags were overridden.</p>}
                </Card>
              </div>

              {selected.status === "in_review" && !isCreator && (
                <div className="panel overflow-hidden" data-tour="decision">
                  <div className="border-b border-line px-5 py-3.5">
                    <h3 className="section-title">Your decision</h3>
                    <p className="mt-0.5 text-xs text-muted">Signed in as {person?.name}. Your decision is saved to the audit history.</p>
                  </div>
                  <div className="space-y-3 p-5">
                    <label className="label" htmlFor="comment">Comment for the creator</label>
                    <textarea id="comment" className="field min-h-[5rem]" value={comment} onChange={(e) => setComment(e.target.value)}
                      placeholder="Required when asking for changes" />
                    <div className="flex flex-wrap gap-2">
                      <button className="btn btn-teal" disabled={busy} onClick={() => decide("approve")}><Icon name="check" className="h-4 w-4" />Approve version {selected.version}</button>
                      <button className="btn btn-danger" disabled={busy} onClick={() => decide("request_changes")}>Request changes</button>
                    </div>
                  </div>
                </div>
              )}
              {selected.review && selected.status !== "in_review" && (
                <div className="panel flex items-start gap-3 px-5 py-4 text-sm">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${selected.review.action === "approve" ? "bg-approved-soft text-approved" : "bg-warning-soft text-warning"}`}>
                    <Icon name={selected.review.action === "approve" ? "check" : "message"} className="h-4 w-4" />
                  </span>
                  <p>
                    <span className="font-medium">{selected.review.action === "approve" ? "Approved" : "Changes requested"} by {selected.review.by}</span> <span className="text-muted">({selected.review.role}), {when(selected.review.at)}</span>
                    {selected.review.comment && <span className="mt-0.5 block text-muted">&ldquo;{selected.review.comment}&rdquo;</span>}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
