"use client";
import { useCallback, useEffect, useState } from "react";
import { api, draftsChanged, when } from "@/lib/api";

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
    try { await api("/reset", { method: "POST" }); setKit(null); setMode("view"); await load(); draftsChanged(); setNotice("Demo brand loaded."); } catch (e) { setError(e.message); }
  }

  if (!ws) return <p className="text-muted">{error || "Loading…"}</p>;
  const canEdit = ws.can_edit;
  const set = (key, value) => { setKit((k) => ({ ...k, [key]: value })); setDiff(null); };
  const editing = canEdit && kit && (mode === "setup" || mode === "update");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-proof text-2xl font-semibold">Brand workspace: {ws.meta.name}</h1>
        <p className="mt-1 max-w-prose text-muted">One brand at a time. Upload the brand&rsquo;s guideline PDF, confirm what the app found, and every check uses it from then on.</p>
      </div>
      {!canEdit && <p className="rounded-md bg-canvas px-4 py-3 text-sm text-muted">Read only. Only the marketing head can upload, update or reset the brand kit; switch to Meera in the header.</p>}
      {error && <p role="alert" className="rounded-md bg-blocker-soft px-4 py-3 text-sm text-blocker">{error}</p>}
      {notice && <p role="status" className="rounded-md bg-approved-soft px-4 py-3 text-sm text-approved">{notice}</p>}

      {ws.live && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Live brand kit: {ws.meta.name}</h2>
              <p className="text-sm text-muted">
                From {ws.meta.kit_file || "the uploaded PDF"} · revision {ws.meta.revision || 1} · activated {when(ws.meta.activated_at)}
                {ws.meta.updated_at && ws.meta.updated_at !== ws.meta.activated_at ? ` · last updated ${when(ws.meta.updated_at)}` : ""} · {ws.post_count} post{ws.post_count === 1 ? "" : "s"}
              </p>
            </div>
            {canEdit && mode !== "update" && (
              <div className="ml-auto flex flex-wrap gap-2">
                <button className="btn btn-primary" disabled={!!busy} onClick={startUpdate}>Update brand kit</button>
                <button className="btn btn-danger inline-flex items-center gap-1.5" disabled={!!busy} onClick={() => setDialog({ kind: "reset" })}>
                  <WarningIcon /> Reset brand kit
                </button>
              </div>
            )}
          </div>
          {canEdit && (
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <li className="rounded-md bg-canvas px-3 py-2"><span className="font-medium">Update</span>: edit this kit or upload a revised PDF of the same brand. Posts, reviews and insights are kept; open posts are checked again.</li>
              <li className="rounded-md bg-blocker-soft px-3 py-2 text-blocker"><span className="font-medium">Reset</span>: for a different brand. Removes this kit and clears Write and Review for everyone; this brand&rsquo;s posts stay as read-only history in Analytics and Insights. Then you upload the new kit.</li>
            </ul>
          )}
        </section>
      )}

      {ws.empty && (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          No brand kit is live{ws.meta.reset_from ? ` (the ${ws.meta.reset_from} kit was reset ${when(ws.meta.reset_at)})` : ""}. Creators can&rsquo;t check posts until the marketing head uploads and activates a new one. Indian ad regulations stay on.
        </p>
      )}

      {canEdit && (!ws.live || mode === "update") && (
        <section className="panel grid gap-6 p-5 lg:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold">{mode === "update" ? "Upload a revised PDF (optional)" : "Upload the brand kit"}</h2>
            {mode === "update" && <p className="mt-1 text-sm text-muted">Use this when the brand published a new version of its guidelines. It replaces the editor below; you can also just edit the live kit there.</p>}
            {!ws.live && !ws.empty && ws.post_count > 0 && <p className="mt-1 text-sm text-warning">This is the demo workspace. Activating a real brand kit moves the demo posts to history.</p>}
            <label className={`mt-3 flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-line bg-canvas px-4 py-6 text-center text-sm hover:border-suggestion ${busy ? "pointer-events-none opacity-60" : ""}`}>
              <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => { uploadPdf(e.target.files?.[0]); e.target.value = ""; }} />
              <span className="font-medium">{busy || "Choose the brand guideline PDF"}</span>
              <span className="mt-1 text-xs text-muted">PDF with real text, up to 3 MB. {kitInfo?.ai_reader ? "Read with AI and the pattern reader." : "Read with the pattern reader (AI reading is off)."}</span>
            </label>
            <div className="mt-4">
              <p className="label">Logo {mode === "update" ? "(upload only to replace it)" : "(optional, used to check images)"}</p>
              <div className="flex items-center gap-3">
                {logo && <img src={logo} alt="Brand logo" className="h-12 w-auto rounded border border-line bg-white p-1" />}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => uploadLogo(e.target.files?.[0])} className="text-sm" />
              </div>
            </div>
            {!ws.live && <button className="mt-4 text-xs text-muted underline" onClick={() => setDialog({ kind: "demo" })}>Load the demo brand instead</button>}
          </div>
          <div className="text-sm">
            <h3 className="font-semibold">What a good brand kit PDF contains</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Exported from Word, Google Docs or Canva so it has real text, not a scan</li>
              <li>The official brand name, and wrong versions not to use</li>
              <li>Colours with HEX codes, for example &ldquo;Primary: Navy #1F3A68&rdquo;</li>
              <li>Font names, and whether the logo must appear on every post</li>
              <li>Text every image must carry (website, phone, disclaimers)</li>
              <li>Words and claims not to use, as a list under a heading like &ldquo;Words we don&rsquo;t use:&rdquo;</li>
              <li>Prices, offers and results with amounts and dates as YYYY-MM-DD</li>
              <li>Tone rules and sensitive topics</li>
            </ul>
          </div>
        </section>
      )}

      {editing && (
        <section className="panel space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{mode === "update" ? `Edit the live brand kit (revision ${(ws.meta.revision || 1) + 1})` : "Review before activating"}</h2>
            <span className="text-sm text-muted">{fileName ? `${fileName}. ` : ""}Each item shows the page and words it came from. Edit or remove anything wrong.</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="bname">Brand name</label>
              <input id="bname" className="field" value={kit.brand_name?.text || ""} onChange={(e) => set("brand_name", { ...(kit.brand_name || {}), text: e.target.value })} />
              {kit.brand_name?.quote && <Src item={kit.brand_name} />}
            </div>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={!!kit.logo_required?.value} onChange={(e) => set("logo_required", { ...(kit.logo_required || {}), value: e.target.checked })} />
              Logo must appear on every image
            </label>
          </div>

          <div>
            <p className="label">Colours</p>
            <ul className="space-y-2">
              {(kit.colours || []).map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="h-6 w-10 rounded border border-line" style={{ background: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent" }} />
                  <input className="field w-40 py-1" value={c.name} onChange={(e) => set("colours", kit.colours.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Colour name" />
                  <input className="field w-28 py-1" value={c.hex} onChange={(e) => set("colours", kit.colours.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} aria-label="HEX code" />
                  <Src item={c} />
                  <button className="text-blocker underline" onClick={() => set("colours", kit.colours.filter((_, j) => j !== i))}>Remove</button>
                </li>
              ))}
            </ul>
            <button className="mt-2 text-sm text-suggestion underline" onClick={() => set("colours", [...(kit.colours || []), { name: "New colour", hex: "#000000" }])}>Add colour</button>
          </div>

          {(kit.fonts || []).length > 0 && <p className="text-sm"><span className="font-medium">Fonts:</span> {kit.fonts.map((f) => f.name).join(", ")} <span className="text-muted">(shown for reference; fonts in images can&rsquo;t be checked yet)</span></p>}

          {LISTS.map(([key, label]) => (
            <ItemList key={key} label={label} items={kit[key] || []} onChange={(v) => set(key, v)} />
          ))}

          <div>
            <p className="label">Approved facts</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-left text-muted"><tr><th className="py-1 pr-2">Type</th><th className="pr-2">Label</th><th className="pr-2">Value</th><th className="pr-2">Valid from</th><th className="pr-2">Valid until</th><th /></tr></thead>
                <tbody>
                  {(kit.facts || []).map((f, i) => {
                    const upd = (patch) => set("facts", kit.facts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="py-2 pr-2"><select className="field py-1" value={f.kind} onChange={(e) => upd({ kind: e.target.value })}><option value="fee">Fee</option><option value="offer">Offer</option><option value="result">Result</option></select></td>
                        <td className="py-2 pr-2"><input className="field py-1" value={f.label} onChange={(e) => upd({ label: e.target.value })} /><Src item={f} /></td>
                        <td className="py-2 pr-2">{f.kind === "fee" && <input type="number" className="field w-28 py-1" value={f.amount ?? ""} onChange={(e) => upd({ amount: Number(e.target.value) })} aria-label="Amount" />}
                          {f.kind === "offer" && <input type="number" className="field w-20 py-1" value={f.percent ?? ""} onChange={(e) => upd({ percent: Number(e.target.value) })} aria-label="Percent" />}
                          {f.kind === "result" && <span className="flex gap-1"><input type="number" className="field w-20 py-1" value={f.full_course ?? ""} onChange={(e) => upd({ full_course: Number(e.target.value) })} aria-label="Paid full course" /><input type="number" className="field w-20 py-1" value={f.interview_guidance ?? ""} onChange={(e) => upd({ interview_guidance: Number(e.target.value) })} aria-label="Free programme" /></span>}</td>
                        <td className="py-2 pr-2"><input type="date" className="field py-1" value={f.valid_from || ""} onChange={(e) => upd({ valid_from: e.target.value })} /></td>
                        <td className="py-2 pr-2"><input type="date" className="field py-1" value={f.valid_until || ""} onChange={(e) => upd({ valid_until: e.target.value })} /></td>
                        <td className="py-2"><button className="text-blocker underline" onClick={() => set("facts", kit.facts.filter((_, j) => j !== i))}>Remove</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="mt-2 text-sm text-suggestion underline" onClick={() => set("facts", [...(kit.facts || []), { kind: "fee", label: "New fee", amount: 0, valid_from: "", valid_until: "" }])}>Add fact</button>
          </div>

          {mode === "update" && diff && (
            <div className="rounded-lg border border-line p-4">
              <h3 className="font-semibold">What will change</h3>
              {diff.length === 0
                ? <p className="mt-1 text-sm text-muted">Nothing is different from the live kit.</p>
                : (
                  <ul className="mt-2 space-y-3 text-sm">
                    {diff.map((c) => (
                      <li key={c.area}>
                        <p className="font-medium">{c.area}</p>
                        <ul className="mt-1 space-y-0.5">
                          {c.added.map((x) => <li key={`a${x}`} className="text-approved">+ {x}</li>)}
                          {c.removed.map((x) => <li key={`r${x}`} className="text-blocker">&minus; {x}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              <p className="mt-3 text-xs text-muted">Posts, reviews and insights are kept. Rules that didn&rsquo;t change keep their ids. Posts not yet approved are checked again against the new version.</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {mode === "setup" && (
              <button className="btn btn-approve" disabled={!!busy} onClick={() => (ws.post_count > 0 ? setDialog({ kind: "activate" }) : activate(false))}>Activate brand kit</button>
            )}
            {mode === "update" && (
              <>
                <button className="btn btn-quiet" disabled={!!busy} onClick={previewUpdate}>Preview changes</button>
                <button className="btn btn-approve" disabled={!!busy || !diff || diff.length === 0} onClick={applyUpdate}>Apply update</button>
                <button className="btn btn-quiet" disabled={!!busy} onClick={() => { setMode("view"); setKit(null); setDiff(null); setLogo(ws.meta.logo || null); setNewLogo(false); clear(); }}>Cancel</button>
              </>
            )}
            <span className="text-xs text-muted">{mode === "update" && !diff ? "Preview the changes first. " : ""}Indian ad rules (ASCI, CCPA, health claims, #ad disclosure) always stay on.</span>
          </div>
        </section>
      )}

      {!ws.empty && (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Live brand rules</h2>
          <p className="mt-1 text-sm text-muted">{ws.meta.kit_file ? `From ${ws.meta.kit_file}, revision ${ws.meta.revision || 1}.` : "Demo workspace."} Checked against today&rsquo;s date, {ws.today}.</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="text-sm">
              <p className="font-medium">Colours</p>
              <div className="mt-2 flex flex-wrap gap-3">{ws.meta.brand_colours.map((c) => <span key={c.hex} className="flex items-center gap-2"><span className="h-5 w-8 rounded border border-line" style={{ background: c.hex }} />{c.name} <span className="text-muted">{c.hex}</span></span>)}</div>
              <p className="mt-3 font-medium">Logo</p>
              {ws.meta.logo ? <img src={ws.meta.logo} alt="Brand logo" className="mt-1 h-10 w-auto" /> : <p className="text-muted">None uploaded</p>}
              {ws.meta.required_text?.length > 0 && (<><p className="mt-3 font-medium">Required on every image</p><ul className="list-disc pl-5 text-muted">{ws.meta.required_text.map((r) => <li key={r}>{r}</li>)}</ul></>)}
              <p className="mt-3 font-medium">What the brand talks about</p>
              {ws.meta.keywords?.length > 0
                ? <div className="mt-1 flex flex-wrap gap-1.5">{ws.meta.keywords.map((k) => <span key={k} className="rounded-full border border-line px-2 py-0.5 text-xs">{k}</span>)}</div>
                : <p className="text-muted">None yet. Add a few (Update brand kit) so posts about other things are flagged as not for this brand.</p>}
            </div>
            <div className="text-sm">
              <p className="font-medium">Approved facts</p>
              {ws.facts.length === 0 && <p className="text-muted">None.</p>}
              <ul className="mt-1 space-y-1">{ws.facts.map((f) => (
                <li key={f.id}><span className="font-medium">{f.id}</span> {f.label}: {f.kind === "fee" ? `Rs ${f.amount?.toLocaleString("en-IN")}` : f.kind === "offer" ? `${f.percent}% off` : `${f.total} (${f.full_course} paid, ${f.interview_guidance} free)`}
                  <span className={`ml-1 ${f.status === "current" ? "text-approved" : f.status === "expired" ? "text-blocker" : "text-warning"}`}>{f.status}</span></li>))}</ul>
            </div>
          </div>
          <p className="mt-5 text-sm font-medium">Rules</p>
          <ul className="mt-1 divide-y divide-line text-sm">{ws.rules.map((r) => (
            <li key={r.id} className="py-2"><span className="font-medium">{r.name}</span> <span className="text-muted">({r.severity}) {r.sources.join("; ")}</span></li>))}</ul>
          <p className="mt-5 text-sm font-medium">Guidelines</p>
          <ul className="mt-1 space-y-1 text-sm">{ws.guidelines.map((g) => <li key={g.id}><span className="font-medium">{g.section}:</span> <span className="text-muted">{g.text}</span></li>)}</ul>
        </section>
      )}

      <section className="panel p-5 text-sm">
        <h2 className="text-lg font-semibold">Privacy</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Post images are read in the browser; only the read text, measurements and a small preview for the reviewer are sent.</li>
          <li>Post checks use fixed rules and approved facts only; no AI judges posts.</li>
          <li>{kitInfo?.ai_reader ? "Brand kit PDFs are read with an AI service; every extracted item must quote the PDF and is confirmed by the marketing head." : "Brand kit PDFs are read on our server without AI."}</li>
          <li>{ws.password_required ? "Sign-in uses a hashed password and a signed, HttpOnly session" : "Demo sign-in: no password, but every visitor gets a signed, HttpOnly session"}; roles are enforced by the server.</li>
        </ul>
      </section>

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
        <DangerDialog title="Load the demo brand?" confirmWord="demo" action="Load demo"
          onCancel={() => setDialog(null)} onConfirm={loadDemo}
          items={["Any brand kit you started", "All posts, reviews and insights"]}
          note="Replaces everything, including all history, with the fictional Northstar Civils Academy demo. This cannot be undone." />
      )}
    </div>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden fill="currentColor">
      <path fillRule="evenodd" d="M8.26 2.9a2 2 0 0 1 3.48 0l6.5 11.5A2 2 0 0 1 16.5 17.4h-13a2 2 0 0 1-1.74-3l6.5-11.5ZM10 7a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm0 8a1.1 1.1 0 1 0 0-2.2A1.1 1.1 0 0 0 10 15Z" clipRule="evenodd" />
    </svg>
  );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="presentation" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="danger-title" className="w-full max-w-md rounded-lg border border-blocker/40 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 id="danger-title" className="flex items-center gap-2 text-lg font-semibold text-blocker"><WarningIcon /> {title}</h2>
        <p className="mt-2 text-sm">{intro}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="mt-3 rounded bg-blocker-soft px-3 py-2 text-sm text-blocker">{note}</p>
        <label className="mt-4 block text-sm" htmlFor="danger-confirm">Type <span className="font-semibold">{confirmWord}</span> to confirm</label>
        <input id="danger-confirm" className="field mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-quiet" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" disabled={!ok} onClick={onConfirm}>{action}</button>
        </div>
      </div>
    </div>
  );
}

function Src({ item }) {
  if (!item?.quote) return null;
  return <span className="block text-xs text-muted" title={item.quote}>From {item.page ? `page ${item.page}` : "the PDF"} ({item.reader === "AI" ? "AI" : "pattern"}): &ldquo;{item.quote.slice(0, 70)}{item.quote.length > 70 ? "…" : ""}&rdquo;</span>;
}

function ItemList({ label, items, onChange }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <p className="label">{label}</p>
      {items.length === 0 && <p className="text-sm text-muted">Nothing found.</p>}
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
            <input className="field min-w-[12rem] flex-1 py-1" value={it.text || ""} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={label} />
            <button className="text-blocker underline" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
            <span className="w-full"><Src item={it} /></span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input className="field max-w-sm py-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add another" aria-label={`Add to ${label}`} />
        <button className="btn btn-quiet py-1" disabled={!draft.trim()} onClick={() => { onChange([...items, { text: draft.trim() }]); setDraft(""); }}>Add</button>
      </div>
    </div>
  );
}
