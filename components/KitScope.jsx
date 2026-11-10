"use client";

/** Which brand kit the numbers are for: this kit, or all history split brand by brand. */
export default function KitScope({ kit, scope, onScope, brand, onBrand }) {
  if (!kit) return null;
  const date = kit.activated_at ? new Date(kit.activated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  const brands = kit.brands || [];
  const total = brands.reduce((n, b) => n + b.posts, 0);
  const chosen = brands.find((b) => b.id === brand);
  return (
    <div className="panel space-y-3 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p>
            <span className="text-muted">Brand kit:</span> <span className="font-semibold">{kit.name || "Unnamed brand"}</span>
            {kit.is_demo ? <span className="text-muted"> (demo workspace)</span> : <span className="text-muted"> from {kit.file || "uploaded PDF"}, activated {date}</span>}
          </p>
          <p className="text-xs text-muted">
            {scope === "kit"
              ? `Only posts checked against this kit${kit.hidden_posts ? `; ${kit.hidden_posts} older post${kit.hidden_posts > 1 ? "s" : ""} from other brands hidden` : ""}. Indian ad regulations apply to every brand.`
              : brands.length === 0
                ? "No posts yet. Once creators check posts, they appear here grouped by brand, and stay here after a brand kit is reset."
              : chosen
                ? `Showing ${chosen.name} only (${chosen.posts} post${chosen.posts === 1 ? "" : "s"}).${chosen.current ? "" : " Its rules are no longer live."}`
                : `All ${brands.length} brand${brands.length === 1 ? "" : "s"} together. Pick a brand to see its numbers on their own; rule numbers mean different things in different brands.`}
          </p>
        </div>
        <div className="ml-auto flex overflow-hidden rounded-md border border-line" role="group" aria-label="Which posts to include">
          {[["kit", "This brand kit"], ["all", "All history"]].map(([v, label]) => (
            <button key={v} onClick={() => { onScope(v); onBrand?.(null); }} aria-pressed={scope === v}
              className={`px-3 py-1.5 text-sm ${scope === v ? "bg-ink text-white" : "bg-white hover:bg-canvas"}`}>{label}</button>
          ))}
        </div>
      </div>
      {scope === "all" && brands.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3" role="group" aria-label="Brand">
          <Pill active={!brand} onClick={() => onBrand?.(null)}>All brands <span className="opacity-70">{total}</span></Pill>
          {brands.map((b) => (
            <Pill key={b.id} active={brand === b.id} onClick={() => onBrand?.(b.id)}>
              {b.name}{b.current ? " · current" : ""} <span className="opacity-70">{b.posts}</span>
            </Pill>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs ${active ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-canvas"}`}>{children}</button>
  );
}
