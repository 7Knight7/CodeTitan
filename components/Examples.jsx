"use client";
import { useState } from "react";
import Icon from "./Icon";

/** Ready-made posts for the demo. Each one fills the real composer and runs the real check, so judges can see
 *  every kind of finding without typing anything. All brands, prices and results are fictional demo data. */
export const EXAMPLES = [
  {
    id: "claims", title: "Example: claims that break ad rules", name: "Claims that break ad rules",
    shows: "Guaranteed selection, “No. 1” claims, a wrong brand name and an old fee",
    platform: "linkedin", format: "text", context: "organic", tone: "blocker",
    caption: "India's No. 1 coaching for UPSC! 50 of our students cracked the exam this year. 100% selection guaranteed at Northstar IAS. Fees just Rs 45,000. Hurry, limited seats!!",
  },
  {
    id: "facts", title: "Example: fee and results not on record", name: "Fee and results not on record",
    shows: "A fee and a results number that don't match the approved facts",
    platform: "whatsapp", format: "text", context: "organic", tone: "blocker",
    caption: "Reminder: the Foundation course fee for the 2026-27 batch is Rs 52,000. 60 of our students were selected in UPSC CSE 2025. Northstar Civils Academy.",
  },
  {
    id: "disclosure", title: "Example: paid post without #ad", name: "Paid post without #ad",
    shows: "A paid partnership missing its disclosure; fix it in one click",
    platform: "instagram", format: "feed", context: "paid_partnership", tone: "blocker",
    caption: "Loved the weekly UPSC mock tests at Northstar Civils Academy. They helped me plan my prelims revision.",
    fields: { partner_brand: "Northstar Civils Academy", product: "UPSC mock tests", relationship: "Paid",
      connection_details: "Paid Rs 10,000 for one post", disclosure: "#ad" },
    image: "banner-on-brand.jpg", alt: "Northstar Civils Academy poster for the UPSC Prelims test series 2026-27",
  },
  {
    id: "banner", title: "Example: banner with problems", name: "Banner with problems",
    shows: "Image text is read in your browser: low contrast, no alt text, a guarantee claim",
    platform: "instagram", format: "feed", context: "organic", tone: "blocker",
    caption: "New UPSC batch starting soon.",
    image: "banner-problems.jpg",
  },
  {
    id: "offbrand", title: "Example: post for another brand", name: "Post for another brand",
    shows: "A pizza ad sent from the academy's account: not on brand",
    platform: "instagram", format: "feed", context: "organic", tone: "blocker",
    caption: "Craving cheese? Grab a large pepperoni pizza tonight, delivered hot to your door.",
    fields: { hashtags: "#pizza #foodie" },
    image: "banner-other-brand.jpg", alt: "Pizza Palace poster: large pizza 50% off",
  },
  {
    id: "health", title: "Example: health claim", name: "Health claim",
    shows: "A cure claim that falls under the Drugs and Magic Remedies Act",
    platform: "facebook", format: "text", context: "organic", tone: "blocker",
    caption: "Our meditation module at Northstar Civils Academy cures exam stress permanently for UPSC aspirants.",
  },
  {
    id: "offer", title: "Example: offer that has ended", name: "Website offer that has ended",
    shows: "A promotional banner whose offer end date has passed",
    platform: "website", format: "promo", context: "promo_offer", tone: "blocker",
    caption: "Northstar Civils Academy Foundation course for UPSC aspirants: weekly mock tests and mentoring.",
    fields: { headline: "10% off the Foundation course", cta: "Enrol", url: "https://northstar.example/enrol",
      offer_details: "10% off the Foundation course fee", offer_valid_until: "2025-12-31", offer_terms: "https://northstar.example/terms" },
    image: "banner-on-brand.jpg", alt: "Northstar Civils Academy poster for the UPSC Prelims test series 2026-27",
  },
  {
    id: "festival", title: "Example: festival greeting", name: "Festival greeting",
    shows: "A sensitive topic: only the marketing head can approve it",
    platform: "instagram", format: "feed", context: "organic", tone: "warning",
    caption: "Happy Diwali from everyone at Northstar Civils Academy. Classes for UPSC aspirants resume on Monday.",
    image: "banner-on-brand.jpg", alt: "Northstar Civils Academy poster for the UPSC Prelims test series 2026-27",
  },
  {
    id: "clean", title: "Example: post ready to send", name: "Post ready to send",
    shows: "Fee and results match the approved facts; no issues",
    platform: "linkedin", format: "text", context: "organic", tone: "approved",
    caption: "Admissions are open for the Northstar Civils Academy Foundation course, 2026-27 batch. The fee is Rs 48,000. In UPSC CSE 2025, 50 of our students were selected: 32 from the paid full course and 18 from the free interview guidance programme. Our UPSC aspirants get weekly mock tests, mentoring and study material.",
  },
];

const TONE = {
  blocker: ["bg-blocker-vivid", "Finds problems"],
  warning: ["bg-warning-vivid", "Needs senior sign-off"],
  approved: ["bg-approved-vivid", "Passes"],
};
const PLATFORM = { instagram: "Instagram", linkedin: "LinkedIn", facebook: "Facebook", whatsapp: "WhatsApp", website: "Website" };

/** Grid of examples. Clicking one fills the composer and runs the check. */
export const DEMO_BRAND = "Northstar Civils Academy";

export default function ExamplePicker({ onRun, running, canRun, blockedReason, onSwitch, brand, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel overflow-hidden" aria-labelledby="examples-title" data-tour="examples">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-canvas/60">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-soft text-teal-dark"><Icon name="sparkle" className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span id="examples-title" className="block text-sm font-semibold">Try a ready-made example</span>
          <span className="block text-xs text-muted">One click fills in a post and checks it. Or write your own below.</span>
        </span>
        <Icon name="chevronDown" className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-line p-4">
          {!canRun && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md bg-canvas px-3 py-2.5 text-sm">
              <Icon name="info" className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 text-muted">{blockedReason}</span>
              {onSwitch && <button className="btn btn-teal btn-sm" onClick={onSwitch}>Switch to Priya (creator)</button>}
            </div>
          )}
          {canRun && brand && brand !== DEMO_BRAND && (
            <p className="mb-3 flex items-start gap-2.5 rounded-md bg-warning-soft px-3 py-2.5 text-sm text-warning">
              <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>These examples are written for the demo brand, {DEMO_BRAND}. With {brand} live, most will also be flagged as not on brand. To see them as intended, restore the demo brand from the guided demo on Overview.</span>
            </p>
          )}
          <ul className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
            {EXAMPLES.map((ex) => {
              const [dot, outcome] = TONE[ex.tone];
              const isRunning = running === ex.id;
              return (
                <li key={ex.id}>
                  <button type="button" disabled={!canRun || !!running} onClick={() => onRun(ex)}
                    className={`group flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed ${isRunning ? "border-teal bg-teal-soft/60 ring-1 ring-teal" : "border-line bg-white hover:border-teal hover:bg-teal-soft/30 disabled:opacity-60 disabled:hover:border-line disabled:hover:bg-white"}`}>
                    {ex.image
                      ? <img src={`/samples/${ex.image}`} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover ring-1 ring-line" />
                      : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-canvas text-muted ring-1 ring-line"><Icon name="message" className="h-4 w-4" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-5">{ex.name}</span>
                      <span className="mt-0.5 block text-xs leading-4 text-muted">{ex.shows}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted">
                        <span className="inline-flex items-center gap-1"><span className={`dot h-1.5 w-1.5 ${dot}`} />{outcome}</span>
                        <span>{PLATFORM[ex.platform]}{ex.image ? ", with image" : ""}</span>
                      </span>
                    </span>
                    {isRunning
                      ? <Icon name="refresh" className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-teal-dark" />
                      : <Icon name="chevronRight" className="mt-0.5 h-4 w-4 shrink-0 text-[#B4BCC8] group-hover:text-teal-dark" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
