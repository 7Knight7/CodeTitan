"use client";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "@/lib/api";

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

  if (error) return <section className="panel p-5 text-sm text-blocker">{error}</section>;
  if (!d) return null;
  const m = d.memory;
  const style = m?.style;
  return (
    <section className="panel p-5">
      <h2 className="text-lg font-semibold">Brand memory</h2>
      <p className="mt-1 text-sm text-muted">
        What the app has learned about {d.brand || "this brand"} from approved posts, reviewer feedback and creators&rsquo; decisions.
        It is kept apart from the brand kit, which learning never changes. It only adds suggestions and brand topics, never blockers.
      </p>
      {!m || (m.approved_posts === 0 && !m.feedback.length && !m.mistakes.length && !m.exceptions.length) ? (
        <p className="mt-3 text-sm text-muted">Nothing learned yet. It starts learning when a reviewer approves a post or asks for changes, and when creators fix or keep flagged text.</p>
      ) : (
        <div className="mt-4 grid gap-6 text-sm md:grid-cols-2">
          <div>
            <p className="font-medium">Learned from {m.approved_posts} approved post{m.approved_posts === 1 ? "" : "s"}</p>
            <p className="mt-2 font-medium">Topics this brand talks about</p>
            {m.topics.length === 0
              ? <p className="text-muted">None yet. A word becomes a topic once it appears in {d.min_posts_topic} approved posts.</p>
              : <div className="mt-1 flex flex-wrap gap-1.5">{m.topics.map((t) => (
                  <span key={t.text} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
                    {t.text} <span className="text-muted">{t.posts}</span>
                    {canEdit && <button className="text-blocker" aria-label={`Forget ${t.text}`} title="Forget this topic" onClick={() => forget(t.text)}>×</button>}
                  </span>))}</div>}
            <p className="mt-1 text-xs text-muted">Used with the brand kit&rsquo;s own topics when checking whether a post fits the brand.</p>

            <p className="mt-4 font-medium">House style</p>
            {style
              ? <ul className="mt-1 space-y-0.5 text-muted">
                  <li>Length: usually {style.chars.typical} characters, at most {style.chars.max}</li>
                  <li>Exclamation marks: usually {style.exclaim.typical}, at most {style.exclaim.max}</li>
                  <li>Hashtags: usually {style.hashtags.typical}, at most {style.hashtags.max}</li>
                  <li>Words in capitals: at most {style.caps.max} · Emoji: at most {style.emoji.max}</li>
                </ul>
              : <p className="text-muted">Shown after {d.min_posts_style} approved posts. Posts far outside it get a suggestion.</p>}
          </div>
          <div>
            <p className="font-medium">What reviewers have asked for</p>
            {m.feedback.length === 0 ? <p className="text-muted">No change requests yet.</p> : (
              <ul className="mt-1 space-y-1.5">{m.feedback.slice(0, 5).map((f, i) => (
                <li key={i}>&ldquo;{f.text}&rdquo; <span className="text-xs text-muted">{f.by} on {f.post}, {when(f.at)}</span></li>))}</ul>
            )}
            <p className="mt-4 font-medium">Mistakes that keep coming back</p>
            {m.mistakes.length === 0 ? <p className="text-muted">None yet.</p> : (
              <ul className="mt-1 space-y-0.5">{m.mistakes.map((x) => (
                <li key={x.name}>{x.name} <span className="text-muted">fixed {x.count}×{x.examples.length ? `, e.g. “${x.examples[0]}”` : ""}</span></li>))}</ul>
            )}
            <p className="mt-4 font-medium">Accepted exceptions</p>
            {m.exceptions.length === 0 ? <p className="text-muted">None yet.</p> : (
              <ul className="mt-1 space-y-0.5">{m.exceptions.map((x) => (
                <li key={x.name}>{x.name} <span className="text-muted">kept {x.count}×: &ldquo;{x.reasons[0]}&rdquo;</span></li>))}</ul>
            )}
          </div>
          {m.log.length > 0 && (
            <details className="md:col-span-2">
              <summary className="cursor-pointer text-muted">Recent learning ({m.log.length})</summary>
              <ul className="mt-2 space-y-0.5 text-xs text-muted">{m.log.map((l, i) => <li key={i}>{when(l.at)}: {l.text}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

/** A short reminder in the composer: what reviewers of this brand have asked for before. */
export function MemoryTips() {
  const [m, setM] = useState(null);
  useEffect(() => { api("/memory").then((d) => setM(d.memory)).catch(() => {}); }, []);
  if (!m || (!m.feedback.length && !m.mistakes.length)) return null;
  return (
    <div className="panel p-4 text-sm">
      <p className="font-semibold">Brand memory: before you send</p>
      {m.feedback.length > 0 && (
        <ul className="mt-2 space-y-1">{m.feedback.slice(0, 3).map((f, i) => (
          <li key={i}>&ldquo;{f.text}&rdquo; <span className="text-xs text-muted">{f.by}, {when(f.at)}</span></li>))}</ul>
      )}
      {m.mistakes.length > 0 && (
        <p className="mt-2 text-xs text-muted">Often fixed: {m.mistakes.slice(0, 3).map((x) => `${x.name} (${x.count}×)`).join(", ")}</p>
      )}
    </div>
  );
}
