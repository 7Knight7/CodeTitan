"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, draftsChanged, STATUS_LABEL } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import ProofText, { keyOf } from "@/components/ProofText";
import IssueCard from "@/components/IssueCard";
import PostPreview from "@/components/PostPreview";
import BrandFitBanner from "@/components/BrandFitBanner";

const MAX_MEDIA = 10;
const LEGACY = { // posts saved before platforms existed
  "Instagram post": ["instagram", "feed", "organic"], "Facebook post": ["facebook", "image", "organic"],
  "LinkedIn post": ["linkedin", "text", "organic"], "WhatsApp broadcast": ["whatsapp", "text", "organic"],
  "Website banner": ["website", "promo", "organic"], "Influencer post": ["instagram", "feed", "influencer"],
  "Paid partnership": ["instagram", "feed", "paid_partnership"],
};
const LAYER_LABEL = { platform: "Platform requirements", regulation: "Indian advertising regulations", brand: "Brand governance", facts: "Factual verification", visual: "Visual intelligence" };
const isMediaLoc = (loc = "") => /^(image|video|document) /.test(loc);

export default function Page() {
  return <Suspense fallback={<p className="text-muted">Loading…</p>}><WritePage /></Suspense>;
}

function WritePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { person } = useRole();
  const [ws, setWs] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [title, setTitle] = useState("New post");
  const [platform, setPlatform] = useState("instagram");
  const [format, setFormat] = useState("feed");
  const [context, setContext] = useState("organic");
  const [schema, setSchema] = useState(null);
  const [profile, setProfile] = useState(null);
  const [fields, setFields] = useState({}); // every field the user typed, kept while switching formats
  const [media, setMedia] = useState([]); // uploads with measurements and a small preview
  const [tab, setTab] = useState("edit");
  const [reading, setReading] = useState(null);
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendError, setSendError] = useState("");
  const [myDrafts, setMyDrafts] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [adaptOpen, setAdaptOpen] = useState(false);

  const notCreator = person && person.role !== "Creator";
  const noKit = !!ws?.empty;
  // A post with the reviewer or approved can't change. Everyone else can explore platforms, formats and the
  // preview; only the creator can check, send, adapt or decide (the server enforces this too).
  const locked = !!(draft && ["in_review", "approved"].includes(draft.status));
  const canAct = !notCreator && !noKit;
  const caption = fields.main_text || "";

  const loadMine = useCallback(() => { api("/drafts?status=draft,changes_requested").then(setMyDrafts).catch(() => {}); }, []);
  useEffect(() => {
    loadMine();
    api("/workspace").then(setWs).catch(() => {});
    api("/platforms").then(setCfg).catch((e) => setError(e.message));
  }, [loadMine]);

  // The composer asks the server which fields and checks apply to this platform, format and context.
  useEffect(() => {
    let live = true;
    const q = `platform=${platform}&format=${format}&context=${context}`;
    Promise.all([api(`/input-schema?${q}`), api(`/validation-profile?${q}`)])
      .then(([s, p]) => { if (live) { setSchema(s); setProfile(p); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [platform, format, context]);

  useEffect(() => {
    const id = params.get("draft");
    if (!id || draft?.id === id) return;
    api(`/drafts/${id}`).then((d) => {
      const [p, f, c] = d.platform ? [d.platform, d.format, d.context || "organic"] : (LEGACY[d.channel] || ["instagram", "feed", "organic"]);
      setDraft(d); setTitle(d.title); setPlatform(p); setFormat(f); setContext(c);
      setFields({ ...(d.fields || {}), main_text: d.content || "" });
      setMedia((d.images || []).map((m) => ({ kind: "image", ...m })));
      setResult({ findings: d.findings || [], verified: d.verified || [], summary: d.summary || summarise(d.findings || []), input_errors: d.input_errors || [] });
    }).catch((e) => setError(e.message));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setAdaptOpen(false); }, [draft?.id]);

  const platformCfg = cfg?.platforms.find((p) => p.id === platform);
  const contextCfg = cfg?.contexts.find((c) => c.id === context);
  const mediaSpec = schema?.fields.find((x) => x.type === "media");
  // Uploads this format can use; the rest are kept in case the user switches back.
  const usedMedia = useMemo(() => {
    if (!mediaSpec) return [];
    return media.filter((m) => mediaSpec.kinds.includes(m.kind || "image")).slice(0, mediaSpec.max);
  }, [media, mediaSpec]);
  const unused = media.length - usedMedia.length;

  function choosePlatform(p) {
    if (p === platform) return;
    const formats = cfg.platforms.find((x) => x.id === p).formats;
    setPlatform(p);
    if (!formats.some((f) => f.id === format)) setFormat(formats[0].id);
  }

  const decisions = useMemo(() => {
    const m = new Map();
    for (const x of draft?.decisions || []) m.set(`${x.rule_id}|${x.quote}|${x.location}`, x);
    return m;
  }, [draft]);

  function payload(nextFields = fields) {
    const ids = new Set((schema?.fields || []).map((x) => x.id));
    const sent = Object.fromEntries(Object.entries(nextFields).filter(([k, v]) => ids.has(k) && k !== "main_text" && v));
    const content = ids.has("main_text") ? nextFields.main_text || "" : ""; // e.g. stories have no caption
    return { title: title || "Untitled post", platform, format, context, content, fields: sent, images: usedMedia };
  }

  async function check(nextFields = fields) {
    setBusy(true); setError(""); setNotice(""); setSendError("");
    try {
      const body = payload(nextFields);
      const saved = draft ? await api(`/drafts/${draft.id}`, { method: "PUT", body }) : await api("/drafts", { method: "POST", body });
      setDraft(saved);
      setResult({ findings: saved.findings, verified: saved.verified, summary: saved.summary, input_errors: saved.input_errors || [] });
      if (!draft) router.replace(`/?draft=${saved.id}`, { scroll: false });
      loadMine(); draftsChanged();
      if (window.innerWidth < 1024) setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function addMedia(files) {
    const room = MAX_MEDIA - media.length;
    const list = [...files].slice(0, room);
    if (!list.length) return;
    setError("");
    const lib = await import("@/lib/image");
    const added = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const kind = file.type.startsWith("video/") ? "video" : file.type === "application/pdf" ? "document" : file.type.startsWith("image/") ? "image" : null;
      if (!kind || (mediaSpec && !mediaSpec.kinds.includes(kind))) {
        setError(`${file.name}: ${schema?.label || "This format"} accepts ${mediaSpec?.noun || "no uploads"} only.`);
        continue;
      }
      setReading({ n: media.length + i + 1, pct: 0, kind });
      const opts = { brandColours: ws?.meta?.brand_colours || [], logo: ws?.meta?.logo || null, onProgress: (pct) => setReading({ n: media.length + i + 1, pct, kind }) };
      try {
        added.push(kind === "video" ? await lib.analyseVideo(file, opts) : kind === "document" ? await lib.readPdf(file, api) : await lib.analyseImage(file, opts));
      } catch (e) { setError(`${file.name}: ${e.message || "could not be read"}`); }
    }
    setReading(null);
    setMedia((cur) => [...cur, ...added]);
  }

  const setField = (id, v) => setFields((cur) => ({ ...cur, [id]: v }));
  const updateMedia = (m, patch) => setMedia((cur) => cur.map((x) => (x === m ? { ...x, ...patch } : x)));
  const moveMedia = (m, dir) => setMedia((cur) => {
    const i = cur.indexOf(m), j = i + dir;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  // Apply an accepted or edited fix to the field it came from, then check again.
  async function decide(f, action, { newText = "", reason = "" }) {
    if (!draft) return;
    setError("");
    try {
      await api(`/drafts/${draft.id}/decisions`, { method: "POST", body: { finding_id: f.id, action, reason, new_text: newText } });
      const fid = f.location === "caption" ? "main_text" : f.location?.startsWith("field:") ? f.location.slice(6) : null;
      if ((action === "accept" || action === "edit") && fid && (f.fix !== "manual" || action === "edit")) {
        const text = fields[fid] || "";
        let updated = text;
        if (f.fix === "prepend") updated = newText.trimEnd() + " " + text;
        else if (f.end > f.start || f.quote) updated = text.slice(0, f.start) + newText + text.slice(f.end);
        else updated = text.replace(/\s*$/, "") + (newText.startsWith(" ") ? newText : " " + newText);
        const next = { ...fields, [fid]: updated };
        setFields(next);
        await check(next);
      } else {
        setDraft(await api(`/drafts/${draft.id}`));
      }
      setSendError(""); draftsChanged();
    } catch (e) { setError(e.message); }
  }

  async function submit() {
    setBusy(true); setError(""); setNotice(""); setSendError("");
    try {
      const saved = await api(`/drafts/${draft.id}`, { method: "PUT", body: payload() });
      setDraft(saved);
      setResult({ findings: saved.findings, verified: saved.verified, summary: saved.summary, input_errors: saved.input_errors || [] });
      const d = await api(`/drafts/${draft.id}/submit`, { method: "POST" });
      setDraft(d);
      setNotice(`Version ${d.version} sent for review.` + (d.requires_senior ? " It mentions a sensitive topic, so the marketing head must approve it." : ""));
      loadMine(); draftsChanged();
    } catch (e) {
      setSendError(e.detail?.blockers ? `${e.message} Open: ${e.detail.blockers.join(", ")}.` : e.message);
      loadMine(); draftsChanged();
    } finally { setBusy(false); }
  }

  function startNew() {
    setDraft(null); setResult(null); setMedia([]); setFields({}); setTitle("New post"); setContext("organic");
    setError(""); setNotice(""); setSendError(""); setTab("edit");
    router.replace("/", { scroll: false });
  }

  const findings = result?.findings || [];
  const inputErrors = result?.input_errors || [];
  const errorsByField = useMemo(() => {
    const m = {}; for (const e of inputErrors) (m[e.field] ||= []).push(e.message); return m;
  }, [inputErrors]);
  const resolved = (f) => {
    const d = decisions.get(keyOf(f));
    return d && (d.action === "reject" || isMediaLoc(f.location));
  };
  const openBlockerList = findings.filter((f) => f.severity === "blocker" && !resolved(f));
  const keptKeys = new Set([...decisions.values()].filter((d) => d.action === "reject").map((d) => `${d.rule_id}|${d.quote}|${d.location}`));
  const brandName = ws?.meta?.name || "your brand";
  const layers = cfg?.layers || [];
  const totalChecks = profile ? profile.layers.reduce((n, L) => n + L.checks.length, 0) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-proof text-3xl font-semibold">Check a post before it goes out</h1>
            <p className="mt-1 max-w-prose text-muted">
              Choose where it goes, the format and whether it is paid. The composer shows only what that post needs, and it is
              checked against {brandName}&rsquo;s brand kit, approved facts, Indian ad rules and the platform&rsquo;s own limits.
            </p>
          </div>
          <button className="btn btn-quiet" onClick={startNew}>New post</button>
        </div>

        {noKit && <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">No brand kit is live yet, so posts can&rsquo;t be checked. The marketing head must upload the brand kit in Brand workspace first.</p>}
        {notCreator && <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">You are signed in as {person.name}. You can try platforms, formats and the preview here, but only creators check and send posts; switch to Priya in the header.</p>}
        {draft && (
          <div className="panel flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="font-medium">{STATUS_LABEL[draft.status]}</span>
            <span className="text-muted">Version {draft.version}</span>
            {draft.campaign_id && <span className="rounded bg-canvas px-2 py-0.5 text-xs text-muted">{draft.adapted_from ? "Adapted version" : "Campaign source"}</span>}
            {draft.review?.action === "request_changes" && draft.status === "changes_requested" && (
              <span className="w-full rounded-md bg-warning-soft px-3 py-2 text-warning">{draft.review.by} asked for changes: {draft.review.comment}</span>
            )}
            <Link href={`/drafts/${draft.id}`} className="ml-auto text-suggestion underline">History</Link>
          </div>
        )}

        {/* Where, how and under what commercial context: always visible so changing fields make sense */}
        <div id="selectors" className="panel space-y-4 p-4">
          <div>
            <label className="label" htmlFor="title">Post title (for your team)</label>
            <input id="title" className="field" value={title} disabled={locked} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {cfg && (
            <>
              <fieldset disabled={locked}>
                <legend className="label">Where it will be published</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {cfg.platforms.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={platform === p.id} onClick={() => choosePlatform(p.id)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${platform === p.id ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-canvas"}`}>{p.label}</button>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
                <fieldset disabled={locked}>
                  <legend className="label">Format</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup">
                    {platformCfg?.formats.map((f) => (
                      <button key={f.id} type="button" role="radio" aria-checked={format === f.id} onClick={() => setFormat(f.id)}
                        className={`rounded-full border px-3 py-1 text-sm ${format === f.id ? "border-suggestion bg-suggestion-soft font-medium text-suggestion" : "border-line bg-white hover:bg-canvas"}`}>{f.label}</button>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label className="label" htmlFor="context">Commercial context</label>
                  <select id="context" className="field" value={context} disabled={locked} onChange={(e) => setContext(e.target.value)}>
                    {cfg.contexts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  {contextCfg && <p className="mt-1 text-xs text-muted">{contextCfg.help}</p>}
                </div>
              </div>
              {profile && (
                <div className="rounded-md bg-canvas px-3 py-2 text-sm">
                  <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setShowProfile(!showProfile)} aria-expanded={showProfile}>
                    <span><span className="font-medium">{profile.label}</span><span className="text-muted"> · {totalChecks} checks in {profile.layers.filter((L) => L.checks.length).length} layers</span></span>
                    <span className="ml-auto text-xs underline">{showProfile ? "Hide" : "What is checked"}</span>
                  </button>
                  {showProfile && (
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {profile.layers.filter((L) => L.checks.length).map((L) => (
                        <div key={L.id}>
                          <p className="text-xs font-semibold">{L.label}</p>
                          <ul className="mt-1 space-y-0.5 text-xs text-muted">
                            {L.checks.slice(0, 8).map((c) => <li key={c.id} title={c.source}>{c.name}</li>)}
                            {L.checks.length > 8 && <li>and {L.checks.length - 8} more</li>}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="panel p-4">
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 flex flex-wrap items-center gap-1 rounded-t-lg border-b border-line bg-white px-4 pt-2">
            <div className="flex gap-1" role="tablist">
              {[["edit", "Write"], ["preview", "Preview"]].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? "border-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
              ))}
            </div>
            {schema && (
              <a href="#selectors" className="ml-auto mb-1 rounded-full bg-canvas px-3 py-1 text-xs text-muted hover:text-ink" title="Change platform, format or context">
                {schema.label}{context === "organic" ? " · Organic" : ""} <span className="underline">Change</span>
              </a>
            )}
          </div>

          {tab === "preview" && schema && (
            <PostPreview layout={schema.layout} platform={platform} format={format} context={context} contextLabel={contextCfg?.label}
              brand={ws?.meta?.name || "Your brand"} text={caption} fields={fields} media={usedMedia} />
          )}

          {tab === "edit" && schema && (
            <div className="space-y-4">
              {inputErrors.length > 0 && (
                <p role="alert" className="rounded-md bg-blocker-soft px-3 py-2 text-sm text-blocker">
                  Complete {inputErrors.length} field{inputErrors.length > 1 ? "s" : ""} before sending: {inputErrors.map((e) => e.message).join(" ")}
                </p>
              )}
              {renderGroups(schema.fields).map((g) => (
                <div key={g.title || "main"} className={g.title ? "space-y-3 rounded-lg border border-line p-3" : "space-y-4"}>
                  {g.title && <p className="text-sm font-semibold">{g.title} details
                    {g.fields.some((x) => x.internal) && <span className="block text-xs font-normal text-muted">For the reviewer and the disclosure check; these details are not published.</span>}</p>}
                  {g.fields.map((x) => x.type === "media"
                    ? <MediaInput key="media" spec={x} media={media} used={usedMedia} unused={unused} locked={locked} reading={reading}
                        hasLogo={!!ws?.meta?.logo} errors={errorsByField.media} onAdd={addMedia} onChange={updateMedia}
                        onRemove={(m) => setMedia((cur) => cur.filter((y) => y !== m))} onMove={moveMedia} />
                    : <FieldInput key={x.id} spec={x} value={fields[x.id] || ""} locked={locked} errors={errorsByField[x.id]}
                        prominent={x.id === "main_text" && schema.layout === "text"} onChange={(v) => setField(x.id, v)} />)}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button className="btn btn-primary" disabled={busy || locked || !canAct || !!reading || !schema} onClick={() => check()}>{busy ? "Checking…" : "Check post"}</button>
            {draft?.platform && !locked && canAct && <button className="btn btn-quiet" onClick={() => setAdaptOpen(!adaptOpen)}>Adapt for other platforms</button>}
            <span className="text-xs text-muted">Switching format keeps what you typed; only the fields shown are checked.</span>
          </div>
          {adaptOpen && draft && <AdaptPanel cfg={cfg} draft={draft} current={{ platform: draft.platform, format: draft.format }} onDone={() => { loadMine(); }} />}
        </div>

        {error && <p role="alert" className="rounded-md bg-blocker-soft px-4 py-3 text-sm text-blocker">{error}</p>}
        {notice && (
          <p role="status" className="rounded-md bg-approved-soft px-4 py-3 text-sm text-approved">
            {notice} <Link href="/review" className="underline">Open the review queue</Link> and switch to a reviewer in the header to decide.
          </p>
        )}

        {result && caption.trim() && (
          <div id="results" className="panel scroll-mt-4 p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted">{schema?.fields.find((x) => x.id === "main_text")?.label || "Caption"} with issues marked</h2>
            <ProofText text={caption} findings={findings} activeId={activeId} resolvedKeys={keptKeys}
              onSelect={(id) => { setActiveId(id); document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} />
          </div>
        )}

        {myDrafts.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-muted">Posts with the creator</h2>
            <ul className="space-y-2">
              {myDrafts.map((d) => (
                <li key={d.id}>
                  <Link href={`/?draft=${d.id}`} className="panel flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm hover:bg-canvas">
                    <span className="font-medium">{d.title}</span>
                    <span className="text-xs text-muted">{d.channel}</span>
                    <span className={`ml-auto text-xs ${d.status === "changes_requested" ? "text-warning" : "text-muted"}`}>{STATUS_LABEL[d.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        {!result ? (
          <div className="panel p-5 text-sm text-muted">
            <p className="font-medium text-ink">Issues will appear here.</p>
            <p className="mt-2">Pick the platform, format and context, fill in what the composer asks for, then press <span className="font-medium text-ink">Check post</span>. Findings are grouped by layer: platform, regulations, brand, facts and visuals.</p>
          </div>
        ) : (
          <>
            <BrandFitBanner fit={result.summary.brand_fit} />
            <div className="panel p-4 text-sm">
              <div className="flex gap-4">
                <Count n={result.summary.blocker} label="blockers" cls="text-blocker" />
                <Count n={result.summary.warning} label="warnings" cls="text-warning" />
                <Count n={result.summary.suggestion} label="suggestions" cls="text-suggestion" />
              </div>
              {result.summary.checks_run > 0 && (
                <p className="mt-2 text-xs text-muted"><span className="font-semibold text-approved">{result.summary.checks_passed} of {result.summary.checks_run}</span> checks passed.</p>
              )}
              {result.summary.sensitive && <p className="mt-2 rounded bg-sensitive-soft px-2 py-1 text-xs text-sensitive">Sensitive topic: only the marketing head can approve this post.</p>}
              {draft && !locked && canAct && (
                <div className="mt-4 border-t border-line pt-4">
                  <button className="btn btn-approve w-full" disabled={busy || openBlockerList.length > 0} onClick={submit}>
                    {draft.status === "changes_requested" ? "Send back for review" : "Send for review"}
                  </button>
                  {sendError && <p role="alert" className="mt-2 rounded bg-blocker-soft px-2 py-1.5 text-xs font-medium text-blocker">Not sent. {sendError}</p>}
                  {openBlockerList.length > 0
                    ? <p className="mt-2 rounded bg-blocker-soft px-2 py-1.5 text-xs text-blocker">
                        <span className="font-semibold">{openBlockerList.length} blocker{openBlockerList.length > 1 ? "s" : ""} must be resolved before sending</span> ({openBlockerList.map((f) => f.name).join(", ")}). Fix it and check again, or press &ldquo;Keep original&rdquo; with a reason.
                      </p>
                    : inputErrors.length > 0
                      ? <p className="mt-2 text-xs text-blocker">{inputErrors.length} field{inputErrors.length > 1 ? "s" : ""} still to complete.</p>
                      : <p className="mt-2 text-xs text-muted">No open blockers. A reviewer will see every decision you made.</p>}
                </div>
              )}
              {locked && draft && !notCreator && !noKit && <p className="mt-3 text-xs text-muted">This version is {STATUS_LABEL[draft.status].toLowerCase()} and can no longer be edited.</p>}
            </div>
            {result.verified?.length > 0 && (
              <div className="panel p-4 text-sm">
                <h2 className="font-semibold text-approved">Matches approved facts</h2>
                <ul className="mt-2 space-y-1">{result.verified.map((v, i) => <li key={i}>&ldquo;{v.quote}&rdquo; <span className="text-muted">({v.location}) matches {v.fact_id}: {v.label}</span></li>)}</ul>
              </div>
            )}
            {findings.length === 0 && <p className="panel p-4 text-sm text-approved">No issues found. Send it for review when you are ready.</p>}
            {(layers.length ? layers.map((L) => L.id) : Object.keys(LAYER_LABEL)).map((lid) => {
              const list = findings.filter((f) => (f.layer || "brand") === lid);
              if (!list.length) return null;
              return (
                <div key={lid} className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{LAYER_LABEL[lid]} ({list.length})</h2>
                  {list.map((f) => (
                    <div id={`card-${f.id}`} key={f.id}>
                      <IssueCard finding={f} n={findings.indexOf(f) + 1} active={activeId === f.id} onSelect={setActiveId}
                        decision={decisions.get(keyOf(f))} disabled={locked || busy || !canAct} onDecide={(action, opts) => decide(f, action, opts)} />
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </aside>
    </div>
  );
}

function renderGroups(fields) {
  const main = { title: null, fields: [] };
  const groups = new Map();
  for (const f of fields) {
    if (f.group) { if (!groups.has(f.group)) groups.set(f.group, { title: f.group, fields: [] }); groups.get(f.group).fields.push(f); }
    else main.fields.push(f);
  }
  return [main, ...groups.values()];
}

function FieldInput({ spec, value, locked, errors, prominent, onChange }) {
  const id = `f-${spec.id}`;
  const label = <label className="label" htmlFor={id}>{spec.label}{spec.required ? <span className="text-blocker"> *</span> : <span className="font-normal text-muted"> (optional)</span>}</label>;
  const err = errors?.length ? <p className="mt-1 text-xs text-blocker">{errors.join(" ")}</p> : null;
  const cls = `field ${errors?.length ? "border-blocker" : ""}`;
  const counter = spec.limit ? (
    <p className={`mt-1 text-right text-xs ${value.length > spec.limit ? "font-semibold text-warning" : "text-muted"}`}>{value.length.toLocaleString("en-IN")} / {spec.limit.toLocaleString("en-IN")}</p>
  ) : null;
  if (spec.type === "longtext" || spec.type === "lines") {
    return (
      <div>{label}
        <textarea id={id} className={`${cls} ${prominent ? "min-h-[10rem] font-proof text-lg leading-8" : spec.id === "main_text" ? "min-h-[6rem] font-proof" : "min-h-[4.5rem]"}`}
          value={value} disabled={locked} maxLength={spec.max || 5000} placeholder={spec.placeholder || (spec.type === "lines" ? "One per line" : "")}
          onChange={(e) => onChange(e.target.value)} aria-invalid={!!errors?.length} />
        {counter}{err}
      </div>
    );
  }
  if (spec.type === "select") {
    return (
      <div>{label}
        <select id={id} className={cls} value={value} disabled={locked} onChange={(e) => onChange(e.target.value)} aria-invalid={!!errors?.length}>
          <option value="">Choose…</option>
          {spec.options.map((o) => <option key={o}>{o}</option>)}
        </select>{err}
      </div>
    );
  }
  return (
    <div>{label}
      <input id={id} className={cls} type={spec.type === "date" ? "date" : spec.type === "url" ? "url" : "text"} value={value} disabled={locked}
        maxLength={spec.max || 500} placeholder={spec.placeholder || ""} onChange={(e) => onChange(e.target.value)} aria-invalid={!!errors?.length} />
      {err}
    </div>
  );
}

function MediaInput({ spec, media, used, unused, locked, reading, hasLogo, errors, onAdd, onChange, onRemove, onMove }) {
  const [over, setOver] = useState(false);
  const full = used.length >= spec.max;
  return (
    <div>
      <p className="label">{spec.label}{spec.required ? <span className="text-blocker"> *</span> : <span className="font-normal text-muted"> (optional)</span>}
        <span className="font-normal text-muted"> · {used.length} of {spec.max}</span></p>
      {!locked && !full && (
        <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(e.dataTransfer.files || []); }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm ${over ? "border-suggestion bg-suggestion-soft" : "border-line bg-canvas hover:border-suggestion"} ${reading ? "pointer-events-none opacity-60" : ""}`}>
          <input type="file" accept={spec.accept} multiple={spec.max > 1} className="sr-only" disabled={!!reading}
            onChange={(e) => { onAdd(e.target.files || []); e.target.value = ""; }} />
          <span className="font-medium">{reading ? `Reading ${reading.kind} ${reading.n}… ${reading.pct ? `${reading.pct}%` : ""}` : `Choose ${spec.noun} files or drop them here`}</span>
          <span className="mt-1 text-xs text-muted">{spec.help}</span>
        </label>
      )}
      {errors?.length > 0 && <p className="mt-1 text-xs text-blocker">{errors.join(" ")}</p>}
      {unused > 0 && <p className="mt-2 rounded bg-canvas px-3 py-2 text-xs text-muted">{unused} upload{unused > 1 ? "s are" : " is"} not used by this format. {unused > 1 ? "They are" : "It is"} kept in case you switch back.</p>}
      <div className="mt-3 space-y-3">
        {used.map((m, i) => (
          <MediaCard key={i} n={i + 1} m={m} total={used.length} sequence={spec.max > 1} locked={locked} hasLogo={hasLogo}
            onChange={(patch) => onChange(m, patch)} onRemove={() => onRemove(m)} onMove={(dir) => onMove(m, dir)} />
        ))}
      </div>
      {media.length > used.length && !locked && (
        <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Show unused uploads</summary>
          <ul className="mt-1 list-disc pl-5">{media.filter((m) => !used.includes(m)).map((m, i) => <li key={i}>{m.file_name} ({m.kind}) <button className="underline" onClick={() => onRemove(m)}>remove</button></li>)}</ul>
        </details>
      )}
    </div>
  );
}

function MediaCard({ n, m, total, sequence, locked, hasLogo, onChange, onRemove, onMove }) {
  const kind = m.kind || "image";
  const share = m.brand_share != null ? `${Math.round(m.brand_share * 100)}%` : "No brand colours set";
  const logo = !hasLogo ? "No logo in brand kit" : m.logo_score == null ? "Not checked" : m.logo_score >= 0.6 ? "Found" : "Not found";
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap gap-3">
        {kind === "document"
          ? <div className="flex h-24 w-20 items-center justify-center rounded border border-line bg-blocker-soft text-xs font-semibold text-blocker">PDF</div>
          : m.preview
            ? <div className="relative"><img src={m.preview} alt={m.alt_text || `Upload ${n}`} className="h-32 w-auto max-w-[45vw] rounded border border-line object-contain sm:max-w-[14rem]" />
                {kind === "video" && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs text-white">▶ {m.duration ? `${m.duration}s` : "video"}</span>}</div>
            : <div className="flex h-32 w-32 items-center justify-center rounded border border-dashed border-line p-2 text-center text-xs text-muted">No preview saved</div>}
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-medium">{sequence ? `${n} of ${total}` : kind.charAt(0).toUpperCase() + kind.slice(1)}: {m.file_name}</p>
          {kind === "document" ? (
            <p className="text-muted">{m.pages ? `${m.pages} pages. ` : ""}{m.note || "Its text is checked like the post text."}</p>
          ) : (
            <>
              {m.width && <p><span className="text-muted">Size:</span> {m.width}×{m.height}{kind === "video" ? " · one frame read" : ""}</p>}
              <p><span className="text-muted">Brand colours:</span> {share}
                <span className="ml-2 inline-flex gap-1 align-middle">{(m.palette || []).map((c) => <span key={c.hex} title={`${c.hex}, ${Math.round(c.share * 100)}%`} className="inline-block h-3 w-5 rounded border border-line" style={{ background: c.hex }} />)}</span></p>
              <p><span className="text-muted">Logo:</span> {logo}</p>
              <p><span className="text-muted">Lowest text contrast:</span> {m.contrast_min ? `${m.contrast_min}:1` : "Not measured"}
                {m.ocr_confidence != null && <span className="text-muted"> · read with {m.ocr_confidence}% confidence</span>}</p>
            </>
          )}
          {!locked && (
            <p className="flex gap-3">
              {sequence && <><button className="text-suggestion underline disabled:opacity-40" disabled={n === 1} onClick={() => onMove(-1)}>Move up</button>
                <button className="text-suggestion underline disabled:opacity-40" disabled={n === total} onClick={() => onMove(1)}>Move down</button></>}
              <button className="text-suggestion underline" onClick={onRemove}>Remove</button>
            </p>
          )}
        </div>
      </div>
      <div className={`mt-3 grid gap-3 ${kind === "image" ? "sm:grid-cols-2" : ""}`}>
        <div>
          <label className="label" htmlFor={`txt-${n}`}>{kind === "document" ? "Text read from the PDF" : kind === "video" ? "Text read from the frame" : "Text read from the image"}</label>
          <textarea id={`txt-${n}`} className="field min-h-[4rem]" value={m.text || ""} disabled={locked} maxLength={20000}
            onChange={(e) => onChange({ text: e.target.value })} placeholder="No text found. Type what it says." />
          <p className="mt-1 text-xs text-muted">Correct any misread words before checking.</p>
        </div>
        {kind === "image" && (
          <div>
            <label className="label" htmlFor={`alt-${n}`}>Alt text</label>
            <textarea id={`alt-${n}`} className="field min-h-[4rem]" value={m.alt_text || ""} disabled={locked} maxLength={500}
              onChange={(e) => onChange({ alt_text: e.target.value })} placeholder="Describe the image for screen readers" />
          </div>
        )}
      </div>
    </div>
  );
}

function AdaptPanel({ cfg, draft, current, onDone }) {
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [error, setError] = useState("");
  const targets = Object.entries(pick).filter(([, f]) => f).map(([platform, format]) => ({ platform, format }));
  async function go() {
    setBusy(true); setError("");
    try { setOut(await api(`/drafts/${draft.id}/adapt`, { method: "POST", body: { targets } })); onDone(); draftsChanged(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="mt-4 rounded-lg border border-line p-4 text-sm">
      <p className="font-semibold">Create once, adapt everywhere</p>
      <p className="mt-1 text-muted">Pick destinations. Each gets its own linked draft with the same wording and approved claims, restructured for that platform
        (fields moved, hashtags and media kept where the format allows). Wording is not rewritten by AI. Each version is checked on its own and needs its own review.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {cfg.platforms.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <input type="checkbox" aria-label={`Adapt for ${p.label}`} checked={!!pick[p.id]} onChange={(e) => setPick((c) => ({ ...c, [p.id]: e.target.checked ? (p.id === current.platform ? p.formats.find((f) => f.id !== current.format)?.id : p.formats[0].id) : null }))} />
            <span className="w-24">{p.label}</span>
            <select className="field py-1" disabled={!pick[p.id]} value={pick[p.id] || ""} onChange={(e) => setPick((c) => ({ ...c, [p.id]: e.target.value }))}>
              {!pick[p.id] && <option value="">Format</option>}
              {p.formats.filter((f) => !(p.id === current.platform && f.id === current.format)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button className="btn btn-primary mt-3" disabled={busy || targets.length === 0} onClick={go}>{busy ? "Creating versions…" : `Create ${targets.length || ""} version${targets.length === 1 ? "" : "s"}`}</button>
      {error && <p className="mt-2 text-blocker">{error}</p>}
      {out && (
        <ul className="mt-3 space-y-2">
          {out.created.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded bg-canvas px-3 py-2">
              <span className="font-medium">{c.channel}</span>
              <span className="text-xs text-muted">{c.summary.blocker} blockers · {c.summary.warning} warnings{c.input_errors.length ? ` · ${c.input_errors.length} fields to complete` : ""}</span>
              <Link href={`/?draft=${c.id}`} className="ml-auto text-suggestion underline">Open</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Count({ n, label, cls }) {
  return <div><span className={`text-2xl font-semibold ${cls}`}>{n}</span> <span className="text-muted">{label}</span></div>;
}

function summarise(findings) {
  const c = { blocker: 0, warning: 0, suggestion: 0 };
  findings.forEach((f) => { c[f.severity] += 1; });
  return { ...c, sensitive: findings.some((f) => f.sensitive) };
}
