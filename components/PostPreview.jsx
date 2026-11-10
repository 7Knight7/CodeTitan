"use client";
import { useState } from "react";

/** Illustrative preview of how a post is meant to look on its platform. Not a pixel-perfect copy of the platform. */
export default function PostPreview({ layout, platform, format, context, contextLabel, brand = "Your brand", text = "", fields = {}, media = [] }) {
  const props = { platform, format, context, contextLabel, brand, text, fields, media };
  return (
    <div>
      {layout === "text" && <LinkedIn {...props} />}
      {layout === "visual" && <Instagram {...props} />}
      {layout === "social" && <Facebook {...props} />}
      {layout === "message" && <WhatsApp {...props} />}
      {layout === "banner" && <Website {...props} />}
      <p className="mt-2 text-center text-xs text-muted">Illustrative preview. The platform will show it slightly differently.</p>
    </div>
  );
}

const initial = (s) => (s || "B").trim().charAt(0).toUpperCase();
const tagsOf = (fields) => (fields.hashtags || "").trim();
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u || ""; } };

function Avatar({ brand, size = "h-9 w-9" }) {
  return <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white`}>{initial(brand)}</span>;
}

function Placeholder({ label, className = "" }) {
  return <div className={`flex items-center justify-center bg-canvas text-xs text-muted ${className}`}>{label}</div>;
}

function MediaView({ m, className = "", fit = "object-cover" }) {
  if (!m) return null;
  if (m.kind === "document") {
    return (
      <div className={`flex items-center gap-3 border border-line bg-white p-3 ${className}`}>
        <span className="flex h-12 w-10 items-center justify-center rounded bg-blocker-soft text-xs font-semibold text-blocker">PDF</span>
        <span className="min-w-0 text-sm"><span className="block truncate font-medium">{m.file_name}</span><span className="text-xs text-muted">{m.pages ? `${m.pages} pages` : "Document"}</span></span>
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden bg-canvas ${className}`}>
      {m.preview ? <img src={m.preview} alt={m.alt_text || m.file_name} className={`h-full w-full ${fit}`} /> : <Placeholder label={m.file_name} className="h-full w-full" />}
      {m.kind === "video" && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">▶</span>
        </span>
      )}
    </div>
  );
}

function Carousel({ media, className }) {
  const [i, setI] = useState(0);
  const n = media.length;
  const cur = Math.min(i, n - 1);
  return (
    <div className={`relative ${className}`}>
      <MediaView m={media[cur]} className="h-full w-full" />
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous" disabled={cur === 0} onClick={() => setI(cur - 1)}
            className="absolute left-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white/85 text-sm shadow disabled:opacity-0">‹</button>
          <button type="button" aria-label="Next" disabled={cur === n - 1} onClick={() => setI(cur + 1)}
            className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white/85 text-sm shadow disabled:opacity-0">›</button>
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{cur + 1}/{n}</span>
          <span className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
            {media.map((_, j) => <span key={j} className={`h-1.5 w-1.5 rounded-full ${j === cur ? "bg-white" : "bg-white/50"}`} />)}
          </span>
        </>
      )}
    </div>
  );
}

function SponsorLine({ context, contextLabel, fields }) {
  if (context === "sponsored") return <span className="block text-xs text-muted">Promoted{fields.sponsor ? ` · ${fields.sponsor}` : ""}</span>;
  if (context === "paid_partnership" || context === "influencer")
    return <span className="block text-xs text-muted">{contextLabel}{fields.partner_brand ? ` with ${fields.partner_brand}` : ""}</span>;
  return null;
}

function OfferBadge({ context, fields }) {
  if (context !== "promo_offer" || !(fields.offer_details || fields.offer_valid_until)) return null;
  return (
    <p className="mt-2 rounded bg-warning-soft px-2 py-1 text-xs text-warning">
      {fields.offer_details}{fields.offer_valid_until ? ` · valid till ${fields.offer_valid_until}` : ""}
    </p>
  );
}

function LinkedIn({ format, context, contextLabel, brand, text, fields, media }) {
  const [more, setMore] = useState(false);
  const long = text.length > 210;
  const options = (fields.poll_options || "").split("\n").map((o) => o.trim()).filter(Boolean);
  return (
    <div className="mx-auto max-w-md rounded-lg border border-line bg-white text-sm shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <Avatar brand={brand} />
        <span><span className="block font-semibold">{brand}</span><SponsorLine context={context} contextLabel={contextLabel} fields={fields} /></span>
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2">
        {text ? (long && !more ? <>{text.slice(0, 210)}… <button className="text-muted" onClick={() => setMore(true)}>see more</button></> : text) : <span className="text-muted">Your post text appears here.</span>}
        {tagsOf(fields) && <span className="block text-suggestion">{tagsOf(fields)}</span>}
      </p>
      <OfferBadge context={context} fields={fields} />
      {format === "poll" && (
        <div className="mx-3 mb-3 rounded border border-line p-3">
          <p className="font-medium">{fields.poll_question || "Poll question"}</p>
          {(options.length ? options : ["Option 1", "Option 2"]).map((o) => <p key={o} className="mt-2 rounded-full border border-suggestion px-3 py-1 text-center text-suggestion">{o}</p>)}
        </div>
      )}
      {format === "document" && media[0] && <div className="px-3 pb-3"><MediaView m={media[0]} className="rounded" /><p className="mt-1 text-xs text-muted">{fields.doc_title}</p></div>}
      {format !== "document" && media.length > 0 && (
        <div className={`grid gap-0.5 ${media.length > 1 ? "grid-cols-2" : ""}`}>{media.slice(0, 4).map((m, i) => <MediaView key={i} m={m} className="aspect-square" />)}</div>
      )}
      {fields.url && <p className="border-t border-line px-3 py-2 text-xs text-muted">{domain(fields.url)}</p>}
      <p className="flex justify-around border-t border-line py-2 text-xs text-muted"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></p>
    </div>
  );
}

function Instagram({ format, context, contextLabel, brand, text, fields, media }) {
  const handle = brand.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (format === "story" || format === "reel") {
    return (
      <div className="relative mx-auto aspect-[9/16] w-64 overflow-hidden rounded-2xl bg-ink text-white shadow">
        {media[0] ? <MediaView m={media[0]} className="absolute inset-0 h-full w-full" /> : <Placeholder label="Add the media" className="absolute inset-0 h-full w-full" />}
        <div className="absolute left-0 right-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 text-xs">
          <Avatar brand={brand} size="h-7 w-7" /><span><span className="font-semibold">{handle}</span><span className="block opacity-80"><SponsorText context={context} contextLabel={contextLabel} fields={fields} /></span></span>
        </div>
        {format === "reel" && text && <p className="absolute bottom-10 left-3 right-10 line-clamp-3 text-xs">{text}</p>}
        {fields.cta && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink">{fields.cta}</span>}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-sm rounded-lg border border-line bg-white text-sm shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <Avatar brand={brand} size="h-8 w-8" />
        <span><span className="block font-semibold">{handle}</span><span className="block text-xs text-muted"><SponsorText context={context} contextLabel={contextLabel} fields={fields} /></span></span>
      </div>
      {media.length ? <Carousel media={media} className="aspect-square" /> : <Placeholder label="Add an image" className="aspect-square" />}
      {fields.cta && <p className="flex justify-between border-b border-line px-3 py-2 text-xs font-semibold text-suggestion">{fields.cta}<span>›</span></p>}
      <p className="px-3 pt-2 text-lg" aria-hidden>♡ ◯ ➤</p>
      <p className="whitespace-pre-wrap px-3 pb-3"><span className="font-semibold">{handle}</span> {text || <span className="text-muted">Caption</span>}
        {tagsOf(fields) && <span className="block text-suggestion">{tagsOf(fields)}</span>}
        {fields.tagged && <span className="block text-xs text-muted">Tagged: {fields.tagged}</span>}
      </p>
      <div className="px-3 pb-3"><OfferBadge context={context} fields={fields} /></div>
    </div>
  );
}

function SponsorText({ context, contextLabel, fields }) {
  if (context === "sponsored") return "Sponsored";
  if (context === "paid_partnership" || context === "influencer") return `${contextLabel}${fields.partner_brand ? ` with ${fields.partner_brand}` : ""}`;
  return "";
}

function Facebook({ format, context, contextLabel, brand, text, fields, media }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-line bg-white text-sm shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <Avatar brand={brand} />
        <span><span className="block font-semibold">{brand}</span><span className="block text-xs text-muted">{context === "sponsored" ? "Sponsored" : "Just now"}</span>
          {(context === "paid_partnership" || context === "influencer") && <SponsorLine context={context} contextLabel={contextLabel} fields={fields} />}</span>
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2">{text || <span className="text-muted">Post text</span>}</p>
      <OfferBadge context={context} fields={fields} />
      {format === "link" ? (
        <div className="border-y border-line">
          {media[0] ? <MediaView m={media[0]} className="aspect-[1.91/1]" /> : <Placeholder label="Link image" className="aspect-[1.91/1]" />}
          <div className="bg-canvas px-3 py-2"><span className="block text-xs uppercase text-muted">{domain(fields.url) || "website.com"}</span><span className="font-semibold">{fields.link_title || "Link title"}</span></div>
        </div>
      ) : media.length > 0 && (
        <div className={`grid gap-0.5 ${media.length > 1 ? "grid-cols-2" : ""}`}>{media.slice(0, 4).map((m, i) => <MediaView key={i} m={m} className={media.length > 1 ? "aspect-square" : "aspect-[4/3]"} />)}</div>
      )}
      {fields.cta && <p className="flex items-center justify-between px-3 py-2"><span className="text-xs text-muted">{domain(fields.url)}</span><span className="rounded bg-canvas px-3 py-1 text-xs font-semibold">{fields.cta}</span></p>}
      <p className="flex justify-around border-t border-line py-2 text-xs text-muted"><span>Like</span><span>Comment</span><span>Share</span></p>
    </div>
  );
}

function WhatsApp({ context, brand, text, fields, media }) {
  return (
    <div className="mx-auto max-w-sm rounded-lg bg-[#E8DED4] p-4 shadow-sm">
      <p className="mb-3 text-center text-xs"><span className="rounded bg-white/80 px-2 py-0.5 text-muted">{brand} · broadcast</span></p>
      <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#D9FDD3] p-1.5 text-sm shadow">
        {media[0] && <MediaView m={media[0]} className="mb-1 max-h-60 rounded" fit="object-cover" />}
        <p className="whitespace-pre-wrap px-1.5">{text || <span className="text-muted">Message text</span>}</p>
        {(fields.cta || fields.url) && <p className="px-1.5 pt-1 text-[#027EB5] underline">{fields.cta || fields.url}</p>}
        {fields.contact && <p className="px-1.5 pt-1 text-xs text-muted">{fields.contact}</p>}
        <div className="px-1.5"><OfferBadge context={context} fields={fields} /></div>
        <p className="px-1.5 text-right text-[0.65rem] text-muted">10:30 ✓✓</p>
      </div>
    </div>
  );
}

function Website({ format, context, fields, text, media }) {
  const img = media[0];
  return (
    <div className={`relative overflow-hidden rounded-lg border border-line bg-ink text-white shadow-sm ${format === "section" ? "bg-white text-ink" : ""}`}>
      {format !== "section" && img?.preview && <img src={img.preview} alt={img.alt_text || ""} className="absolute inset-0 h-full w-full object-cover opacity-60" />}
      <div className={`relative grid gap-4 p-6 ${format === "section" ? "md:grid-cols-2" : "min-h-[14rem] content-center"}`}>
        <div>
          {context === "promo_offer" && fields.offer_valid_until && <span className="mb-2 inline-block rounded bg-warning px-2 py-0.5 text-xs font-semibold text-white">Offer till {fields.offer_valid_until}</span>}
          <p className="font-proof text-2xl font-semibold leading-tight">{fields.headline || "Headline"}</p>
          {text && <p className={`mt-2 text-sm ${format === "section" ? "text-muted" : "text-white/90"}`}>{text}</p>}
          {fields.cta && <span className={`mt-4 inline-block rounded px-4 py-2 text-sm font-semibold ${format === "section" ? "bg-ink text-white" : "bg-white text-ink"}`}>{fields.cta}</span>}
          {fields.url && <span className={`mt-1 block text-xs ${format === "section" ? "text-muted" : "text-white/70"}`}>→ {domain(fields.url)}</span>}
        </div>
        {format === "section" && (img ? <MediaView m={img} className="aspect-[4/3] rounded" /> : <Placeholder label="Optional image" className="aspect-[4/3] rounded" />)}
      </div>
    </div>
  );
}
