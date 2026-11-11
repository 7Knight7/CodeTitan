"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import KitScope from "@/components/KitScope";
import Icon from "@/components/Icon";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { useTour } from "@/components/Tour";

const GROUP_INFO = {
  Regulation: "Indian advertising rules (ASCI, CCPA, Drugs and Magic Remedies Act). Always on, whatever the brand or industry.",
  "Brand kit": "Rules taken from the active brand kit: banned phrases, brand name, colours, logo, required text and sensitive topics.",
  "Approved facts": "Prices, offers and results compared with the approved facts sheet.",
  Accessibility: "Checks on every image so everyone can read the post (WCAG 2.1).",
  "Reading quality": "How clearly the text in the image could be read.",
  "No longer active": "Rules from an earlier brand kit or the demo data. They no longer run on new posts.",
};

export default function InsightsPage() {
  const [scope, setScope] = useState("kit");
  const [brand, setBrand] = useState(null);
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setD(null);
    api(`/insights?scope=${scope}${brand ? `&brand=${encodeURIComponent(brand)}` : ""}`).then(setD).catch((e) => setError(e.message));
  }, [scope, brand]);

  useTour("insights", !!d);
  const max = d ? Math.max(1, ...d.rules.map((r) => r.raised)) : 1;
  const flagged = d ? d.rules.filter((r) => r.needs_review) : [];
  const groups = d ? d.groups.filter((g) => d.rules.some((r) => r.group === g)) : [];
  const quietGroups = d ? d.groups.filter((g) => d.quiet.some((r) => r.group === g)) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Insights" sub="Which mistakes keep coming back, and which rules people keep overriding, for the brand kit in use." />
      {d && <div data-tour="scope"><KitScope kit={d.kit} scope={scope} onScope={setScope} brand={brand} onBrand={setBrand} /></div>}
      {!d ? (error ? <Notice tone="error" role="alert">{error}</Notice> : <div className="space-y-4"><div className="skeleton h-14 w-full" /><div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div></div>) : (
        <>
          {d.drafts === 0 && (
            <div className="panel"><EmptyState icon="insights" title={`No posts ${scope === "kit" ? "for this brand kit" : "in history"} yet`}
              body="Insights fill in as creators check posts: which rules fire most, what gets fixed, and which rules people keep overriding." /></div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat n={d.drafts} label="Posts checked" />
            <Stat n={d.fixed_before_review} label="Fixes accepted before review" tone="text-approved" />
            <Stat n={d.overrides} label="Flags overridden with a reason" tone={d.overrides ? "text-warning" : ""} />
            <Stat n={d.status.approved || 0} label="Posts approved" tone="text-approved" />
          </div>

          {flagged.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-warning-vivid/50 bg-surface">
              <div className="flex items-start gap-3 bg-warning-soft px-5 py-4">
                <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                  <h2 className="text-sm font-semibold">Rules needing investigation</h2>
                  <p className="mt-0.5 text-sm text-ink/75">Overridden in at least 40% of the posts where they fired. The rule may be unclear, too strict for this audience, or people disagree. The marketing head can read the reasons and edit the rule in Brand guidelines.</p>
                </div>
              </div>
              <ul className="divide-y divide-line">
                {flagged.map((r) => (
                  <li key={r.rule_id} className="px-5 py-4 text-sm">
                    <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.name}</span><GroupTag g={r.group} /><span className="ml-auto text-xs text-warning">Overridden in {r.overridden} of {r.raised} posts</span></p>
                    <p className="mt-0.5 text-xs text-muted">Source: {r.source}</p>
                    <ul className="mt-2 space-y-1">{r.reasons.map((x, i) => <li key={i} className="border-l-2 border-line pl-3 text-muted">&ldquo;{x}&rdquo;</li>)}</ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Card tour="repeated" title="Repeated issues" sub="Fired = the rule found something in a post. Fixed = the creator accepted the suggested fix. Overridden = kept the original with a reason." bodyClass="p-0">
            {groups.length === 0 && <p className="px-5 py-4 text-sm text-muted">No rule has fired on a post checked against this kit yet.</p>}
            {groups.map((g) => (
              <div key={g} className="border-b border-line last:border-0">
                <div className="px-5 pb-2 pt-4">
                  <GroupTag g={g} />
                  <p className="mt-1.5 text-xs text-muted">{GROUP_INFO[g]}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="py-2 pl-5 pr-3 font-medium">Rule</th><th className="w-56 pr-3 font-medium">Posts where it fired</th><th className="w-16 pr-3 font-medium">Fixed</th><th className="w-24 pr-5 font-medium">Overridden</th></tr></thead>
                    <tbody>
                      {d.rules.filter((r) => r.group === g).map((r) => (
                        <tr key={r.rule_id} className="border-b border-line align-top last:border-0">
                          <td className="py-3 pl-5 pr-3">
                            <span className="font-medium">{r.name}</span>
                            <span className="mt-0.5 block text-xs text-muted">{r.source}</span>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-2.5">
                              <span className="h-2 w-32 overflow-hidden rounded-full bg-canvas" aria-hidden><span className="block h-full rounded-full bg-ink/80" style={{ width: `${(r.raised / max) * 100}%` }} /></span>
                              <span className="tabular-nums">{r.raised}</span>
                            </div>
                          </td>
                          <td className="py-3 pr-3 tabular-nums">{r.accepted}</td>
                          <td className={`py-3 pr-5 tabular-nums ${r.needs_review ? "font-semibold text-warning" : ""}`}>{r.overridden}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Card>

          {d.quiet.length > 0 && (
            <Card title="Active rules that haven't fired yet" sub={`These rules run on every post for this kit, but no post has triggered them${scope === "kit" ? " since the kit was activated" : ""}.`}>
              <div className="space-y-4">
                {quietGroups.map((g) => (
                  <div key={g}>
                    <GroupTag g={g} />
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {d.quiet.filter((r) => r.group === g).map((r) => <li key={r.rule_id} className="chip text-ink" title={r.source}>{r.name}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function GroupTag({ g }) {
  const cls = {
    Regulation: "bg-sensitive-soft text-sensitive ring-sensitive-vivid/25",
    "Brand kit": "bg-teal-soft text-teal-dark ring-teal/25",
    "Approved facts": "bg-approved-soft text-approved ring-approved-vivid/25",
    Accessibility: "bg-warning-soft text-warning ring-warning-vivid/35",
  }[g] || "bg-canvas text-muted ring-line";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{g}</span>;
}

function Stat({ n, label, tone = "" }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${n ? tone : "text-muted"}`}>{n}</p>
    </div>
  );
}
