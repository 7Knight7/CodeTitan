"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, STATUS_LABEL } from "@/lib/api";
import KitScope from "@/components/KitScope";

const SEVS = [
  { key: "blocker", label: "Blockers", bar: "bg-blocker", text: "text-blocker" },
  { key: "warning", label: "Warnings", bar: "bg-warning", text: "text-warning" },
  { key: "suggestion", label: "Suggestions", bar: "bg-suggestion", text: "text-suggestion" },
];

export default function AnalyticsPage() {
  const [scope, setScope] = useState("kit");
  const [brand, setBrand] = useState(null);
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setD(null);
    api(`/analytics?scope=${scope}${brand ? `&brand=${encodeURIComponent(brand)}` : ""}`).then(setD).catch((e) => setError(e.message));
  }, [scope, brand]);
  if (!d) return <p className="text-muted">{error || "Loading…"}</p>;
  const t = d.totals;
  const issues = t.blocker + t.warning + t.suggestion;
  const passRate = t.checks_run ? Math.round((t.checks_passed / t.checks_run) * 100) : 0;
  const maxIssue = Math.max(1, ...d.issues.map(total));
  const maxPassed = Math.max(1, ...d.passed.map((p) => p.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-proof text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 max-w-prose text-muted">
          Blockers, warnings and suggestions in the latest version of every post, and the checks that passed.
          Counts come from the rule and fact checks; posts marked &ldquo;Sample&rdquo; are demo history.
        </p>
      </div>
      <KitScope kit={d.kit} scope={scope} onScope={setScope} brand={brand} onBrand={setBrand} />

      {scope === "all" && !brand && d.by_brand?.length > 0 && (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">By brand</h2>
          <p className="text-sm text-muted">Each brand was checked against its own brand kit. Pick a brand above to see its details.</p>
          <Table head={["Brand", "Posts", "Blockers", "Warnings", "Suggestions", "Checks passed"]}
            rows={d.by_brand.map((b) => [
              <button key="b" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => setBrand(b.id)}>{b.name}</button>,
              b.posts, ...SEVS.map((s) => <Num key={s.key} n={b[s.key]} cls={s.text} />),
              <span key="c" className="whitespace-nowrap"><span className="font-semibold text-approved">{b.checks_passed}</span> of {b.checks_run}
                {b.checks_run ? ` (${Math.round((b.checks_passed / b.checks_run) * 100)}%)` : ""}</span>,
            ])} />
        </section>
      )}

      {d.posts.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="font-medium">No posts {scope === "kit" ? "for this brand kit" : "in history"} yet</p>
          <p className="mt-1 text-sm text-muted">Check a post on Write and check and its blockers, warnings, suggestions and passed checks show up here.</p>
        </div>
      )}
      {d.posts.length > 0 && <>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {SEVS.map((s) => <Stat key={s.key} n={t[s.key]} label={s.label.toLowerCase()} cls={s.text} />)}
        <Stat n={`${t.checks_passed}`} sub={`of ${t.checks_run}`} label={`checks passed (${passRate}%)`} cls="text-approved" />
        <Stat n={t.verified} label="claims matched approved facts" cls="text-approved" />
      </div>

      <section className="panel space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Issues by severity ({issues})</h2>
          <Stacked parts={SEVS.map((s) => ({ n: t[s.key], cls: s.bar, label: s.label }))} className="mt-2 h-4" />
          <Legend items={SEVS.map((s) => ({ cls: s.bar, label: `${s.label} ${t[s.key]}` }))} />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Checks passed vs. flagged</h2>
          <Stacked parts={[{ n: t.checks_passed, cls: "bg-approved", label: "Passed" }, { n: t.checks_run - t.checks_passed, cls: "bg-line", label: "Flagged" }]} className="mt-2 h-4" />
          <Legend items={[{ cls: "bg-approved", label: `Passed ${t.checks_passed}` }, { cls: "bg-line", label: `Flagged ${t.checks_run - t.checks_passed}` }]} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Most common issues</h2>
          {d.issues.length === 0 && <p className="mt-2 text-sm text-muted">No issues in any post.</p>}
          <ul className="mt-3 space-y-2">
            {d.issues.map((r) => (
              <li key={r.name} className="text-sm">
                <div className="flex justify-between gap-2"><span>{r.name}</span><span className="text-muted">{total(r)}</span></div>
                <div style={{ width: `${(total(r) / maxIssue) * 100}%` }}>
                  <Stacked parts={SEVS.map((s) => ({ n: r[s.key], cls: s.bar, label: s.label }))} className="h-2" />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">What&rsquo;s going right</h2>
          <p className="text-sm text-muted">Checks that ran and found nothing wrong, counted per caption or image.</p>
          {d.passed.length === 0 && <p className="mt-2 text-sm text-muted">Nothing has passed yet.</p>}
          <ul className="mt-3 space-y-2">
            {d.passed.map((p) => (
              <li key={p.name} className="text-sm">
                <div className="flex justify-between gap-2"><span>{p.name}</span><span className="text-muted">{p.count}</span></div>
                <span className="block h-2 rounded bg-approved" style={{ width: `${(p.count / maxPassed) * 100}%` }} aria-hidden />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel p-5">
        <h2 className="text-lg font-semibold">By category</h2>
        <Table head={["Category", "Blockers", "Warnings", "Suggestions"]}
          rows={d.categories.map((c) => [c.name, ...SEVS.map((s) => <Num key={s.key} n={c[s.key]} cls={s.text} />)])} />
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-semibold">By post</h2>
        <Table head={["Post", ...(scope === "all" && !brand ? ["Brand"] : []), "Status", "Blockers", "Warnings", "Suggestions", "Checks passed", "Facts matched"]}
          rows={d.posts.map((p) => [
            <Link key="t" href={`/drafts/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.title}</Link>,
            ...(scope === "all" && !brand ? [<span key="br" className="text-muted">{p.brand}</span>] : []),
            STATUS_LABEL[p.status] || p.status,
            ...SEVS.map((s) => <Num key={s.key} n={p[s.key]} cls={s.text} />),
            <span key="c" className="whitespace-nowrap"><span className="font-semibold text-approved">{p.checks_passed}</span> of {p.checks_run}</span>,
            p.verified,
          ])} />
      </section>
      </>}
    </div>
  );
}

const total = (r) => r.blocker + r.warning + r.suggestion;

function Stat({ n, sub, label, cls }) {
  return (
    <div className="panel p-4">
      <p className={`font-proof text-3xl font-semibold ${cls}`}>{n}{sub && <span className="ml-1 text-base font-normal text-muted">{sub}</span>}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function Stacked({ parts, className }) {
  const sum = parts.reduce((a, p) => a + p.n, 0);
  if (!sum) return <div className={`rounded bg-canvas ${className}`} />;
  return (
    <div className={`flex gap-px overflow-hidden rounded ${className}`} role="img"
      aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
      {parts.filter((p) => p.n > 0).map((p) => <span key={p.label} className={p.cls} style={{ flexGrow: p.n }} title={`${p.label}: ${p.n}`} />)}
    </div>
  );
}

function Legend({ items }) {
  return (
    <p className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
      {items.map((i) => <span key={i.label} className="flex items-center gap-1"><span className={`inline-block h-2 w-3 rounded ${i.cls}`} />{i.label}</span>)}
    </p>
  );
}

function Num({ n, cls }) {
  return <span className={n ? `font-semibold ${cls}` : "text-muted"}>{n}</span>;
}

function Table({ head, rows }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="text-left text-muted"><tr>{head.map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="py-2 pr-3">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
