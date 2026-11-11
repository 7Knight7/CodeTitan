"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, when } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import { useWorkspaceMeta } from "@/components/Shell";
import Icon from "@/components/Icon";
import { StatusChip, Card, EmptyState, Bar, ScoreRing } from "@/components/ui";
import DemoGuide from "@/components/DemoGuide";
import { useTour } from "@/components/Tour";

const STATUS_ORDER = [
  { key: "draft", label: "Drafts", cls: "bg-line-strong" },
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
  useTour("overview", !!person);

  const [facts, setFacts] = useState(null);
  const [now, setNow] = useState(null); // the visitor's own date and time, set in the browser only
  useEffect(() => { setNow(new Date()); }, []);
  useEffect(() => {
    api("/drafts").then(setDrafts).catch((e) => setError(e.message));
    api("/platforms").then(setCfg).catch(() => {});
    api("/workspace").then((w) => setFacts(w.facts || [])).catch(() => setFacts([]));
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
  const passRate = t?.checks_run ? Math.round((t.checks_passed / t.checks_run) * 100) : null;
  const clearRate = total ? Math.round(((drafts || []).filter((d) => !d.open_blockers?.length).length / total) * 100) : null;
  // The ring always shows a real share: checks passed for those who can see check statistics, otherwise posts clear of blockers.
  const ring = canSeeStats ? (passRate === null ? null : { pct: passRate, label: "of checks passed", detail: `${t.checks_passed} of ${t.checks_run} checks passed across the latest version of every post.` })
    : (clearRate === null ? null : { pct: clearRate, label: "of posts clear of blockers", detail: `${total - (drafts || []).filter((d) => d.open_blockers?.length).length} of ${total} posts have no open blocker.` });
  const critical = canSeeStats ? (t ? t.blocker : null) : (drafts ? openBlockers : null);
  const maxPlatform = Math.max(1, ...byPlatform.map((p) => p.total));
  const topIssues = (stats?.issues || []).slice(0, 6);
  const maxIssue = Math.max(1, ...topIssues.map((r) => r.blocker + r.warning + r.suggestion));
  const tasks = drafts && person && facts ? buildTasks({ person, drafts, facts }) : null;
  const focus = tasks?.[0];
  const next = tasks?.slice(1, 5) || [];
  const hour = now ? now.getHours() : 9;
  const firstName = now ? person?.name?.split(" ")[0] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex min-h-[1.25rem] items-center gap-2 text-sm text-muted"><Icon name="calendar" className="h-4 w-4" />{now ? now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : ""}</p>
          <h1 className="page-title mt-1.5">{firstName ? `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, ${firstName}` : "Overview"}</h1>
          <p className="page-sub">Brand governance for {ws?.name || "your workspace"} at a glance.</p>
        </div>
        <div className="flex gap-2">
          {person?.role !== "Reviewer" && <Link href="/" className="btn btn-primary"><Icon name="checker" className="h-4 w-4" />Check a post</Link>}
          {person && person.role !== "Creator" && <Link href="/review" className="btn btn-quiet">Open review queue</Link>}
        </div>
      </div>

      {/* Score and focus: the two things to know first */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="panel p-6" aria-labelledby="score-title">
          <h2 id="score-title" className="section-title">Brand compliance</h2>
          <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            {!drafts || (canSeeStats && stats === undefined) ? <div className="skeleton h-[136px] w-[136px] rounded-full" />
              : ring ? <ScoreRing pct={ring.pct} size={136} stroke={11} tone={ring.pct >= 80 ? "approved" : ring.pct >= 50 ? "accent" : "warning"} sub={ring.label} />
              : <div className="flex h-[136px] w-[136px] items-center justify-center rounded-full border-[11px] border-line text-center text-xs text-muted">No checks yet</div>}
            <div className="w-full min-w-0 flex-1">
              <dl className="grid grid-cols-3 gap-3 sm:grid-cols-1 sm:gap-2.5">
                <Stat label="Content checked" value={drafts ? total : null} />
                <Stat label="Critical issues" value={critical} tone={critical ? "blocker" : null} />
                <Stat label="Pending approvals" value={drafts ? byStatus.in_review : null} tone={byStatus.in_review ? "accent" : null} />
              </dl>
              {ring && <p className="mt-4 hidden text-xs leading-5 text-muted sm:block">{ring.detail}</p>}
            </div>
          </div>
        </section>

        <section className="glass-strong relative overflow-hidden rounded-xl p-6 shadow-lift" aria-labelledby="focus-title">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-teal/15 blur-3xl" />
          <p className="relative flex items-center gap-2 text-sm font-medium text-teal-dark"><Icon name="target" className="h-4 w-4" /><span id="focus-title">Today&rsquo;s focus</span></p>
          {!tasks ? <div className="mt-5 space-y-3"><div className="skeleton h-7 w-3/4" /><div className="skeleton h-4 w-full" /><div className="skeleton h-10 w-40 rounded-full" /></div> : (
            <div className="relative mt-4">
              <p className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{focus.title}</p>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted">{focus.body}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href={focus.href} className="btn btn-primary px-5">{focus.cta}<Icon name="arrowRight" className="h-4 w-4" /></Link>
                {focus.meta && <span className="text-xs text-muted">{focus.meta}</span>}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card title="Next up" sub="What comes after today's focus" bodyClass="p-2">
          {!tasks ? <div className="p-3"><ListSkeleton rows={3} /></div> : next.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing else is waiting" body="New review requests and posts sent back for changes appear here." />
          ) : (
            <ul>
              {next.map((x) => (
                <li key={x.key}>
                  <Link href={x.href} className="flex items-center gap-3 rounded-md px-3 py-3 transition-colors hover:bg-surface/70">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TASK_TONE[x.tone]}`}><Icon name={x.icon} className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{x.title}</span>
                      <span className="block truncate text-xs text-muted">{x.meta}</span>
                    </span>
                    <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="This week" sub="Posts by the day they last changed, and where they are now">
          {!drafts ? <div className="skeleton h-28 w-full" /> : <Week drafts={drafts} />}
        </Card>
      </div>

      <DemoGuide person={person} />

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

const TASK_TONE = {
  blocker: "bg-blocker-soft text-blocker", warning: "bg-warning-soft text-warning",
  accent: "bg-teal-soft text-teal-dark", sensitive: "bg-sensitive-soft text-sensitive", approved: "bg-approved-soft text-approved",
};

/** What this person should do, most important first, built only from real posts and approved facts. */
function buildTasks({ person, drafts, facts }) {
  if (!person) return [];
  const role = person.role;
  const out = [];
  const waiting = drafts.filter((d) => d.status === "in_review");
  const senior = waiting.filter((d) => d.requires_senior);
  const open = waiting.filter((d) => !d.requires_senior);
  const sentBack = drafts.filter((d) => d.status === "changes_requested" && (role !== "Creator" || d.author === person.name));
  const blocked = drafts.filter((d) => d.status === "draft" && d.open_blockers?.length && (role !== "Creator" || d.author === person.name));
  const expired = facts.filter((f) => f.status === "expired");
  const reviewTask = (d) => ({ key: `r${d.id}`, tone: d.requires_senior ? "sensitive" : "accent", icon: "review", href: "/review",
    title: d.requires_senior ? `Approve “${d.title}”` : `Review “${d.title}”`,
    body: d.requires_senior ? "It mentions a sensitive topic, so only the marketing head can approve it. Check the post and the creator's decisions, then approve it or ask for changes."
      : "Check the post, the automatic findings and the creator's decisions, then approve it or ask for changes.",
    cta: "Open review", meta: `${d.author}, version ${d.version}${d.requires_senior ? ", needs the marketing head" : ""}` });

  if (role === "Creator") {
    sentBack.forEach((d) => out.push({ key: `s${d.id}`, tone: "warning", icon: "message", href: `/?draft=${d.id}`,
      title: `Fix “${d.title}”`, body: d.review?.comment ? `${d.review.by || "The reviewer"} asked: “${d.review.comment}”` : "The reviewer sent this post back for changes.",
      cta: "Open the post", meta: "Sent back by the reviewer" }));
    blocked.forEach((d) => out.push({ key: `b${d.id}`, tone: "blocker", icon: "alertCircle", href: `/?draft=${d.id}`,
      title: `Resolve ${d.open_blockers.length} blocker${d.open_blockers.length > 1 ? "s" : ""} in “${d.title}”`,
      body: `Open: ${d.open_blockers.join(", ")}. Fix each one, or keep the original with a reason, then send it for review.`, cta: "Open the post", meta: d.channel }));
    waiting.forEach((d) => out.push({ key: `w${d.id}`, tone: "accent", icon: "review", href: `/drafts/${d.id}`, title: `“${d.title}” is with the reviewer`,
      body: "", cta: "See its history", meta: d.requires_senior ? "Waiting for the marketing head" : "Waiting for review" }));
  } else {
    if (role === "Marketing head") senior.forEach((d) => out.push(reviewTask(d)));
    open.forEach((d) => out.push(reviewTask(d)));
    if (role === "Marketing head") expired.forEach((f) => out.push({ key: `f${f.id}`, tone: "warning", icon: "facts", href: "/workspace#facts",
      title: `Update an expired fact: ${f.label}`, body: `It was valid until ${f.valid_until}. Posts that quote it are flagged as outdated until the brand kit has a current value.`,
      cta: "Open approved facts", meta: `Approved fact ${f.id}` }));
    if (role === "Reviewer") senior.forEach((d) => out.push({ ...reviewTask(d), title: `“${d.title}” waits for the marketing head`, cta: "See it" }));
    sentBack.forEach((d) => out.push({ key: `s${d.id}`, tone: "warning", icon: "message", href: `/drafts/${d.id}`, title: `“${d.title}” was sent back`,
      body: "", cta: "See its history", meta: `${d.author} is making changes` }));
  }
  if (!out.length) out.push(role === "Reviewer"
    ? { key: "idle", tone: "approved", icon: "insights", href: "/insights", title: "No posts are waiting for you", body: "Use the quiet time to see which mistakes keep coming back and which rules people keep overriding.", cta: "Open insights" }
    : { key: "idle", tone: "approved", icon: "checker", href: "/", title: "Check your next post", body: "Nothing needs your attention. Write a post, or pick a ready-made example, and it is checked against the brand kit and Indian ad rules.", cta: "Open the content checker" });
  return out;
}

/** Monday-to-Sunday strip: posts by the day they last changed, coloured by where they are now. */
function Week({ drafts }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const key = (d) => d.toISOString().slice(0, 10);
  const byDay = new Map(days.map((d) => [key(d), []]));
  drafts.forEach((p) => { if (!p.updated_at) return; const d = new Date(p.updated_at); d.setHours(0, 0, 0, 0); byDay.get(key(d))?.push(p); });
  const tone = { approved: "bg-approved-vivid", in_review: "bg-teal", changes_requested: "bg-warning-vivid", draft: "bg-line-strong" };
  const weekTotal = [...byDay.values()].reduce((n, l) => n + l.length, 0);
  return (
    <div>
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((d) => {
          const list = byDay.get(key(d));
          const isToday = key(d) === key(today), future = d > today;
          return (
            <li key={key(d)} className={`flex flex-col items-center rounded-md px-1 py-2.5 ${isToday ? "bg-ink text-surface" : "bg-surface/50"} ${future ? "opacity-50" : ""}`}
              aria-label={`${d.toLocaleDateString("en-IN", { weekday: "long" })}: ${list.length} post${list.length === 1 ? "" : "s"}`}>
              <span className={`text-2xs ${isToday ? "opacity-70" : "text-muted"}`}>{d.toLocaleDateString("en-IN", { weekday: "short" })}</span>
              <span className="mt-0.5 text-sm font-semibold tabular-nums">{d.getDate()}</span>
              <span className="mt-2 flex min-h-[8px] flex-wrap justify-center gap-0.5">
                {list.slice(0, 6).map((p) => <span key={p.id} className={`h-1.5 w-1.5 rounded-full ${tone[p.status] || "bg-line-strong"} ${isToday ? "ring-1 ring-surface/60" : ""}`} title={p.title} />)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{weekTotal ? `${weekTotal} post${weekTotal === 1 ? "" : "s"} changed this week` : "No posts changed this week yet"}</span>
        <span className="flex items-center gap-1.5"><span className="dot h-1.5 w-1.5 bg-approved-vivid" />Approved</span>
        <span className="flex items-center gap-1.5"><span className="dot h-1.5 w-1.5 bg-teal" />Waiting</span>
        <span className="flex items-center gap-1.5"><span className="dot h-1.5 w-1.5 bg-warning-vivid" />Sent back</span>
        <span className="flex items-center gap-1.5"><span className="dot h-1.5 w-1.5 bg-line-strong" />Draft</span>
      </p>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color = { blocker: "text-blocker", accent: "text-teal-dark" }[tone] || "text-ink";
  return (
    <div className="flex flex-col rounded-md bg-surface/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums tracking-tight sm:mt-0 ${color}`}>{value === null ? <span className="skeleton inline-block h-5 w-8 align-middle" /> : value}</dd>
    </div>
  );
}

function SeverityStat({ label, hint, n, tone }) {
  const s = { blocker: ["bg-blocker-vivid", "text-blocker"], warning: ["bg-warning-vivid", "text-warning"], suggestion: ["bg-suggestion-vivid", "text-suggestion"] }[tone];
  return (
    <div className="panel flex items-start gap-3 p-5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s[0]}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <p className={`ml-auto text-2xl font-semibold tabular-nums tracking-tight ${n ? s[1] : "text-muted"}`}>{n}</p>
    </div>
  );
}

function ListSkeleton({ rows = 5 }) {
  return <div className="space-y-3">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-9 w-full" />)}</div>;
}