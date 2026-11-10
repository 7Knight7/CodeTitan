"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, when } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import { useWorkspaceMeta } from "@/components/Shell";
import Icon from "@/components/Icon";
import { StatusChip, Card, EmptyState, Bar } from "@/components/ui";
import DemoGuide from "@/components/DemoGuide";

const STATUS_ORDER = [
  { key: "draft", label: "Drafts", cls: "bg-[#CBD5E1]" },
  { key: "in_review", label: "Waiting for review", cls: "bg-teal" },
  { key: "changes_requested", label: "Changes requested", cls: "bg-warning-vivid" },
  { key: "approved", label: "Approved", cls: "bg-approved-vivid" },
];

export default function OverviewPage() {
  const { person } = useRole();
  const ws = useWorkspaceMeta();
  const [drafts, setDrafts] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [stats, setStats] = useState(undefined); // undefined = loading, null = not available for this role
  const [error, setError] = useState("");
  const canSeeStats = person && person.role !== "Creator";

  useEffect(() => {
    api("/drafts").then(setDrafts).catch((e) => setError(e.message));
    api("/platforms").then(setCfg).catch(() => {});
  }, []);
  useEffect(() => {
    if (!person) return;
    if (!canSeeStats) { setStats(null); return; }
    api("/analytics?scope=kit").then(setStats).catch(() => setStats(null));
  }, [person, canSeeStats]);

  const byStatus = useMemo(() => {
    const c = { draft: 0, in_review: 0, changes_requested: 0, approved: 0 };
    (drafts || []).forEach((d) => { c[d.status] = (c[d.status] || 0) + 1; });
    return c;
  }, [drafts]);

  const byPlatform = useMemo(() => {
    const m = new Map();
    for (const d of drafts || []) {
      const label = cfg?.platforms.find((p) => p.id === d.platform)?.label || (d.channel || "Other").split(/ · | /)[0];
      const row = m.get(label) || { label, total: 0, approved: 0, open: 0 };
      row.total += 1;
      if (d.status === "approved") row.approved += 1;
      if (d.open_blockers?.length) row.open += 1;
      m.set(label, row);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [drafts, cfg]);

  if (error) return <p role="alert" className="rounded-md bg-blocker-soft px-4 py-3 text-sm text-blocker">{error}</p>;

  const total = drafts?.length ?? 0;
  const openBlockers = (drafts || []).reduce((n, d) => n + (d.open_blockers?.length || 0), 0);
  const t = stats?.totals;
  const issues = t ? t.blocker + t.warning + t.suggestion : 0;
  const passRate = t?.checks_run ? Math.round((t.checks_passed / t.checks_run) * 100) : null;
  const maxPlatform = Math.max(1, ...byPlatform.map((p) => p.total));
  const topIssues = (stats?.issues || []).slice(0, 6);
  const maxIssue = Math.max(1, ...topIssues.map((r) => r.blocker + r.warning + r.suggestion));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Brand governance for {ws?.name || "your workspace"}: what is waiting, what is blocked and what keeps going wrong.</p>
        </div>
        <div className="flex gap-2">
          {person?.role !== "Reviewer" && <Link href="/" className="btn btn-teal"><Icon name="checker" className="h-4 w-4" />Check a post</Link>}
          {person && person.role !== "Creator" && <Link href="/review" className="btn btn-quiet">Open review queue</Link>}
        </div>
      </div>

      <DemoGuide person={person} />

      {/* Governance status: the one-line answer, then the numbers behind it */}
      <section className="panel overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="p-5 sm:p-6">
            {!drafts ? <div className="skeleton h-6 w-2/3" /> : (
              <Verdict total={total} byStatus={byStatus} openBlockers={openBlockers} empty={ws?.empty} />
            )}
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-line ring-1 ring-line sm:grid-cols-4">
              <Kpi label="Posts in workspace" value={drafts ? total : null} />
              <Kpi label="Waiting for review" value={drafts ? byStatus.in_review : null} tone={byStatus.in_review ? "teal" : null} href={person?.role !== "Creator" ? "/review" : undefined} />
              <Kpi label="Changes requested" value={drafts ? byStatus.changes_requested : null} tone={byStatus.changes_requested ? "warning" : null} />
              <Kpi label="Approved" value={drafts ? byStatus.approved : null} tone={byStatus.approved ? "approved" : null} />
            </div>
          </div>
          <div className="flex items-center gap-5 border-t border-line bg-canvas/60 p-5 sm:p-6 lg:w-80 lg:border-l lg:border-t-0">
            {canSeeStats ? (
              stats === undefined ? <div className="skeleton h-24 w-full" /> : passRate === null ? (
                <p className="text-sm text-muted">Check results appear here once posts have been checked against this brand kit.</p>
              ) : (
                <>
                  <Ring pct={passRate} />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">Checks passed</p>
                    <p className="mt-0.5 text-muted">{t.checks_passed} of {t.checks_run} checks across the latest version of each post.</p>
                    <p className="mt-2 text-xs text-muted">{t.verified} claim{t.verified === 1 ? "" : "s"} matched approved facts</p>
                  </div>
                </>
              )
            ) : (
              <div className="text-sm">
                <p className="font-medium">Open blockers</p>
                <p className={`mt-1 text-3xl font-semibold tracking-tight ${openBlockers ? "text-blocker" : "text-approved"}`}>{drafts ? openBlockers : "–"}</p>
                <p className="mt-1 text-muted">{openBlockers ? "Resolve these before posts can be sent for review." : "Nothing is blocking a post right now."}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {canSeeStats && stats && (
        <section className="grid gap-4 sm:grid-cols-3">
          <SeverityStat label="Critical issues" hint="Blockers in the latest version of each post" n={t.blocker} tone="blocker" />
          <SeverityStat label="Warnings" hint="Need a decision before review" n={t.warning} tone="warning" />
          <SeverityStat label="Suggestions" hint="Optional improvements" n={t.suggestion} tone="suggestion" />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card title="Recent activity" action={<Link href={person?.role === "Creator" ? "/" : "/review"} className="link text-xs">View all</Link>}>
          {!drafts ? <ListSkeleton /> : drafts.length === 0 ? (
            <EmptyState icon="checker" title="No posts yet" body="Check a post in the content checker and it will show up here." />
          ) : (
            <ul className="-mx-5 divide-y divide-line">
              {drafts.slice(0, 7).map((d) => (
                <li key={d.id}>
                  <Link href={`/drafts/${d.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-canvas">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-canvas text-muted ring-1 ring-line"><Icon name="file" className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.title}</span>
                      <span className="block truncate text-xs text-muted">{d.author} · {d.channel}</span>
                    </span>
                    <span className="hidden text-right text-xs text-muted sm:block">{when(d.updated_at)}</span>
                    <StatusChip status={d.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card title="Posts by status">
            {!drafts ? <div className="skeleton h-3 w-full" /> : total === 0 ? <p className="text-sm text-muted">No posts yet.</p> : (
              <>
                <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={STATUS_ORDER.map((s) => `${s.label} ${byStatus[s.key]}`).join(", ")}>
                  {STATUS_ORDER.filter((s) => byStatus[s.key]).map((s) => <span key={s.key} className={s.cls} style={{ flexGrow: byStatus[s.key] }} />)}
                </div>
                <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {STATUS_ORDER.map((s) => (
                    <li key={s.key} className="flex items-center gap-2"><span className={`dot ${s.cls}`} /><span className="text-muted">{s.label}</span><span className="ml-auto font-medium tabular-nums">{byStatus[s.key]}</span></li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="Posts by platform">
            {!drafts ? <ListSkeleton rows={3} /> : byPlatform.length === 0 ? <p className="text-sm text-muted">No posts yet.</p> : (
              <ul className="space-y-3">
                {byPlatform.map((p) => (
                  <li key={p.label} className="text-sm">
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-xs text-muted">{p.approved} approved{p.open ? `, ${p.open} blocked` : ""}</span>
                      <span className="ml-auto tabular-nums text-muted">{p.total}</span>
                    </div>
                    <Bar value={p.total} max={maxPlatform} parts={[{ n: p.approved, cls: "bg-approved-vivid" }, { n: p.total - p.approved, cls: "bg-ink/80" }]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Most common issues" sub="Across the latest version of every post checked against this brand kit"
        action={canSeeStats && <Link href="/analytics" className="link text-xs">Open analytics</Link>}>
        {!canSeeStats ? (
          <EmptyState icon="lock" title="Visible to reviewers and the marketing head" body="Issue statistics come from the analytics service, which only reviewers and the marketing head can open." />
        ) : stats === undefined ? <ListSkeleton rows={4} /> : topIssues.length === 0 ? (
          <EmptyState icon="checkCircle" title="No issues recorded" body="When checks find problems in posts, the most frequent ones are ranked here." />
        ) : (
          <ul className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {topIssues.map((r) => {
              const n = r.blocker + r.warning + r.suggestion;
              return (
                <li key={r.name} className="text-sm">
                  <div className="mb-1.5 flex items-baseline gap-2"><span className="truncate font-medium">{r.name}</span><span className="ml-auto tabular-nums text-muted">{n}</span></div>
                  <Bar value={n} max={maxIssue} parts={[{ n: r.blocker, cls: "bg-blocker-vivid" }, { n: r.warning, cls: "bg-warning-vivid" }, { n: r.suggestion, cls: "bg-suggestion-vivid" }]} />
                </li>
              );
            })}
          </ul>
        )}
        {canSeeStats && topIssues.length > 0 && (
          <p className="mt-5 flex flex-wrap gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="dot bg-blocker-vivid" />Critical</span>
            <span className="flex items-center gap-1.5"><span className="dot bg-warning-vivid" />Warning</span>
            <span className="flex items-center gap-1.5"><span className="dot bg-suggestion-vivid" />Suggestion</span>
          </p>
        )}
      </Card>
    </div>
  );
}

function Verdict({ total, byStatus, openBlockers, empty }) {
  let tone = "approved", icon = "checkCircle", text;
  if (empty) { tone = "warning"; icon = "alert"; text = "No brand kit is live, so posts can't be checked yet."; }
  else if (total === 0) { tone = "suggestion"; icon = "info"; text = "No posts yet. Check your first post to start the record."; }
  else if (openBlockers) { tone = "blocker"; icon = "alertCircle"; text = `${openBlockers} blocker${openBlockers > 1 ? "s" : ""} open across your posts.`; }
  else if (byStatus.in_review || byStatus.changes_requested) {
    tone = "teal"; icon = "review";
    text = [byStatus.in_review && `${byStatus.in_review} waiting for review`, byStatus.changes_requested && `${byStatus.changes_requested} sent back for changes`].filter(Boolean).join(", ") + ".";
  } else text = "Every post is clear of blockers.";
  const ring = { approved: "bg-approved-soft text-approved", warning: "bg-warning-soft text-warning", blocker: "bg-blocker-soft text-blocker", suggestion: "bg-suggestion-soft text-suggestion", teal: "bg-teal-soft text-teal-dark" }[tone];
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ring}`}><Icon name={icon} className="h-5 w-5" /></span>
      <p className="text-base font-medium sm:text-lg">{text}</p>
    </div>
  );
}

function Kpi({ label, value, tone, href }) {
  const color = { teal: "text-teal-dark", warning: "text-warning", approved: "text-approved" }[tone] || "text-ink";
  const inner = (
    <>
      <p className="text-xs text-muted">{label}</p>
      {value === null ? <div className="skeleton mt-2 h-7 w-10" /> : <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</p>}
    </>
  );
  return href
    ? <Link href={href} className="block bg-white px-4 py-3.5 transition-colors hover:bg-canvas">{inner}</Link>
    : <div className="bg-white px-4 py-3.5">{inner}</div>;
}

function SeverityStat({ label, hint, n, tone }) {
  const s = { blocker: ["bg-blocker-vivid", "text-blocker"], warning: ["bg-warning-vivid", "text-warning"], suggestion: ["bg-suggestion-vivid", "text-suggestion"] }[tone];
  return (
    <div className="panel flex items-start gap-3 p-4">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s[0]}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <p className={`ml-auto text-2xl font-semibold tabular-nums tracking-tight ${n ? s[1] : "text-muted"}`}>{n}</p>
    </div>
  );
}

function Ring({ pct }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`${pct}% of checks passed`}>
      <svg viewBox="0 0 72 72" className="h-20 w-20 -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#E4E7EC" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="#16B8A6" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="ring-draw" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}

function ListSkeleton({ rows = 5 }) {
  return <div className="space-y-3">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-9 w-full" />)}</div>;
}

