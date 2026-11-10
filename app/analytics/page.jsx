"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import KitScope from "@/components/KitScope";
import Icon from "@/components/Icon";
import { Bar, Card, EmptyState, Notice, PageHeader, StatusChip } from "@/components/ui";

const SEVS = [
  { key: "blocker", label: "Critical", bar: "bg-blocker-vivid", text: "text-blocker" },
  { key: "warning", label: "Warnings", bar: "bg-warning-vivid", text: "text-warning" },
  { key: "suggestion", label: "Suggestions", bar: "bg-suggestion-vivid", text: "text-suggestion" },
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

  const header = <PageHeader title="Analytics" sub="Critical issues, warnings and suggestions in the latest version of every post, and the checks that passed. Posts marked “Sample” are demo history." />;
  if (!d) return <div className="space-y-6">{header}{error ? <Notice tone="error" role="alert">{error}</Notice> : <Loading />}</div>;
  const t = d.totals;
  const issues = t.blocker + t.warning + t.suggestion;
  const passRate = t.checks_run ? Math.round((t.checks_passed / t.checks_run) * 100) : 0;
  const maxIssue = Math.max(1, ...d.issues.map(total));
  const maxPassed = Math.max(1, ...d.passed.map((p) => p.count));
  const maxCat = Math.max(1, ...d.categories.map(total));

  return (
    <div className="space-y-6">
      {header}
      <KitScope kit={d.kit} scope={scope} onScope={setScope} brand={brand} onBrand={setBrand} />

      {scope === "all" && !brand && d.by_brand?.length > 0 && (
        <Card title="By brand" sub="Each brand was checked against its own brand kit. Pick a brand above to see its details." bodyClass="p-0">
          <Table head={["Brand", "Posts", "Critical", "Warnings", "Suggestions", "Checks passed"]}
            rows={d.by_brand.map((b) => [
              <button key="b" className="text-left font-medium text-teal-dark underline-offset-2 hover:underline" onClick={() => setBrand(b.id)}>{b.name}</button>,
              b.posts, ...SEVS.map((s) => <Num key={s.key} n={b[s.key]} cls={s.text} />),
              <span key="c" className="whitespace-nowrap"><span className="font-semibold text-approved">{b.checks_passed}</span> of {b.checks_run}
                {b.checks_run ? ` (${Math.round((b.checks_passed / b.checks_run) * 100)}%)` : ""}</span>,
            ])} />
        </Card>
      )}

      {d.posts.length === 0 && (
        <div className="panel"><EmptyState icon="analytics" title={`No posts ${scope === "kit" ? "for this brand kit" : "in history"} yet`}
          body="When creators check posts in the content checker, their issues and passed checks show up here." /></div>
      )}
      {d.posts.length > 0 && <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="panel p-4 sm:col-span-2 lg:col-span-1">
            <p className="text-xs text-muted">Checks passed</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-approved">{passRate}%</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-approved-vivid" style={{ width: `${passRate}%` }} /></div>
            <p className="mt-2 text-xs text-muted">{t.checks_passed} of {t.checks_run} checks, {t.verified} claim{t.verified === 1 ? "" : "s"} matched approved facts</p>
          </div>
          {SEVS.map((s) => (
            <div key={s.key} className="panel p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted"><span className={`dot ${s.bar}`} />{s.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${t[s.key] ? s.text : "text-muted"}`}>{t[s.key]}</p>
              <p className="mt-2 text-xs text-muted">{issues ? `${Math.round((t[s.key] / issues) * 100)}% of ${issues} issues` : "No issues"}</p>
            </div>
          ))}
        </div>

        <Card title="Issues by severity" sub={`${issues} issue${issues === 1 ? "" : "s"} across ${d.posts.length} post${d.posts.length === 1 ? "" : "s"}`}>
          <Stacked parts={SEVS.map((s) => ({ n: t[s.key], cls: s.bar, label: s.label }))} className="h-3" />
          <Legend items={SEVS.map((s) => ({ cls: s.bar, label: `${s.label} ${t[s.key]}` }))} />
          <p className="mt-5 text-sm font-medium">Checks passed and flagged</p>
          <Stacked parts={[{ n: t.checks_passed, cls: "bg-approved-vivid", label: "Passed" }, { n: t.checks_run - t.checks_passed, cls: "bg-[#CBD5E1]", label: "Flagged" }]} className="mt-2 h-3" />
          <Legend items={[{ cls: "bg-approved-vivid", label: `Passed ${t.checks_passed}` }, { cls: "bg-[#CBD5E1]", label: `Flagged ${t.checks_run - t.checks_passed}` }]} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Most common issues" sub="Ranked by how often they appear">
            {d.issues.length === 0 ? <p className="text-sm text-muted">No issues in any post.</p> : (
              <ul className="space-y-3.5">
                {d.issues.map((r) => (
                  <li key={r.name} className="text-sm">
                    <div className="mb-1.5 flex justify-between gap-2"><span className="truncate">{r.name}</span><span className="tabular-nums text-muted">{total(r)}</span></div>
                    <Bar value={total(r)} max={maxIssue} parts={SEVS.map((s) => ({ n: r[s.key], cls: s.bar }))} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="What's going right" sub="Checks that ran and found nothing wrong, counted per caption or image">
            {d.passed.length === 0 ? <p className="text-sm text-muted">Nothing has passed yet.</p> : (
              <ul className="space-y-3.5">
                {d.passed.map((p) => (
                  <li key={p.name} className="text-sm">
                    <div className="mb-1.5 flex justify-between gap-2"><span className="truncate">{p.name}</span><span className="tabular-nums text-muted">{p.count}</span></div>
                    <Bar value={p.count} max={maxPassed} parts={[{ n: p.count, cls: "bg-approved-vivid" }]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Violation categories" sub="Where issues come from">
          {d.categories.length === 0 ? <p className="text-sm text-muted">No issues in any post.</p> : (
            <ul className="grid gap-x-8 gap-y-3.5 md:grid-cols-2">
              {d.categories.map((c) => (
                <li key={c.name} className="text-sm">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="ml-auto flex gap-2 text-xs tabular-nums">{SEVS.map((s) => c[s.key] ? <span key={s.key} className={s.text}>{c[s.key]} {s.label.toLowerCase()}</span> : null)}</span>
                  </div>
                  <Bar value={total(c)} max={maxCat} parts={SEVS.map((s) => ({ n: c[s.key], cls: s.bar }))} />
                </li>
              ))}
            </ul>
          )}
          <Legend items={SEVS.map((s) => ({ cls: s.bar, label: s.label }))} />
        </Card>

        <Card title="By post" sub="Latest version of each post" bodyClass="p-0">
          <Table head={["Post", ...(scope === "all" && !brand ? ["Brand"] : []), "Status", "Critical", "Warnings", "Suggestions", "Checks passed", "Facts matched"]}
            rows={d.posts.map((p) => [
              <Link key="t" href={`/drafts/${p.id}`} className="font-medium hover:text-teal-dark hover:underline">{p.title}</Link>,
              ...(scope === "all" && !brand ? [<span key="br" className="text-muted">{p.brand}</span>] : []),
              <StatusChip key="s" status={p.status} />,
              ...SEVS.map((s) => <Num key={s.key} n={p[s.key]} cls={s.text} />),
              <span key="c" className="whitespace-nowrap"><span className="font-semibold text-approved">{p.checks_passed}</span> of {p.checks_run}</span>,
              p.verified,
            ])} />
        </Card>
      </>}
    </div>
  );
}

const total = (r) => r.blocker + r.warning + r.suggestion;

function Loading() {
  return <div className="space-y-4"><div className="skeleton h-14 w-full" /><div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div><div className="skeleton h-40 w-full" /></div>;
}

function Stacked({ parts, className }) {
  const sum = parts.reduce((a, p) => a + p.n, 0);
  if (!sum) return <div className={`rounded-full bg-canvas ${className}`} />;
  return (
    <div className={`flex gap-0.5 overflow-hidden rounded-full ${className}`} role="img"
      aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
      {parts.filter((p) => p.n > 0).map((p) => <span key={p.label} className={p.cls} style={{ flexGrow: p.n }} title={`${p.label}: ${p.n}`} />)}
    </div>
  );
}

function Legend({ items }) {
  return (
    <p className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
      {items.map((i) => <span key={i.label} className="flex items-center gap-1.5"><span className={`dot ${i.cls}`} />{i.label}</span>)}
    </p>
  );
}

function Num({ n, cls }) {
  return <span className={`tabular-nums ${n ? `font-semibold ${cls}` : "text-muted"}`}>{n}</span>;
}

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-left text-xs text-muted"><tr className="border-b border-line">{head.map((h, i) => <th key={h} className={`py-2.5 pr-3 font-medium ${i === 0 ? "pl-5" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line transition-colors last:border-0 hover:bg-canvas/60">{r.map((c, j) => <td key={j} className={`py-3 pr-3 ${j === 0 ? "pl-5" : ""}`}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
