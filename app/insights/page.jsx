"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import KitScope from "@/components/KitScope";

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

  const max = d ? Math.max(1, ...d.rules.map((r) => r.raised)) : 1;
  const flagged = d ? d.rules.filter((r) => r.needs_review) : [];
  const groups = d ? d.groups.filter((g) => d.rules.some((r) => r.group === g)) : [];
  const quietGroups = d ? d.groups.filter((g) => d.quiet.some((r) => r.group === g)) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-proof text-2xl font-semibold">Insights</h1>
        <p className="mt-1 max-w-prose text-muted">Which mistakes keep coming back, and which rules people keep overriding, for the brand kit in use.</p>
      </div>
      {d && <KitScope kit={d.kit} scope={scope} onScope={setScope} brand={brand} onBrand={setBrand} />}
      {!d ? <p className="text-muted">{error || "Loading…"}</p> : (
        <>
          {d.drafts === 0 && (
            <div className="panel p-6 text-center">
              <p className="font-medium">No posts {scope === "kit" ? "for this brand kit" : "in history"} yet</p>
              <p className="mt-1 text-sm text-muted">Insights fill in as creators check posts on Write and check: which rules fire most, what gets fixed, and which rules people keep overriding.</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat n={d.drafts} label="posts checked" />
            <Stat n={d.fixed_before_review} label="fixes accepted before review" />
            <Stat n={d.overrides} label="flags overridden with a reason" />
            <Stat n={d.status.approved || 0} label="posts approved" />
          </div>

          {flagged.length > 0 && (
            <section className="panel border-warning p-5">
              <h2 className="text-lg font-semibold">Rules needing investigation</h2>
              <p className="mt-1 text-sm text-muted">Overridden in at least 40% of the posts where they fired. The rule may be unclear, too strict for this audience, or people disagree. The marketing head can read the reasons and edit the rule in Brand workspace.</p>
              <ul className="mt-3 space-y-3">
                {flagged.map((r) => (
                  <li key={r.rule_id} className="text-sm">
                    <p className="font-medium">{r.name}: overridden in {r.overridden} of {r.raised} posts <GroupTag g={r.group} /></p>
                    <p className="text-xs text-muted">Source: {r.source}</p>
                    <ul className="mt-1 list-disc pl-5 text-muted">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel p-5">
            <h2 className="text-lg font-semibold">Repeated issues</h2>
            <p className="mt-1 text-sm text-muted">&ldquo;Fired&rdquo; means the rule found something in a post. Fixed = the creator accepted the suggested fix; Overridden = kept the original with a reason.</p>
            {groups.length === 0 && <p className="mt-3 text-sm text-muted">No rule has fired on a post checked against this kit yet.</p>}
            {groups.map((g) => (
              <div key={g} className="mt-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><GroupTag g={g} /> </h3>
                <p className="mt-1 text-xs text-muted">{GROUP_INFO[g]}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="text-left text-muted"><tr><th className="py-2 pr-3 font-medium">Rule</th><th className="w-48 pr-3 font-medium">Posts where it fired</th><th className="w-16 pr-3 font-medium">Fixed</th><th className="w-24 pr-3 font-medium">Overridden</th></tr></thead>
                    <tbody>
                      {d.rules.filter((r) => r.group === g).map((r) => (
                        <tr key={r.rule_id} className="border-t border-line align-top">
                          <td className="py-2 pr-3">
                            <span className="font-medium">{r.name}</span>
                            <span className="block text-xs text-muted">{r.source}</span>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="inline-block h-2 rounded bg-ink" style={{ width: `${(r.raised / max) * 7}rem` }} aria-hidden />
                              {r.raised}
                            </div>
                          </td>
                          <td className="py-2 pr-3">{r.accepted}</td>
                          <td className={`py-2 pr-3 ${r.needs_review ? "font-semibold text-warning" : ""}`}>{r.overridden}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>

          {d.quiet.length > 0 && (
            <section className="panel p-5">
              <h2 className="text-lg font-semibold">Active rules that haven&rsquo;t fired yet</h2>
              <p className="mt-1 text-sm text-muted">These rules run on every post for this kit, but no post has triggered them{scope === "kit" ? " since the kit was activated" : ""}.</p>
              {quietGroups.map((g) => (
                <div key={g} className="mt-3">
                  <GroupTag g={g} />
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {d.quiet.filter((r) => r.group === g).map((r) => (
                      <li key={r.rule_id} className="rounded border border-line bg-canvas px-2 py-1 text-xs" title={r.source}>
                        {r.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function GroupTag({ g }) {
  const cls = {
    Regulation: "bg-sensitive-soft text-sensitive",
    "Brand kit": "bg-suggestion-soft text-suggestion",
    "Approved facts": "bg-approved-soft text-approved",
    Accessibility: "bg-warning-soft text-warning",
  }[g] || "bg-canvas text-muted";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{g}</span>;
}

function Stat({ n, label }) {
  return <div className="panel p-4"><p className="font-proof text-3xl font-semibold">{n}</p><p className="text-sm text-muted">{label}</p></div>;
}
