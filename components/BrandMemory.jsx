"use client";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "@/lib/api";
import Icon from "./Icon";
import { Card, Notice } from "./ui";

/** What the app has learned about the live brand from approved posts, reviews and creators' decisions.
 *  Kept apart from the brand kit: learning never changes the kit. */
export default function BrandMemory({ canEdit }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api("/memory").then(setD).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function forget(topic) {
    setError("");
    try { await api("/memory/forget", { method: "POST", body: { topic } }); await load(); } catch (e) { setError(e.message); }
  }

  if (error) return <Notice tone="error" role="alert">{error}</Notice>;
  if (!d) return null;
  const m = d.memory;
  const style = m?.style;
  const title = <span className="inline-flex items-center gap-2"><Icon name="sparkle" className="h-4 w-4 text-muted" />Brand memory</span>;
  return (
    <Card title={title}
      sub={`What the app has learned about ${d.brand || "this brand"} from approved posts, reviewer feedback and creators’ decisions. Kept apart from the brand kit, which learning never changes; it only adds suggestions and brand topics, never blockers.`}>
      {!m || (m.approved_posts === 0 && !m.feedback.length && !m.mistakes.length && !m.exceptions.length) ? (
        <p className="text-sm text-muted">Nothing learned yet. It starts learning when a reviewer approves a post or asks for changes, and when creators fix or keep flagged text.</p>
      ) : (
        <div className="grid gap-6 text-sm md:grid-cols-2">
          <div className="space-y-5">
            <div>
              <p className="font-medium">Topics this brand talks about</p>
              <p className="text-xs text-muted">Learned from {m.approved_posts} approved post{m.approved_posts === 1 ? "" : "s"}; used with the brand kit&rsquo;s own topics when checking brand fit.</p>
              {m.topics.length === 0
                ? <p className="mt-2 text-muted">None yet. A word becomes a topic once it appears in {d.min_posts_topic} approved posts.</p>
                : <div className="mt-2 flex flex-wrap gap-1.5">{m.topics.map((t) => (
                    <span key={t.text} className="chip text-ink">
                      {t.text} <span className="text-muted">{t.posts}</span>
                      {canEdit && <button className="-mr-1 rounded-full p-0.5 text-muted hover:bg-blocker-soft hover:text-blocker" aria-label={`Forget ${t.text}`} title="Forget this topic" onClick={() => forget(t.text)}><Icon name="x" className="h-3 w-3" /></button>}
                    </span>))}</div>}
            </div>
            <div>
              <p className="font-medium">House style</p>
              {style
                ? <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-muted">
                    <dt>Length</dt><dd className="text-ink">usually {style.chars.typical} characters, at most {style.chars.max}</dd>
                    <dt>Exclamation marks</dt><dd className="text-ink">usually {style.exclaim.typical}, at most {style.exclaim.max}</dd>
                    <dt>Hashtags</dt><dd className="text-ink">usually {style.hashtags.typical}, at most {style.hashtags.max}</dd>
                    <dt>Capitals, emoji</dt><dd className="text-ink">at most {style.caps.max} words in capitals, {style.emoji.max} emoji</dd>
                  </dl>
                : <p className="mt-1 text-muted">Shown after {d.min_posts_style} approved posts. Posts far outside it get a suggestion.</p>}
            </div>
          </div>
          <div className="space-y-5">
            <div>
              <p className="font-medium">What reviewers have asked for</p>
              {m.feedback.length === 0 ? <p className="mt-1 text-muted">No change requests yet.</p> : (
                <ul className="mt-2 space-y-2">{m.feedback.slice(0, 5).map((f, i) => (
                  <li key={i} className="border-l-2 border-teal/40 pl-3">&ldquo;{f.text}&rdquo; <span className="block text-xs text-muted">{f.by} on {f.post}, {when(f.at)}</span></li>))}</ul>
              )}
            </div>
            <div>
              <p className="font-medium">Mistakes that keep coming back</p>
              {m.mistakes.length === 0 ? <p className="mt-1 text-muted">None yet.</p> : (
                <ul className="mt-1 space-y-1">{m.mistakes.map((x) => (
                  <li key={x.name}>{x.name} <span className="text-muted">fixed {x.count}×{x.examples.length ? `, e.g. “${x.examples[0]}”` : ""}</span></li>))}</ul>
              )}
            </div>
            <div>
              <p className="font-medium">Accepted exceptions</p>
              {m.exceptions.length === 0 ? <p className="mt-1 text-muted">None yet.</p> : (
                <ul className="mt-1 space-y-1">{m.exceptions.map((x) => (
                  <li key={x.name}>{x.name} <span className="text-muted">kept {x.count}×: &ldquo;{x.reasons[0]}&rdquo;</span></li>))}</ul>
              )}
            </div>
          </div>
          {m.log.length > 0 && (
            <details className="border-t border-line pt-4 md:col-span-2">
              <summary className="cursor-pointer text-muted hover:text-ink">Recent learning ({m.log.length})</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted">{m.log.map((l, i) => <li key={i}>{when(l.at)}: {l.text}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

/** A short reminder in the composer: what reviewers of this brand have asked for before. */
export function MemoryTips() {
  const [m, setM] = useState(null);
  useEffect(() => { api("/memory").then((d) => setM(d.memory)).catch(() => {}); }, []);
  if (!m || (!m.feedback.length && !m.mistakes.length)) return null;
  return (
    <div className="panel overflow-hidden text-sm">
      <p className="flex items-center gap-2 border-b border-line bg-teal-soft/50 px-4 py-2.5 font-medium">
        <Icon name="sparkle" className="h-4 w-4 text-teal-dark" />Brand memory: before you send
      </p>
      <div className="px-4 py-3">
        {m.feedback.length > 0 && (
          <ul className="space-y-2">{m.feedback.slice(0, 3).map((f, i) => (
            <li key={i}>&ldquo;{f.text}&rdquo; <span className="block text-xs text-muted">{f.by}, {when(f.at)}</span></li>))}</ul>
        )}
        {m.mistakes.length > 0 && (
          <p className="mt-2 text-xs text-muted">Often fixed: {m.mistakes.slice(0, 3).map((x) => `${x.name} (${x.count}×)`).join(", ")}</p>
        )}
      </div>
    </div>
  );
}
