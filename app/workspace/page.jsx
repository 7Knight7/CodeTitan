"use client";
import { useCallback, useEffect, useState } from "react";
import { api, draftsChanged, when } from "@/lib/api";
import BrandMemory from "@/components/BrandMemory";
import { useTour } from "@/components/Tour";
import Icon from "@/components/Icon";
import { SeverityTag } from "@/components/IssueCard";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";

const LISTS = [
  ["banned_phrases", "Words and claims not to use", "text"],
  ["wrong_names", "Wrong versions of the brand name", "text"],
  ["required_text", "Text every image must include", "text"],
  ["keywords", "What the brand talks about (products, services, topics, hashtags). Posts with none of these are flagged as not for this brand", "text"],
  ["tone_rules", "Tone rules", "text"],
  ["sensitive_topics", "Sensitive topics (need the marketing head)", "text"],
  ["guidelines", "Other guidelines", "text"],
];

const emptyKit = () => ({ brand_name: { text: "" }, colours: [], fonts: [], facts: [], logo_required: { value: false },
  banned_phrases: [], wrong_names: [], required_text: [], keywords: [], tone_rules: [], sensitive_topics: [], guidelines: [] });

export default function WorkspacePage() {
  const [ws, setWs] = useState(null);
  const [kitInfo, setKitInfo] = useState(null);
  const [mode, setMode] = useState("view"); // "view" | "setup" (new kit) | "update" (revise the live kit)
  const [kit, setKit] = useState(null); // the kit being edited
  const [fileName, setFileName] = useState(null); // PDF uploaded in this session, if any
  const [logo, setLogo] = useState(null);
  const [newLogo, setNewLogo] = useState(false);
  const [diff, setDiff] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: "reset" | "activate" | "demo" }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [w, k] = await Promise.all([api("/workspace"), api("/brandkit")]);
    setWs(w); setKitInfo(k); setLogo(w.meta?.logo || null); setNewLogo(false);
    if (!w.live && k.draft?.kit) { setKit(k.draft.kit); setFileName(k.draft.file_name); setMode("setup"); }
    return w;
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // Links such as /workspace#facts point at sections that only exist once the data has loaded.
  const loaded = !!ws;
  useTour("workspace", loaded && !ws.empty && !(kit && (mode === "setup" || mode === "update")) && !window.location.hash);
  useEffect(() => {
    if (!loaded || !window.location.hash) return;
    const t = setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(t);
  }, [loaded]);

  // After a PDF is read, bring the review editor into view so it is obvious what to do next.
  useEffect(() => {
    if (!fileName || !kit) return;
    const t = setTimeout(() => document.getElementById("kit-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => clearTimeout(t);
  }, [fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => { setError(""); setNotice(""); };

  async function uploadPdf(file) {
    if (!file) return;
    clear();
    if (file.size > 3 * 1024 * 1024) { setError("The PDF is larger than 3 MB. Export it again with compressed images."); return; }
    setBusy("Reading the brand kit…");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      const draft = await api("/brandkit/parse", { method: "POST", body: { file_name: file.name, data_b64: b64 } });
      setKit(draft.kit); setFileName(draft.file_name); setDiff(null);
      setNotice(`${draft.status.message} Review everything below, then ${mode === "update" ? "preview the changes" : "activate"}.`);
      if (mode === "view") setMode("setup");
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  function uploadLogo(file) {
    if (!file) return;
    if (file.size > 280 * 1024) { setError("Use a logo file under 280 KB (PNG with a transparent background works best)."); return; }
    const r = new FileReader();
    r.onload = () => { setLogo(String(r.result)); setNewLogo(true); setDiff(null); };
    r.readAsDataURL(file);
  }

  function startUpdate() {
    clear(); setDiff(null); setFileName(null);
    setKit(structuredClone(kitInfo?.live_kit || emptyKit()));
    setMode("update");
  }

  async function activate(confirmReset) {
    setBusy("Activating…"); clear(); setDialog(null);
    try {
      const r = await api("/brandkit/activate", { method: "POST", body: { kit, logo_data_url: logo || null, file_name: fileName, confirm_reset: confirmReset } });
      setNotice(`Brand kit for ${r.meta.name} is live: ${r.counts.rules} rules, ${r.counts.facts} facts, ${r.counts.guidelines} guidelines. Write and Review start empty; earlier posts are in All history.`);
      setMode("view"); setKit(null); await load(); draftsChanged();
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  async function previewUpdate() {
    setBusy("Comparing with the live kit…"); clear();
    try {
      const r = await api("/brandkit/update", { method: "POST", body: { kit, logo_data_url: newLogo ? logo : null, file_name: fileName } });
      setDiff(r.changes);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  async function applyUpdate() {
    setBusy("Applying the update…"); clear();
    try {
      const r = await api("/brandkit/update", { method: "POST", body: { kit, logo_data_url: newLogo ? logo : null, file_name: fileName, apply: true } });
      setNotice(`Revision ${r.revision} is live. ${r.changes.length} area${r.changes.length === 1 ? "" : "s"} changed; ${r.rechecked} open post${r.rechecked === 1 ? " was" : "s were"} checked again. Approved posts keep the record they were approved on.`);
      setMode("view"); setKit(null); setDiff(null); await load(); draftsChanged();
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  async function resetKit() {
    setBusy("Resetting…"); clear(); setDialog(null);
    try {
      await api("/brandkit/reset", { method: "POST", body: { confirm: ws.meta.name } });
      setKit(null); setFileName(null); setDiff(null); setMode("view");
      await load(); draftsChanged();
      setNotice("The brand kit was removed and its posts moved to history (All history in Analytics and Insights). Upload the new brand kit to start again.");
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  async function loadDemo() {
    clear(); setDialog(null);
    try { await api("/reset", { method: "POST" }); setKit(null); setMode("view"); await load(); draftsChanged(); setNotice("Demo brand restored. Everything is back to how it was at the start."); } catch (e) { setError(e.message); }
  }

  // One click for the demo: read the bundled sample brand-kit PDF through the normal upload.
  async function readSamplePdf() {
    clear();
    try {
      const r = await fetch("/samples/sunrise-brand-kit.pdf");
      if (!r.ok) throw new Error();
      const b = await r.blob();
      await uploadPdf(new File([b], "sunrise-brand-kit.pdf", { type: "application/pdf" }));
    } catch { setError("The sample PDF could not be loaded. Upload your own brand kit PDF instead."); }
  }

  if (!ws) return error ? <Notice tone="error" role="alert">{error}</Notice> : <div className="space-y-4"><div className="skeleton h-8 w-56" /><div className="skeleton h-28 w-full" /><div className="skeleton h-48 w-full" /></div>;
  const canEdit = ws.can_edit;
  const set = (key, value) => { setKit((k) => ({ ...k, [key]: value })); setDiff(null); };
  const editing = canEdit && kit && (mode === "setup" || mode === "update");

  const sevOrder = { blocker: 0, warning: 1, suggestion: 2 };
  const rules = [...ws.rules].sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));
  const guideSections = ws.guidelines.reduce((m, g) => { (m[g.section] ||= []).push(g); return m; }, {});
  const fonts = ws.meta.fonts || [];

  return (
    <div className="space-y-6">
      <PageHeader title="Brand guidelines"
        sub="One brand at a time. Upload the brand's guideline PDF, confirm what the app found, and every check uses it from then on."
        actions={ws.live && canEdit && mode !== "update" && (
          <>
            <button className="btn btn-primary" disabled={!!busy} onClick={startUpdate}>Update brand kit</button>
            <button className="btn btn-danger" disabled={!!busy} onClick={() => setDialog({ kind: "reset" })}><WarningIcon /> Reset brand kit</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => setDialog({ kind: "demo" })}><Icon name="refresh" className="h-4 w-4" />Restore the demo brand</button>
          </>
        )} />
      {!canEdit && <Notice tone="info"><Icon name="lock" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" /> Read only. Only the marketing head can upload, update or reset the brand kit; switch to Meera from the account menu.</Notice>}
      {error && <Notice tone="error" role="alert">{error}</Notice>}
      {notice && <Notice tone="success" role="status">{notice}</Notice>}

      {/* Brand identity */}
      <section className="panel overflow-hidden" data-tour="identity">
        <div className="flex flex-wrap items-center gap-5 p-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-canvas ring-1 ring-line">
            {ws.meta.logo ? <img src={ws.meta.logo} alt="Brand logo" className="max-h-12 max-w-[3.5rem] object-contain" /> : <span className="text-xl font-semibold text-muted">{(ws.meta.name || "?").charAt(0)}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{ws.meta.name}</h2>
              <span className={`chip ${ws.empty ? "text-warning" : "text-teal-dark"}`}><span className={`dot ${ws.empty ? "bg-warning-vivid" : "bg-teal"}`} />{ws.empty ? "No kit live" : ws.live ? "Live" : "Ready to use"}</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {ws.live
                ? <>From {ws.meta.kit_file || "the uploaded PDF"}, revision {ws.meta.revision || 1}, activated {when(ws.meta.activated_at)}{ws.meta.updated_at && ws.meta.updated_at !== ws.meta.activated_at ? `, last updated ${when(ws.meta.updated_at)}` : ""}</>
                : ws.empty ? "Upload a brand kit to start checking posts." : "Sample brand kit, already loaded: every check uses these rules, facts and guidelines. Nothing to import. All data is fictional."}
            </p>
          </div>
          <dl className="flex gap-6 text-sm">
            <div><dt className="text-xs text-muted">Posts</dt><dd className="text-lg font-semibold tabular-nums">{ws.post_count}</dd></div>
            {!ws.empty && <div><dt className="text-xs text-muted">Rules</dt><dd className="text-lg font-semibold tabular-nums">{ws.rules.length}</dd></div>}
            {!ws.empty && <div><dt className="text-xs text-muted">Facts</dt><dd className="text-lg font-semibold tabular-nums">{ws.facts.length}</dd></div>}
          </dl>
        </div>
        {ws.live && canEdit && (
          <ul className="grid gap-px border-t border-line bg-line text-sm sm:grid-cols-2">
            <li className="bg-surface px-5 py-3"><span className="font-medium">Update</span><span className="text-muted">: edit this kit or upload a revised PDF of the same brand. Posts, reviews and insights are kept; open posts are checked again.</span></li>
            <li className="bg-surface px-5 py-3"><span className="font-medium text-blocker">Reset</span><span className="text-muted">: for a different brand. Removes this kit and clears Write and Review for everyone; this brand&rsquo;s posts stay as read-only history in Analytics and Insights.</span></li>
          </ul>
        )}
      </section>

      {ws.empty && (
        <Notice tone="warning">
          No brand kit is live{ws.meta.reset_from ? ` (the ${ws.meta.reset_from} kit was reset ${when(ws.meta.reset_at)})` : ""}. Creators can&rsquo;t check posts until the marketing head uploads and activates a new one. Indian ad regulations stay on.
        </Notice>
      )}

      {canEdit && (!ws.live || mode === "update") && (
        <section id="import" className="scroll-mt-20" data-tour="import">
        <Card title={mode === "update" ? "Upload a revised PDF (optional)" : !ws.live && !ws.empty ? "Try importing a brand kit (optional)" : "Upload the brand kit"}
          sub={mode === "update" ? "Use this when the brand published a new version of its guidelines. It replaces the editor below; you can also just edit the live kit there."
            : !ws.live && !ws.empty ? "The sample brand is already loaded, so this step isn't needed. To see how importing works, read the sample PDF in one click, or upload your own."
            : "The app reads the PDF, then you confirm every item before it goes live."}>
          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              {!ws.live && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-teal/40 bg-teal-soft/50 p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface text-teal-dark ring-1 ring-line"><Icon name="file" className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">Sample brand-kit PDF</p>
                    <p className="text-xs text-muted">Sunrise Tutorials, a fictional tuition brand. You review what the app read before anything goes live.</p>
                  </div>
                  <button className="btn btn-teal btn-sm" disabled={!!busy} onClick={readSamplePdf}>Read the sample PDF</button>
                </div>
              )}
              {!ws.live && !ws.empty && ws.post_count > 0 && <Notice tone="warning" className="mb-3">Activating another brand kit moves the sample posts to history. You can bring the sample brand back any time with &ldquo;Restore the demo brand&rdquo;.</Notice>}
              <label className={`flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-line-strong bg-canvas px-4 py-8 text-center text-sm transition-colors hover:border-teal hover:bg-teal-soft/40 ${busy ? "pointer-events-none opacity-70" : ""}`}>
                <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => { uploadPdf(e.target.files?.[0]); e.target.value = ""; }} />
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-teal-dark shadow-sm ring-1 ring-line"><Icon name={busy ? "refresh" : "upload"} className={`h-[18px] w-[18px] ${busy ? "animate-spin" : ""}`} /></span>
                <span className="mt-3 font-medium">{busy || <>Drop the brand guideline PDF or <span className="text-teal-dark">browse</span></>}</span>
                <span className="mt-1 text-xs text-muted">PDF with real text, up to 3 MB. {kitInfo?.ai_reader ? "Read with AI and the pattern reader." : "Read with the pattern reader (AI reading is off)."}</span>
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-canvas ring-1 ring-line">
                  {logo ? <img src={logo} alt="Brand logo" className="max-h-10 max-w-[2.75rem] object-contain" /> : <Icon name="image" className="h-5 w-5 text-muted" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Logo</p>
                  <p className="text-xs text-muted">{mode === "update" ? "Upload only to replace it." : "Optional, used to check images."} PNG with a transparent background works best.</p>
                </div>
                <label className="btn btn-quiet btn-sm cursor-pointer">
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="sr-only" onChange={(e) => uploadLogo(e.target.files?.[0])} />
                  {logo ? "Replace" : "Upload logo"}
                </label>
              </div>
              {!ws.live && <button className="btn btn-ghost btn-sm mt-3" onClick={() => setDialog({ kind: "demo" })}><Icon name="refresh" className="h-3.5 w-3.5" />Restore the demo brand and start over</button>}
            </div>
            <div className="rounded-lg bg-canvas p-4 text-sm">
              <h3 className="font-semibold">What a good brand kit PDF contains</h3>
              <ul className="mt-3 space-y-2 text-muted">
                {["Exported from Word, Google Docs or Canva so it has real text, not a scan", "The official brand name, and wrong versions not to use",
                  "Colours with HEX codes, for example “Primary: Navy #1F3A68”", "Font names, and whether the logo must appear on every post",
                  "Text every image must carry (website, phone, disclaimers)", "Words and claims not to use, as a list under a heading like “Words we don’t use:”",
                  "Prices, offers and results with amounts and dates as YYYY-MM-DD", "Tone rules and sensitive topics"].map((x) => (
                  <li key={x} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
        </section>
      )}

      {editing && (
        <section id="kit-review" className="panel scroll-mt-20">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold">{mode === "update" ? `Edit the live brand kit (revision ${(ws.meta.revision || 1) + 1})` : "Review before activating"}</h2>
            <p className="mt-0.5 text-sm text-muted">{fileName ? `${fileName}. ` : ""}Each item shows the page and words it came from. Edit or remove anything wrong.</p>
          </div>
          <div className="space-y-8 p-5">
            <EditGroup title="Brand identity" icon="brand">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="bname">Brand name</label>
                  <input id="bname" className="field" value={kit.brand_name?.text || ""} onChange={(e) => set("brand_name", { ...(kit.brand_name || {}), text: e.target.value })} />
                  {kit.brand_name?.quote && <Src item={kit.brand_name} />}
                </div>
                <label className="flex items-center gap-2.5 self-end rounded-md border border-line px-3 py-2.5 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-teal" checked={!!kit.logo_required?.value} onChange={(e) => set("logo_required", { ...(kit.logo_required || {}), value: e.target.checked })} />
                  Logo must appear on every image
                </label>
              </div>
            </EditGroup>

            <EditGroup title="Brand colours" icon="palette">
              <ul className="grid gap-3 sm:grid-cols-2">
                {(kit.colours || []).map((c, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
                    <span className="h-14 w-14 shrink-0 rounded-md ring-1 ring-inset ring-black/10" style={{ background: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent" }} />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <input className="field py-1" value={c.name} onChange={(e) => set("colours", kit.colours.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Colour name" />
                      <div className="flex gap-2">
                        <input className="field py-1 font-mono text-xs uppercase" value={c.hex} onChange={(e) => set("colours", kit.colours.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} aria-label="HEX code" />
                        <button className="btn btn-ghost btn-sm text-blocker" onClick={() => set("colours", kit.colours.filter((_, j) => j !== i))} aria-label={`Remove ${c.name}`}><Icon name="x" className="h-3.5 w-3.5" /></button>
                      </div>
                      <Src item={c} />
                    </div>
                  </li>
                ))}
                <li>
                  <button className="flex h-full min-h-[5.5rem] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-sm text-muted transition-colors hover:border-teal hover:text-teal-dark"
                    onClick={() => set("colours", [...(kit.colours || []), { name: "New colour", hex: "#000000" }])}><Icon name="plus" className="h-4 w-4" />Add colour</button>
                </li>
              </ul>
            </EditGroup>

            {(kit.fonts || []).length > 0 && (
              <EditGroup title="Typography" icon="type">
                <FontList names={kit.fonts.map((f) => f.name)} />
              </EditGroup>
            )}

            <EditGroup title="Voice, terminology and topics" icon="message">
              <div className="grid gap-6 xl:grid-cols-2">
                {LISTS.map(([key, label]) => (
                  <ItemList key={key} label={label} items={kit[key] || []} onChange={(v) => set(key, v)} />
                ))}
              </div>
            </EditGroup>

            <EditGroup title="Approved facts" icon="facts">
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="bg-canvas text-left text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Type</th><th className="px-3 font-medium">Label</th><th className="px-3 font-medium">Value</th><th className="px-3 font-medium">Valid from</th><th className="px-3 font-medium">Valid until</th><th /></tr></thead>
                  <tbody>
                    {(kit.facts || []).map((f, i) => {
                      const upd = (patch) => set("facts", kit.facts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      return (
                        <tr key={i} className="border-t border-line align-top">
                          <td className="px-3 py-2"><select className="field py-1" value={f.kind} onChange={(e) => upd({ kind: e.target.value })}><option value="fee">Fee</option><option value="offer">Offer</option><option value="result">Result</option></select></td>
                          <td className="px-3 py-2"><input className="field py-1" value={f.label} onChange={(e) => upd({ label: e.target.value })} /><Src item={f} /></td>
                          <td className="px-3 py-2">{f.kind === "fee" && <input type="number" className="field w-28 py-1" value={f.amount ?? ""} onChange={(e) => upd({ amount: Number(e.target.value) })} aria-label="Amount" />}
                            {f.kind === "offer" && <input type="number" className="field w-20 py-1" value={f.percent ?? ""} onChange={(e) => upd({ percent: Number(e.target.value) })} aria-label="Percent" />}
                            {f.kind === "result" && <span className="flex gap-1"><input type="number" className="field w-20 py-1" value={f.full_course ?? ""} onChange={(e) => upd({ full_course: Number(e.target.value) })} aria-label="Paid full course" /><input type="number" className="field w-20 py-1" value={f.interview_guidance ?? ""} onChange={(e) => upd({ interview_guidance: Number(e.target.value) })} aria-label="Free programme" /></span>}</td>
                          <td className="px-3 py-2"><input type="date" className="field py-1" value={f.valid_from || ""} onChange={(e) => upd({ valid_from: e.target.value })} /></td>
                          <td className="px-3 py-2"><input type="date" className="field py-1" value={f.valid_until || ""} onChange={(e) => upd({ valid_until: e.target.value })} /></td>
                          <td className="px-3 py-2"><button className="btn btn-ghost btn-sm text-blocker" onClick={() => set("facts", kit.facts.filter((_, j) => j !== i))}>Remove</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-quiet btn-sm mt-3" onClick={() => set("facts", [...(kit.facts || []), { kind: "fee", label: "New fee", amount: 0, valid_from: "", valid_until: "" }])}><Icon name="plus" className="h-3.5 w-3.5" />Add fact</button>
            </EditGroup>

            {mode === "update" && diff && (
              <div className="rounded-lg border border-line bg-canvas p-4">
                <h3 className="font-semibold">What will change</h3>
                {diff.length === 0
                  ? <p className="mt-1 text-sm text-muted">Nothing is different from the live kit.</p>
                  : (
                    <ul className="mt-3 space-y-3 text-sm">
                      {diff.map((c) => (
                        <li key={c.area}>
                          <p className="font-medium">{c.area}</p>
                          <ul className="mt-1 space-y-0.5 font-mono text-xs">
                            {c.added.map((x) => <li key={`a${x}`} className="rounded bg-approved-soft px-2 py-0.5 text-approved">+ {x}</li>)}
                            {c.removed.map((x) => <li key={`r${x}`} className="rounded bg-blocker-soft px-2 py-0.5 text-blocker">&minus; {x}</li>)}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                <p className="mt-3 text-xs text-muted">Posts, reviews and insights are kept. Rules that didn&rsquo;t change keep their ids. Posts not yet approved are checked again against the new version.</p>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-b-lg border-t border-line bg-white/95 px-5 py-4 backdrop-blur">
            {mode === "setup" && (
              <button className="btn btn-teal" disabled={!!busy} onClick={() => (ws.post_count > 0 ? setDialog({ kind: "activate" }) : activate(false))}>Activate brand kit</button>
            )}
            {mode === "update" && (
              <>
                <button className="btn btn-quiet" disabled={!!busy} onClick={previewUpdate}>Preview changes</button>
                <button className="btn btn-teal" disabled={!!busy || !diff || diff.length === 0} onClick={applyUpdate}>Apply update</button>
                <button className="btn btn-ghost" disabled={!!busy} onClick={() => { setMode("view"); setKit(null); setDiff(null); setLogo(ws.meta.logo || null); setNewLogo(false); clear(); }}>Cancel</button>
              </>
            )}
            <span className="text-xs text-muted">{mode === "update" && !diff ? "Preview the changes first. " : ""}Indian ad rules (ASCI, CCPA, health claims, #ad disclosure) always stay on.</span>
          </div>
        </section>
      )}

      {!ws.empty && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={<SectionTitle icon="palette">Brand colours</SectionTitle>} sub="Images are checked for how much of these colours they use">
              {ws.meta.brand_colours.length === 0 ? <p className="text-sm text-muted">No colours in the kit.</p> : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {ws.meta.brand_colours.map((c) => (
                    <li key={c.hex} className="overflow-hidden rounded-lg border border-line">
                      <span className="block h-14" style={{ background: c.hex }} />
                      <span className="block px-3 py-2"><span className="block truncate text-sm font-medium">{c.name}</span><span className="font-mono text-xs uppercase text-muted">{c.hex}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={<SectionTitle icon="brand">Logo and required text</SectionTitle>} sub="Checked on every image">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg bg-canvas ring-1 ring-line">
                  {ws.meta.logo ? <img src={ws.meta.logo} alt="Brand logo" className="max-h-14 max-w-[6rem] object-contain" /> : <span className="text-xs text-muted">No logo</span>}
                </div>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">Required on every image</p>
                  {ws.meta.required_text?.length > 0
                    ? <ul className="mt-1 space-y-1 text-muted">{ws.meta.required_text.map((r) => <li key={r} className="flex gap-2"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-dark" />{r}</li>)}</ul>
                    : <p className="mt-1 text-muted">Nothing required.</p>}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={<SectionTitle icon="type">Typography</SectionTitle>} sub="Shown for reference; fonts inside images can't be checked yet">
              {fonts.length ? <FontList names={fonts} /> : <p className="text-sm text-muted">No fonts named in the brand kit.</p>}
            </Card>
            <Card title={<SectionTitle icon="message">What the brand talks about</SectionTitle>} sub="Posts with none of these are flagged as not for this brand">
              {ws.meta.keywords?.length > 0
                ? <div className="flex flex-wrap gap-1.5">{ws.meta.keywords.map((k) => <span key={k} className="chip text-ink">{k}</span>)}</div>
                : <p className="text-sm text-muted">None yet. Add a few (Update brand kit) so posts about other things are flagged as not for this brand.</p>}
            </Card>
          </div>

          <section id="facts" className="panel scroll-mt-20" data-tour="facts">
            <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-3.5">
              <div>
                <h2 className="section-title"><SectionTitle icon="facts">Approved facts</SectionTitle></h2>
                <p className="mt-0.5 text-xs text-muted">Prices, offers and results in posts are compared with these. Checked against today&rsquo;s date, {ws.today}.</p>
              </div>
              {canEdit && ws.live && mode !== "update" && <button className="btn btn-quiet btn-sm ml-auto" onClick={startUpdate}>Edit facts</button>}
            </div>
            {ws.facts.length === 0 ? <EmptyState icon="facts" title="No approved facts" body="Add fees, offers and results to the brand kit so claims in posts can be verified." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="px-5 py-2.5 font-medium">Fact</th><th className="px-3 font-medium">Value</th><th className="px-3 font-medium">Valid</th><th className="px-5 font-medium">Status</th></tr></thead>
                  <tbody>
                    {ws.facts.map((f) => (
                      <tr key={f.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-3"><span className="mr-2 rounded bg-canvas px-1.5 py-0.5 font-mono text-2xs text-muted ring-1 ring-line">{f.id}</span>{f.label}</td>
                        <td className="whitespace-nowrap px-3 py-3 font-medium tabular-nums">{f.kind === "fee" ? `Rs ${f.amount?.toLocaleString("en-IN")}` : f.kind === "offer" ? `${f.percent}% off` : `${f.total} (${f.full_course} paid, ${f.interview_guidance} free)`}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">{f.valid_from || "…"} to {f.valid_until || "…"}</td>
                        <td className="px-5 py-3"><FactStatus status={f.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card title={<SectionTitle icon="shield">Rules</SectionTitle>} sub={`${ws.rules.length} rules run on every post, including Indian ad regulations`} bodyClass="p-0">
              <ul className="divide-y divide-line text-sm">{rules.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                  {["blocker", "warning", "suggestion"].includes(r.severity) ? <SeverityTag severity={r.severity} /> : <span className="chip">{r.severity}</span>}
                  <span className="min-w-0"><span className="font-medium">{r.name}</span><span className="mt-0.5 block text-xs text-muted">{r.sources.join("; ")}</span></span>
                </li>))}</ul>
            </Card>
            <Card title={<SectionTitle icon="message">Voice, tone and guidelines</SectionTitle>} sub="Written guidance from the brand kit">
              {Object.keys(guideSections).length === 0 ? <p className="text-sm text-muted">No written guidelines.</p> : (
                <div className="space-y-4">
                  {Object.entries(guideSections).map(([section, items]) => (
                    <div key={section}>
                      <p className="text-xs font-medium text-muted">{section}</p>
                      <ul className="mt-1.5 space-y-1.5 text-sm">{items.map((g) => <li key={g.id} className="border-l-2 border-teal/40 pl-3">{g.text}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {!ws.empty && <BrandMemory canEdit={canEdit} />}

      <Card title={<SectionTitle icon="lock">Privacy</SectionTitle>}>
        <ul className="grid gap-3 text-sm text-muted sm:grid-cols-2">
          <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />Post images are read in the browser; only the read text, measurements and a small preview for the reviewer are sent.</li>
          <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />Post checks use fixed rules and approved facts only; no AI judges posts.</li>
          <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />{kitInfo?.ai_reader ? "Brand kit PDFs are read with an AI service; every extracted item must quote the PDF and is confirmed by the marketing head." : "Brand kit PDFs are read on our server without AI."}</li>
          <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />{ws.password_required ? "Sign-in uses a hashed password and a signed, HttpOnly session" : "Demo sign-in: no password, but every visitor gets a signed, HttpOnly session"}; roles are enforced by the server.</li>
        </ul>
      </Card>

      {dialog?.kind === "reset" && (
        <DangerDialog title={`Reset the ${ws.meta.name} brand kit?`} confirmWord={ws.meta.name} action="Reset brand kit"
          onCancel={() => setDialog(null)} onConfirm={resetKit}
          intro="This will:"
          items={[
            "Delete the brand kit: colours, logo, banned words, required text, facts and guidelines",
            `Move all ${ws.post_count} post${ws.post_count === 1 ? "" : "s"} out of Write and Review into read-only history`,
            `Keep their versions, reviews and audit trail, shown under ${ws.meta.name} in All history (Analytics and Insights)`,
          ]}
          note="This affects everyone and the kit can't be restored. Indian ad regulations stay on. After the reset, upload the new brand kit; creators can't check posts until it is active." />
      )}
      {dialog?.kind === "activate" && (
        <DangerDialog title="Start this brand from zero?" confirmWord={ws.meta.name} action="Activate"
          onCancel={() => setDialog(null)} onConfirm={() => activate(true)}
          intro="This will:"
          items={[`Move all ${ws.post_count} existing posts, including sample posts, into read-only history`, `Keep them under ${ws.meta.name} in All history (Analytics and Insights)`]}
          note="The new brand kit starts with an empty Write and Review." />
      )}
      {dialog?.kind === "demo" && (
        <DangerDialog title="Restore the demo brand?" confirmWord="demo" action="Restore demo"
          onCancel={() => setDialog(null)} onConfirm={loadDemo}
          items={["Any brand kit you imported or started", "All posts, reviews and insights you created"]}
          note="Puts the app back exactly as it was at the start: the fictional Northstar Civils Academy brand kit and its sample posts. This cannot be undone." />
      )}
    </div>
  );
}

function SectionTitle({ icon, children }) {
  return <span className="inline-flex items-center gap-2"><Icon name={icon} className="h-4 w-4 text-muted" />{children}</span>;
}

function EditGroup({ title, icon, children }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon name={icon} className="h-4 w-4 text-muted" />{title}</h3>
      {children}
    </div>
  );
}

function FontList({ names }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {names.map((n) => (
        <li key={n} className="flex items-center gap-3 rounded-lg border border-line p-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-canvas text-xl ring-1 ring-line" style={{ fontFamily: `"${n}", Inter, sans-serif` }} aria-hidden>Aa</span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{n}</span><span className="block truncate text-xs text-muted" style={{ fontFamily: `"${n}", Inter, sans-serif` }}>The quick brown fox</span></span>
        </li>
      ))}
    </ul>
  );
}

function FactStatus({ status }) {
  const s = { current: "bg-approved-soft text-approved ring-approved-vivid/25", expired: "bg-blocker-soft text-blocker ring-blocker-vivid/30" }[status] || "bg-warning-soft text-warning ring-warning-vivid/35";
  const label = { current: "Current", expired: "Expired" }[status] || "Not yet valid";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s}`}>{label}</span>;
}

function WarningIcon() {
  return <Icon name="alert" className="h-4 w-4" />;
}

/** Warning dialog for actions that delete everything: lists what goes, and needs a word typed to confirm. */
function DangerDialog({ title, items, note, confirmWord, action, onCancel, onConfirm, intro = "This will permanently delete:" }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toLowerCase() === String(confirmWord).trim().toLowerCase();
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4 backdrop-blur-[2px]" role="presentation" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="danger-title" className="pop-in w-full max-w-md overflow-hidden rounded-lg bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blocker-soft text-blocker"><WarningIcon /></span>
          <h2 id="danger-title" className="mt-4 text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-muted">{intro}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul>
          <Notice tone="error" className="mt-4">{note}</Notice>
          <label className="label mt-4" htmlFor="danger-confirm">Type <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs">{confirmWord}</span> to confirm</label>
          <input id="danger-confirm" className="field" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
          <button className="btn btn-quiet" onClick={onCancel}>Cancel</button>
          <button className="btn bg-blocker-vivid text-white hover:opacity-90" disabled={!ok} onClick={onConfirm}>{action}</button>
        </div>
      </div>
    </div>
  );
}

function Src({ item }) {
  if (!item?.quote) return null;
  return <span className="mt-1 block text-xs text-muted" title={item.quote}>From {item.page ? `page ${item.page}` : "the PDF"} ({item.reader === "AI" ? "AI" : "pattern"}): &ldquo;{item.quote.slice(0, 70)}{item.quote.length > 70 ? "…" : ""}&rdquo;</span>;
}

function ItemList({ label, items, onChange }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-sm font-medium">{label}</p>
      {items.length === 0 && <p className="mt-2 text-sm text-muted">Nothing found.</p>}
      <ul className="mt-2 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="text-sm">
            <div className="flex items-center gap-2">
              <input className="field min-w-0 flex-1 py-1" value={it.text || ""} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={label} />
              <button className="btn btn-ghost btn-sm text-blocker" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" className="h-3.5 w-3.5" /></button>
            </div>
            <Src item={it} />
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input className="field min-w-0 flex-1 py-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add another" aria-label={`Add to ${label}`} />
        <button className="btn btn-quiet btn-sm" disabled={!draft.trim()} onClick={() => { onChange([...items, { text: draft.trim() }]); setDraft(""); }}>Add</button>
      </div>
    </div>
  );
}
