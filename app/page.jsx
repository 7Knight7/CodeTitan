"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, draftsChanged, STATUS_LABEL } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import ProofText, { keyOf } from "@/components/ProofText";
import IssueCard from "@/components/IssueCard";
import PostPreview from "@/components/PostPreview";
import BrandFitBanner from "@/components/BrandFitBanner";
import { MemoryTips } from "@/components/BrandMemory";
import Icon from "@/components/Icon";
import { Card, Notice, PageHeader, ScoreRing, StatusChip } from "@/components/ui";
import ExamplePicker, { EXAMPLES } from "@/components/Examples";
import { useTour } from "@/components/Tour";

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
  return <Suspense fallback={<div className="space-y-4"><div className="skeleton h-8 w-64" /><div className="skeleton h-48 w-full" /></div>}><WritePage /></Suspense>;
}

function WritePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { person, setRole } = useRole();
  const [ws, setWs] = useState(null);
  const [schemaKey, setSchemaKey] = useState(""); // which platform/format/context the loaded schema is for
  const [pending, setPending] = useState(null); // a ready-made example being filled in and checked
  const autoRan = useRef(false);
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
      .then(([s, p]) => { if (live) { setSchema(s); setProfile(p); setSchemaKey(`${platform}/${format}/${context}`); } })
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

  // Ready-made examples: fill the composer like a person would, then run the same check.
  function runExample(ex) {
    setDraft(null); setResult(null); setActiveId(null); setTab("edit"); setAdaptOpen(false);
    setError(""); setNotice(""); setSendError("");
    setTitle(ex.title); setPlatform(ex.platform); setFormat(ex.format); setContext(ex.context);
    setFields({ ...(ex.fields || {}), main_text: ex.caption || "" });
    setMedia([]);
    router.replace("/", { scroll: false });
    setPending({ ex, stage: ex.image ? "media" : "check" });
  }

  useEffect(() => {
    if (!pending) return;
    const { ex, stage } = pending;
    if (!schema || schemaKey !== `${ex.platform}/${ex.format}/${ex.context}`) return; // wait for this format's fields
    if (stage === "media") {
      setPending({ ex, stage: "loading" });
      fetch(`/samples/${ex.image}`)
        .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
        .then((b) => addMedia([new File([b], ex.image, { type: b.type || "image/jpeg" })]))
        .catch(() => setError("The sample image could not be loaded. Upload your own image or try another example."))
        .finally(() => setPending((p) => p && p.ex.id === ex.id ? { ex, stage: "alt" } : p));
      return;
    }
    if (stage === "loading" || reading) return;
    if (stage === "alt") {
      if (ex.alt) setMedia((cur) => cur.map((m) => ({ ...m, alt_text: m.alt_text || ex.alt })));
      setPending({ ex, stage: "check" });
      return;
    }
    if (stage === "check") { setPending(null); check(); }
  }, [pending, schema, schemaKey, reading]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link such as /?example=claims (used by the guided demo) runs that example once the page is ready.
  useEffect(() => {
    const id = params.get("example");
    if (!id || autoRan.current || !cfg || !ws || !person) return;
    const ex = EXAMPLES.find((x) => x.id === id);
    if (!ex) return;
    if (!canAct) { setPlatform(ex.platform); setFormat(ex.format); setContext(ex.context); return; }
    autoRan.current = true;
    runExample(ex);
  }, [params, cfg, ws, person, canAct]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const summary = result?.summary;

  // First-run tips: before the first check, when results first appear, and right after sending.
  useTour(notCreator ? "checker-viewer" : "checker", !!schema && !result && !pending && !noKit && !params.get("example"));
  useTour("checker-results", !!result && !pending && !busy && canAct && !notice);
  useTour("checker-sent", !!notice);
  const unresolvedWarnings = findings.filter((f) => f.severity === "warning" && !decisions.get(keyOf(f))).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
      <section className="min-w-0 space-y-5">
        <PageHeader title="Content checker"
          sub={<>Pick where the post goes, its format and whether it is paid. The composer shows only the fields that post needs, and checks it against {brandName}&rsquo;s brand kit, approved facts, Indian ad rules and the platform&rsquo;s own limits.</>}
          actions={<button className="btn btn-quiet" onClick={startNew}><Icon name="plus" className="h-4 w-4" />New post</button>} />

        {noKit && <Notice tone="warning">No brand kit is live yet, so posts can&rsquo;t be checked. The marketing head must upload the brand kit in Brand guidelines first.</Notice>}
        {notCreator && <Notice tone="info">You are signed in as {person.name}. You can try platforms, formats and the preview here, but only creators check and send posts. Switch to Priya from the account menu in the top right.</Notice>}
        <ExamplePicker onRun={runExample} running={pending?.ex.id || (busy ? "busy" : null)}
          canRun={canAct} defaultOpen={!params.get("draft")} brand={ws?.meta?.name}
          blockedReason={noKit ? "No brand kit is live, so examples can't be checked. The marketing head can restore the demo brand in Brand guidelines." : "Only creators check posts. Switch to Priya to run an example."}
          onSwitch={notCreator && !noKit ? () => setRole("Creator") : null} />
        {draft && (
          <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
            <StatusChip status={draft.status} />
            <span className="text-muted">Version {draft.version}</span>
            {draft.campaign_id && <span className="chip">{draft.adapted_from ? "Adapted version" : "Campaign source"}</span>}
            <Link href={`/drafts/${draft.id}`} className="link ml-auto inline-flex items-center gap-1.5"><Icon name="history" className="h-4 w-4" />History</Link>
            {draft.review?.action === "request_changes" && draft.status === "changes_requested" && (
              <Notice tone="warning" className="w-full"><span className="font-medium">{draft.review.by} asked for changes:</span> {draft.review.comment}</Notice>
            )}
          </div>
        )}

        {/* Where, how and under what commercial context: always visible so changing fields make sense */}
        <div id="selectors" className="panel scroll-mt-20" data-tour="setup">
          <div className="space-y-5 p-5">
            <div>
              <label className="label" htmlFor="title">Post title <span className="font-normal text-muted">(for your team)</span></label>
              <input id="title" className="field" value={title} disabled={locked} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {!cfg && <div className="space-y-3"><div className="skeleton h-9 w-full" /><div className="skeleton h-9 w-2/3" /></div>}
            {cfg && (
              <>
                <fieldset disabled={locked}>
                  <legend className="label">Platform</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Platform">
                    {cfg.platforms.map((p) => {
                      const on = platform === p.id;
                      return (
                        <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => choosePlatform(p.id)}
                          className={`flex flex-auto items-center gap-2.5 rounded-md border py-2 pl-2 pr-3.5 text-left text-sm transition-colors disabled:cursor-not-allowed sm:flex-none ${on ? "border-teal bg-teal-soft font-medium text-ink ring-1 ring-teal" : "border-line bg-surface text-ink hover:border-line-strong hover:bg-canvas"}`}>
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${on ? "bg-surface text-teal-dark" : "bg-canvas text-muted"}`}>
                            <Icon name={PLATFORM_ICON[p.id] || "globe"} className="h-4 w-4" />
                          </span>
                          <span className="whitespace-nowrap">{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_15rem]">
                  <fieldset disabled={locked} className="min-w-0">
                    <legend className="label">Format</legend>
                    <div className="seg" role="radiogroup" aria-label="Format">
                      {platformCfg?.formats.map((f) => (
                        <button key={f.id} type="button" role="radio" aria-checked={format === f.id} onClick={() => setFormat(f.id)} className="seg-item">{f.label}</button>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <label className="label" htmlFor="context">Commercial context</label>
                    <select id="context" className="field" value={context} disabled={locked} onChange={(e) => setContext(e.target.value)}>
                      {cfg.contexts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    {contextCfg && <p className="mt-1.5 text-xs text-muted">{contextCfg.help}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
          {profile && (
            <div className="border-t border-line bg-canvas/70 px-5 py-3 text-sm">
              <button type="button" className="flex w-full items-center gap-2.5 text-left" onClick={() => setShowProfile(!showProfile)} aria-expanded={showProfile}>
                <Icon name="layers" className="h-4 w-4 text-muted" />
                <span className="min-w-0"><span className="font-medium">{profile.label}</span><span className="text-muted">: {totalChecks} checks in {profile.layers.filter((L) => L.checks.length).length} layers</span></span>
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-teal-dark">{showProfile ? "Hide" : "What is checked"}<Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${showProfile ? "rotate-180" : ""}`} /></span>
              </button>
              {showProfile && (
                <div className="mt-3 grid gap-4 pb-1 sm:grid-cols-2 xl:grid-cols-3">
                  {profile.layers.filter((L) => L.checks.length).map((L) => (
                    <div key={L.id}>
                      <p className="text-xs font-semibold">{L.label} <span className="font-normal text-muted">({L.checks.length})</span></p>
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
        </div>

        <div className="panel">
          <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-t-lg border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur">
            <div className="seg" role="tablist">
              {[["edit", "Write", "checker"], ["preview", "Preview", "eye"]].map(([id, label, icon]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="seg-item inline-flex items-center gap-1.5">
                  <Icon name={icon} className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
            {schema && (
              <a href="#selectors" className="chip ml-auto hover:text-ink" title="Change platform, format or context">
                {schema.label}{context === "organic" ? ", organic" : ""} <span className="text-teal-dark">Change</span>
              </a>
            )}
          </div>

          <div className="p-5">
            {!schema && <div className="space-y-3"><div className="skeleton h-24 w-full" /><div className="skeleton h-10 w-full" /></div>}
            {tab === "preview" && schema && (
              <div className="rounded-lg bg-canvas p-4 sm:p-6">
                <PostPreview layout={schema.layout} platform={platform} format={format} context={context} contextLabel={contextCfg?.label}
                  brand={ws?.meta?.name || "Your brand"} text={caption} fields={fields} media={usedMedia} />
              </div>
            )}

            {tab === "edit" && schema && (
              <div className="space-y-5">
                {inputErrors.length > 0 && (
                  <Notice tone="error" role="alert">
                    Complete {inputErrors.length} field{inputErrors.length > 1 ? "s" : ""} before sending: {inputErrors.map((e) => e.message).join(" ")}
                  </Notice>
                )}
                {renderGroups(schema.fields).map((g) => (
                  <div key={g.title || "main"} className={g.title ? "space-y-4 rounded-lg border border-line bg-canvas/50 p-4" : "space-y-5"}>
                    {g.title && <p className="text-sm font-semibold">{g.title} details
                      {g.fields.some((x) => x.internal) && <span className="mt-0.5 block text-xs font-normal text-muted">For the reviewer and the disclosure check; these details are not published.</span>}</p>}
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
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-b-lg border-t border-line bg-canvas/60 px-5 py-4">
            <button className="btn btn-teal" data-tour="check-button" disabled={busy || locked || !canAct || !!reading || !schema} onClick={() => check()}>
              <Icon name={result ? "refresh" : "shield"} className="h-4 w-4" />{busy ? "Checking…" : result ? "Check again" : "Check post"}
            </button>
            {draft?.platform && !locked && canAct && <button className="btn btn-quiet" onClick={() => setAdaptOpen(!adaptOpen)} aria-expanded={adaptOpen}><Icon name="copy" className="h-4 w-4" />Adapt for other platforms</button>}
            <span className="text-xs text-muted">Switching format keeps what you typed; only the fields shown are checked.</span>
          </div>
          {adaptOpen && draft && <div className="border-t border-line p-5"><AdaptPanel cfg={cfg} draft={draft} current={{ platform: draft.platform, format: draft.format }} onDone={() => { loadMine(); }} /></div>}
        </div>

        {error && <Notice tone="error" role="alert">{error}</Notice>}
        {notice && (
          <div data-tour="sent"><Notice tone="success" role="status">
            {notice} <Link href="/review" className="font-medium underline">Open the review queue</Link> and switch to a reviewer from the account menu to decide.
          </Notice></div>
        )}

        {result && caption.trim() && (
          <div id="results" className="panel scroll-mt-20" data-tour="proof-text">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <h2 className="section-title">{schema?.fields.find((x) => x.id === "main_text")?.label || "Caption"} with issues marked</h2>
              <span className="ml-auto hidden items-center gap-3 text-xs text-muted sm:flex">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-blocker-vivid" />Critical</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-warning-vivid" />Warning</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-suggestion-vivid" />Suggestion</span>
              </span>
            </div>
            <div className="px-5 py-4">
              <ProofText text={caption} findings={findings} activeId={activeId} resolvedKeys={keptKeys}
                onSelect={(id) => { setActiveId(id); document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} />
            </div>
          </div>
        )}

        {myDrafts.length > 0 && (
          <Card title="Posts with the creator" sub="Drafts and posts sent back for changes" bodyClass="p-0">
            <ul className="divide-y divide-line">
              {myDrafts.map((d) => (
                <li key={d.id}>
                  <Link href={`/?draft=${d.id}`} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm transition-colors hover:bg-canvas ${draft?.id === d.id ? "bg-teal-soft/50" : ""}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.title}</span>
                      <span className="block truncate text-xs text-muted">{d.channel}</span>
                    </span>
                    <StatusChip status={d.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-2" aria-label="Check results">
        {!notCreator && !noKit && <MemoryTips />}
        {!result ? (
          <div className="panel p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-soft text-teal-dark"><Icon name="shield" className="h-5 w-5" /></span>
            <p className="mt-4 font-semibold">Results appear here</p>
            <p className="mt-1.5 text-sm leading-6 text-muted">Fill in what the composer asks for, then press <span className="font-medium text-ink">Check post</span>. Every finding names its source and is grouped by layer.</p>
            <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              {(layers.length ? layers : Object.entries(LAYER_LABEL).map(([id, label]) => ({ id, label }))).map((L) => (
                <li key={L.id} className="flex items-center gap-2.5 text-muted">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-canvas ring-1 ring-line"><Icon name={LAYER_ICON[L.id] || "layers"} className="h-3 w-3" /></span>
                  {LAYER_LABEL[L.id] || L.label}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="panel overflow-hidden" data-tour="verdict">
              <ResultVerdict locked={locked} draft={draft} blockers={openBlockerList.length} warnings={unresolvedWarnings}
                inputErrors={inputErrors.length} summary={summary} />
              <div className="grid grid-cols-3 border-y border-line">
                <Count n={summary.blocker} label="Critical" tone="blocker" />
                <Count n={summary.warning} label="Warnings" tone="warning" />
                <Count n={summary.suggestion} label="Suggestions" tone="suggestion" />
              </div>
              <ul className="divide-y divide-line text-sm">
                {(layers.length ? layers.map((L) => L.id) : Object.keys(LAYER_LABEL)).map((lid) => {
                  const list = findings.filter((f) => (f.layer || "brand") === lid);
                  const checks = profile?.layers.find((L) => L.id === lid)?.checks.length;
                  if (!list.length && !checks) return null;
                  const worst = list.some((f) => f.severity === "blocker") ? "blocker" : list.some((f) => f.severity === "warning") ? "warning" : list.length ? "suggestion" : null;
                  return (
                    <li key={lid}>
                      <a href={list.length ? `#layer-${lid}` : undefined} className={`flex items-center gap-3 px-4 py-2.5 ${list.length ? "hover:bg-canvas" : ""}`}>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${worst ? `bg-${worst}-soft text-${worst}` : "bg-approved-soft text-approved"}`}>
                          <Icon name={worst ? (worst === "blocker" ? "alertCircle" : worst === "warning" ? "alert" : "info") : "check"} className="h-3.5 w-3.5" strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{LAYER_LABEL[lid]}</span>
                        <span className={`text-xs ${worst ? `font-medium text-${worst}` : "text-approved"}`}>
                          {list.length ? `${list.length} issue${list.length > 1 ? "s" : ""}` : "Passed"}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
              {summary.checks_run > 0 && (
                <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
                  <span className="font-semibold text-approved">{summary.checks_passed} of {summary.checks_run}</span> checks passed
                </p>
              )}
              {summary.sensitive && <div className="border-t border-line px-4 py-3"><Notice tone="sensitive">Sensitive topic: only the marketing head can approve this post.</Notice></div>}
              {draft && !locked && canAct && (
                <div className="border-t border-line bg-canvas/60 p-4" data-tour="send">
                  <button className="btn btn-teal w-full" disabled={busy || openBlockerList.length > 0} onClick={submit}>
                    <Icon name="send" className="h-4 w-4" />{draft.status === "changes_requested" ? "Send back for review" : "Send for review"}
                  </button>
                  {sendError && <Notice tone="error" role="alert" className="mt-3"><span className="font-medium">Not sent.</span> {sendError}</Notice>}
                  {openBlockerList.length > 0
                    ? <p className="mt-2.5 text-xs leading-5 text-blocker">
                        <span className="font-semibold">{openBlockerList.length} blocker{openBlockerList.length > 1 ? "s" : ""} must be resolved before sending</span> ({openBlockerList.map((f) => f.name).join(", ")}). Fix it and check again, or press &ldquo;Keep original&rdquo; with a reason.
                      </p>
                    : inputErrors.length > 0
                      ? <p className="mt-2.5 text-xs text-blocker">{inputErrors.length} field{inputErrors.length > 1 ? "s" : ""} still to complete.</p>
                      : <p className="mt-2.5 text-xs text-muted">No open blockers. A reviewer will see every decision you made.</p>}
                </div>
              )}
              {locked && draft && !notCreator && !noKit && <p className="border-t border-line px-4 py-3 text-xs text-muted">This version is {STATUS_LABEL[draft.status].toLowerCase()} and can no longer be edited.</p>}
            </div>

            <BrandFitBanner fit={summary.brand_fit} />

            {summary.passed?.length > 0 && (
              <details className="panel group overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-3.5 text-sm font-semibold marker:hidden hover:bg-surface/40">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-approved-soft text-approved"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
                  Passed checks <span className="chip py-0">{summary.passed.length}</span>
                  <Icon name="chevronDown" className="ml-auto h-4 w-4 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <ul className="max-h-64 space-y-1.5 overflow-y-auto border-t border-line px-5 py-3 text-sm">
                  {summary.passed.map((p, i) => (
                    <li key={i} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-approved" />
                      <span className="min-w-0">{p.name}<span className="block text-xs text-muted">{p.location === "caption" ? "Caption" : p.location}</span></span></li>
                  ))}
                </ul>
              </details>
            )}
            {result.verified?.length > 0 && (
              <Card title={<span className="inline-flex items-center gap-2 text-approved"><Icon name="checkCircle" className="h-4 w-4" />Matches approved facts</span>} bodyClass="px-5 py-3">
                <ul className="space-y-2 text-sm">{result.verified.map((v, i) => <li key={i}>&ldquo;{v.quote}&rdquo; <span className="block text-xs text-muted">{v.location}: matches {v.fact_id}, {v.label}</span></li>)}</ul>
              </Card>
            )}
            {findings.length === 0 && (
              <div className="panel p-5 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-approved-soft text-approved"><Icon name="check" className="h-5 w-5" /></span>
                <p className="mt-3 text-sm font-medium">No issues found</p>
                <p className="mt-1 text-sm text-muted">Send it for review when you are ready.</p>
              </div>
            )}
            {(layers.length ? layers.map((L) => L.id) : Object.keys(LAYER_LABEL)).map((lid) => {
              const list = findings.filter((f) => (f.layer || "brand") === lid);
              if (!list.length) return null;
              return (
                <div key={lid} id={`layer-${lid}`} className="scroll-mt-20 space-y-3">
                  <h2 className="flex items-center gap-2 pt-2 text-sm font-semibold">
                    <Icon name={LAYER_ICON[lid] || "layers"} className="h-4 w-4 text-muted" />{LAYER_LABEL[lid]}
                    <span className="chip px-2 py-0">{list.length}</span>
                  </h2>
                  {list.map((f) => (
                    <div id={`card-${f.id}`} key={f.id} className="scroll-mt-20" data-tour="issue">
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

const PLATFORM_ICON = { instagram: "image", linkedin: "file", facebook: "message", whatsapp: "send", website: "globe" };
const LAYER_ICON = { platform: "layers", regulation: "scale", brand: "palette", facts: "facts", visual: "eye" };

/** One-line answer at the top of the results: can this be sent, and if not, why. */
function ResultVerdict({ locked, draft, blockers, warnings, inputErrors, summary }) {
  let tone, icon, title, body;
  if (locked && draft) { tone = "teal"; icon = "lock"; title = STATUS_LABEL[draft.status]; body = "This version is with the reviewer or already approved."; }
  else if (blockers) { tone = "blocker"; icon = "alertCircle"; title = `${blockers} blocker${blockers > 1 ? "s" : ""} to resolve`; body = "Fix them or keep the original with a reason before sending."; }
  else if (inputErrors) { tone = "blocker"; icon = "alertCircle"; title = "Fields to complete"; body = `${inputErrors} required field${inputErrors > 1 ? "s are" : " is"} empty.`; }
  else if (warnings) { tone = "warning"; icon = "alert"; title = "Ready, with warnings"; body = `No blockers. Decide on ${warnings} warning${warnings > 1 ? "s" : ""} before sending.`; }
  else { tone = "approved"; icon = "checkCircle"; title = "Ready for review"; body = summary.blocker + summary.warning + summary.suggestion ? "Every blocker and warning has a decision." : "No issues found by any check."; }
  const s = { blocker: "bg-blocker-soft text-blocker", warning: "bg-warning-soft text-warning", approved: "bg-approved-soft text-approved", teal: "bg-teal-soft text-teal-dark" }[tone];
  const bar = { blocker: "bg-blocker-vivid", warning: "bg-warning-vivid", approved: "bg-approved-vivid", teal: "bg-teal" }[tone];
  // The ring is the share of checks that passed: a real count from the server, never an estimate.
  const pct = summary.checks_run > 0 ? Math.round((summary.checks_passed / summary.checks_run) * 100) : null;
  return (
    <div className="relative px-5 py-5">
      <span className={`absolute inset-x-0 top-0 h-1 ${bar}`} aria-hidden />
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${s}`}><Icon name={icon} className="h-4 w-4" /></span>
          <p className="mt-2.5 text-lg font-semibold leading-snug tracking-tight">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
        </div>
        {pct !== null && <ScoreRing pct={pct} size={92} stroke={8} tone={tone === "teal" ? "accent" : tone} sub="checks passed" />}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted"><Icon name="shield" className="h-3 w-3" />Automatic checks suggest. A reviewer makes the final decision.</p>
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
  const err = errors?.length ? <p className="mt-1.5 text-xs text-blocker">{errors.join(" ")}</p> : null;
  const cls = `field ${errors?.length ? "border-blocker-vivid" : ""}`;
  const counter = spec.limit ? (
    <p className={`mt-1.5 text-right text-xs tabular-nums ${value.length > spec.limit ? "font-semibold text-warning" : "text-muted"}`}>{value.length.toLocaleString("en-IN")} / {spec.limit.toLocaleString("en-IN")}</p>
  ) : null;
  if (spec.type === "longtext" || spec.type === "lines") {
    return (
      <div>{label}
        <textarea id={id} className={`${cls} ${prominent ? "min-h-[11rem] text-base leading-7" : spec.id === "main_text" ? "min-h-[7rem] text-[15px] leading-6" : "min-h-[4.5rem]"}`}
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
        <span className="ml-1.5 font-normal text-muted">{used.length} of {spec.max}</span></p>
      {!locked && !full && (
        <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(e.dataTransfer.files || []); }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-7 text-center text-sm transition-colors ${over ? "border-teal bg-teal-soft" : "border-line-strong bg-canvas hover:border-teal hover:bg-teal-soft/40"} ${reading ? "pointer-events-none opacity-70" : ""}`}>
          <input type="file" accept={spec.accept} multiple={spec.max > 1} className="sr-only" disabled={!!reading}
            onChange={(e) => { onAdd(e.target.files || []); e.target.value = ""; }} />
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-teal-dark shadow-sm ring-1 ring-line"><Icon name={reading ? "refresh" : "upload"} className={`h-[18px] w-[18px] ${reading ? "animate-spin" : ""}`} /></span>
          <span className="mt-3 font-medium">{reading ? `Reading ${reading.kind} ${reading.n}… ${reading.pct ? `${reading.pct}%` : ""}` : <>Drop {spec.noun} files here or <span className="text-teal-dark">browse</span></>}</span>
          <span className="mt-1 max-w-sm text-xs text-muted">{spec.help}</span>
          {reading?.pct > 0 && <span className="mt-3 h-1 w-40 overflow-hidden rounded-full bg-surface"><span className="block h-full bg-teal transition-all" style={{ width: `${reading.pct}%` }} /></span>}
        </label>
      )}
      {errors?.length > 0 && <p className="mt-1.5 text-xs text-blocker">{errors.join(" ")}</p>}
      {unused > 0 && <p className="mt-2 rounded-md bg-canvas px-3 py-2 text-xs text-muted">{unused} upload{unused > 1 ? "s are" : " is"} not used by this format. {unused > 1 ? "They are" : "It is"} kept in case you switch back.</p>}
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
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap gap-4">
        {kind === "document"
          ? <div className="flex h-24 w-20 items-center justify-center rounded-md border border-line bg-blocker-soft text-xs font-semibold text-blocker">PDF</div>
          : m.preview
            ? <div className="relative"><img src={m.preview} alt={m.alt_text || `Upload ${n}`} className="h-32 w-auto max-w-[45vw] rounded-md border border-line bg-canvas object-contain sm:max-w-[14rem]" />
                {kind === "video" && <span className="absolute bottom-1.5 left-1.5 rounded bg-ink/75 px-1.5 text-xs text-white">▶ {m.duration ? `${m.duration}s` : "video"}</span>}</div>
            : <div className="flex h-32 w-32 items-center justify-center rounded-md border border-dashed border-line p-2 text-center text-xs text-muted">No preview saved</div>}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{sequence ? `${n} of ${total}` : kind.charAt(0).toUpperCase() + kind.slice(1)}: <span className="break-all font-normal text-muted">{m.file_name}</span></p>
          {kind === "document" ? (
            <p className="mt-1 text-muted">{m.pages ? `${m.pages} pages. ` : ""}{m.note || "Its text is checked like the post text."}</p>
          ) : (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {m.width && <><dt className="text-muted">Size</dt><dd>{m.width}×{m.height}{kind === "video" ? ", one frame read" : ""}</dd></>}
              <dt className="text-muted">Brand colours</dt>
              <dd className="flex flex-wrap items-center gap-1.5">{share}{(m.palette || []).map((c) => <span key={c.hex} title={`${c.hex}, ${Math.round(c.share * 100)}%`} className="inline-block h-3 w-5 rounded-sm ring-1 ring-line" style={{ background: c.hex }} />)}</dd>
              <dt className="text-muted">Logo</dt><dd>{logo}</dd>
              <dt className="text-muted">Lowest contrast</dt>
              <dd>{m.contrast_min ? `${m.contrast_min}:1` : "Not measured"}{m.ocr_confidence != null && <span className="text-muted">, read with {m.ocr_confidence}% confidence</span>}</dd>
            </dl>
          )}
          {!locked && (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {sequence && <><button className="btn btn-quiet btn-sm" disabled={n === 1} onClick={() => onMove(-1)}>Move up</button>
                <button className="btn btn-quiet btn-sm" disabled={n === total} onClick={() => onMove(1)}>Move down</button></>}
              <button className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button>
            </p>
          )}
        </div>
      </div>
      <div className={`mt-4 grid gap-4 ${kind === "image" ? "sm:grid-cols-2" : ""}`}>
        <div>
          <label className="label" htmlFor={`txt-${n}`}>{kind === "document" ? "Text read from the PDF" : kind === "video" ? "Text read from the frame" : "Text read from the image"}</label>
          <textarea id={`txt-${n}`} className="field min-h-[4rem]" value={m.text || ""} disabled={locked} maxLength={20000}
            onChange={(e) => onChange({ text: e.target.value })} placeholder="No text found. Type what it says." />
          <p className="mt-1.5 text-xs text-muted">Correct any misread words before checking.</p>
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
    <div className="text-sm">
      <p className="font-semibold">Create once, adapt everywhere</p>
      <p className="mt-1 text-muted">Pick destinations. Each gets its own linked draft with the same wording and approved claims, restructured for that platform
        (fields moved, hashtags and media kept where the format allows). Wording is not rewritten by AI. Each version is checked on its own and needs its own review.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {cfg.platforms.map((p) => (
          <label key={p.id} className={`flex items-center gap-3 rounded-md border px-3 py-2 ${pick[p.id] ? "border-teal bg-teal-soft/50" : "border-line"}`}>
            <input type="checkbox" className="h-4 w-4 accent-teal" aria-label={`Adapt for ${p.label}`} checked={!!pick[p.id]} onChange={(e) => setPick((c) => ({ ...c, [p.id]: e.target.checked ? (p.id === current.platform ? p.formats.find((f) => f.id !== current.format)?.id : p.formats[0].id) : null }))} />
            <span className="w-24 font-medium">{p.label}</span>
            <select className="field py-1" disabled={!pick[p.id]} value={pick[p.id] || ""} onChange={(e) => setPick((c) => ({ ...c, [p.id]: e.target.value }))}>
              {!pick[p.id] && <option value="">Format</option>}
              {p.formats.filter((f) => !(p.id === current.platform && f.id === current.format)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button className="btn btn-primary mt-4" disabled={busy || targets.length === 0} onClick={go}>{busy ? "Creating versions…" : `Create ${targets.length || ""} version${targets.length === 1 ? "" : "s"}`}</button>
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
      {out && (
        <ul className="mt-4 space-y-2">
          {out.created.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md bg-canvas px-3 py-2">
              <span className="font-medium">{c.channel}</span>
              <span className="text-xs text-muted">{c.summary.blocker} blockers, {c.summary.warning} warnings{c.input_errors.length ? `, ${c.input_errors.length} fields to complete` : ""}</span>
              <Link href={`/?draft=${c.id}`} className="link ml-auto">Open</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Count({ n, label, tone }) {
  const s = { blocker: ["text-blocker", "bg-blocker-vivid"], warning: ["text-warning", "bg-warning-vivid"], suggestion: ["text-suggestion", "bg-suggestion-vivid"] }[tone];
  return (
    <div className="border-r border-line px-4 py-3 last:border-r-0">
      <p className={`text-2xl font-semibold tabular-nums tracking-tight ${n ? s[0] : "text-faint"}`}>{n}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><span className={`dot h-1.5 w-1.5 ${n ? s[1] : "bg-line"}`} />{label}</p>
    </div>
  );
}

function summarise(findings) {
  const c = { blocker: 0, warning: 0, suggestion: 0 };
  findings.forEach((f) => { c[f.severity] += 1; });
  return { ...c, sensitive: findings.some((f) => f.sensitive) };
}
