"use client";
// Side-by-side comparison of two versions of a post: caption, every typed field and the text read
// from each image, with removed words struck through on the left and added words marked on the right.

const tokens = (s) => (s || "").split(/(\s+)/).filter((t) => t !== "");

// Word-level diff (longest common subsequence). Returns [{t, op: "same"|"del"|"add"}].
export function diffWords(a, b) {
  const x = tokens(a), y = tokens(b);
  if (x.length * y.length > 400000) return [...x.map((t) => ({ t, op: "del" })), ...y.map((t) => ({ t, op: "add" }))];
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: x[i], op: "same" }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: x[i++], op: "del" });
    else out.push({ t: y[j++], op: "add" });
  }
  while (i < n) out.push({ t: x[i++], op: "del" });
  while (j < m) out.push({ t: y[j++], op: "add" });
  return out;
}

function parts(v, current) {
  const out = [["Caption", v?.content || ""]];
  Object.entries(v?.fields || {}).forEach(([k, val]) => out.push([k.replace(/_/g, " "), val || ""]));
  const imgs = v?.images ?? (v?.version === current?.version ? current?.images : []) ?? [];
  (imgs || []).forEach((m, i) => { out.push([`Text in image ${i + 1}`, m.text || ""]); out.push([`Alt text, image ${i + 1}`, m.alt_text || ""]); });
  return out;
}

function Side({ ops, keep, label }) {
  return (
    <p className="min-h-[2.5rem] whitespace-pre-wrap rounded-lg border border-line px-3 py-2 text-sm leading-6" aria-label={label}>
      {ops.filter((o) => o.op === "same" || o.op === keep).map((o, k) =>
        o.op === "same" ? <span key={k}>{o.t}</span>
          : o.op === "del" ? <del key={k} className="rounded bg-blocker-soft text-blocker decoration-2">{o.t}</del>
            : <ins key={k} className="rounded bg-approved-soft text-approved no-underline">{o.t}</ins>)}
      {!ops.some((o) => o.op === "same" || o.op === keep) && <span className="text-muted">(empty)</span>}
    </p>
  );
}

export default function VersionDiff({ d, left, right, onLeft, onRight }) {
  const a = d.versions.find((x) => x.version === left), b = d.versions.find((x) => x.version === right);
  const pa = Object.fromEntries(parts(a, d)), pb = Object.fromEntries(parts(b, d));
  const names = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => pa[k] || pb[k]);
  const pick = (val, set, label) => (
    <label className="flex items-center gap-2 text-sm"><span className="text-muted">{label}</span>
      <select className="field w-auto py-1" value={val} onChange={(e) => set(Number(e.target.value))}>
        {d.versions.map((x) => <option key={x.version} value={x.version}>Version {x.version}{x.version === d.approved_version ? " (approved)" : ""}</option>)}
      </select>
    </label>
  );
  let changed = 0;
  const rows = names.map((k) => {
    const ops = diffWords(pa[k] || "", pb[k] || "");
    const diff = ops.some((o) => o.op !== "same");
    if (diff) changed++;
    return { k, ops, diff };
  });
  return (
    <div className="space-y-4" data-testid="version-diff">
      <div className="flex flex-wrap items-center gap-4">
        {pick(left, onLeft, "Before")}{pick(right, onRight, "After")}
        <span className="text-xs text-muted">{changed ? `${changed} part${changed > 1 ? "s" : ""} changed` : "No differences"}</span>
        <span className="ml-auto flex gap-3 text-xs"><del className="rounded bg-blocker-soft px-1 text-blocker">removed</del><ins className="rounded bg-approved-soft px-1 text-approved no-underline">added</ins></span>
      </div>
      <div className="hidden grid-cols-2 gap-3 text-xs font-medium text-muted sm:grid">
        <span>Version {left}{a ? `, ${a.by}` : ""}</span><span>Version {right}{b ? `, ${b.by}` : ""}</span>
      </div>
      {rows.map(({ k, ops, diff }) => (
        <div key={k}>
          <p className="mb-1 text-xs font-medium text-muted first-letter:uppercase">{k}{diff ? "" : " (unchanged)"}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Side ops={ops} keep="del" label={`${k}, version ${left}`} />
            <Side ops={ops} keep="add" label={`${k}, version ${right}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
