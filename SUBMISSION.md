# Live Brand Check: submission (Team RaaGa)

Working project link: https://live-brand-check.vercel.app
Source code: https://github.com/7Knight7/CodeTitan
Sign-in for judges: three demo accounts, with their passwords shown on the sign-in page: Priya (creator), Arjun (reviewer, paired with Priya) and Meera (marketing head). A guided demo card walks through the journey in person order, and "Open as Arjun"-style buttons switch person in one click.
Cost to run: nothing. Vercel and Supabase free tiers, no AI keys, no paid services.

## Completed features

The full workflow runs end to end: brand guideline PDF in → reviewed brand kit → post (images plus text, for a chosen platform, format and context) checked against the brand kit, facts and Indian ad rules → clear answer if it isn't a post for this brand → issues explained with sources → creator fixes or justifies → human reviewer decides → recorded → the app learns from the decision.

1. **Brand workspace** built from the brand's own guideline PDF (see below), or the fictional demo brand. Facts, guidelines and rules can be edited; the next check uses the change immediately.
2. **Text checking** with an exact rule engine: guaranteed selection or job claims, unproven superlatives ("India's No. 1"), missing #ad on influencer and paid posts, health or cure claims, pressure and hype, slang, wrong institute name, and sensitive topics.
3. **Claim verification against approved facts**: fees, offers and result counts are compared with the facts table and its validity dates. It catches expired fees and offers, amounts not in the facts sheet, and result claims that hide which programme students took (the issue behind recent CCPA penalties on coaching institutes).
4. **Explanations with sources**: every finding shows severity, the exact quoted text, why it was flagged, the guideline, fact or regulation behind it, that it is rule-based, and an outcome (rule risk, evidence conflict, outdated fact, couldn't verify).
5. **Suggested fixes with human control**: Accept, Edit or Keep original. Keeping the original requires a reason, which the reviewer sees. Accepted fixes are applied and the post is re-checked automatically.
6. **Image checks** in the browser: OCR text (checked by the same rules and facts), lowest text contrast against WCAG 4.5:1, main colours and share of brand colours, logo match, required text and missing alt text. "Brand not visible" is a blocker. Only a small 480 px preview is saved so the reviewer can see the post; the full-size image stays in the browser.
7. **Review and approval workflow**: creator, reviewer and marketing-head roles, each with its own tabs; posts with open blockers cannot be sent; reviewers see the images and approve or request changes with a comment; creators see change requests in a note on every page and a "must do now" warning on Review, which disappears once the fixed version is sent; sensitive posts can only be approved by the marketing head; approved and in-review versions are locked.
8. **Version history and audit trail** for every post: each version's text, images and fields, and every check, decision, override and approval, with who and when.
9. **Insights and Analytics**: posts checked, fixes accepted before review, overrides, how often each rule was raised per post, rules overridden in at least 40% of posts flagged for investigation (with the reasons people gave), and blockers, warnings, suggestions and checks passed. Shown for the current brand kit or for all history, brand by brand.
10. **Secure sign-in and access control**: personal accounts (one per email, scrypt-hashed passwords, one-time invite links, creators paired with their reviewers; 3 wrong passwords pause an account, 5 block it); signed, HttpOnly, 12-hour session cookie; a sign-in attempt limit stored in the database so it holds across servers; roles enforced by the server (creators write, reviewers and the marketing head approve, only the marketing head changes facts and rules); nobody can approve their own post; findings computed on the server so blockers can't be hidden; CSRF header, input limits and security headers on every page. Full design in ARCHITECTURE.md.
11. **Several brands in one workspace**: an agency's marketing head switches brands from the sidebar, adds or removes brands, and assigns each creator and reviewer to one or more brands. Kits, facts, posts, reviews, insights, memory and audit logs are fully separate per brand.
12. **Tests and checks**: 44 automated tests covering the rule engine, fact checks, image findings, tone, the full workflow (blocked submission, required reasons, sensitive-topic approval, change requests, reopened approvals), security (no session, forged or expired cookie, wrong password, attempt limits, missing CSRF header, role checks, self-approval, input limits, unsafe PDFs), accounts and pairing, multi-brand separation, brand kit upload, update and reset, the platform scenarios, brand fit, brand memory and the hash-linked log. GitHub Actions run the tests and a Python dependency audit on every push; an hourly health check pings the live site; Dependabot proposes package updates.
13. **Fast on slow connections and phones**: one database read for the basics of each request (1-3 calls instead of 7-11), a lighter API cold start, shared browser requests while a page loads, the API in Mumbai, and every main page usable on a 375 px phone screen.

## Technology and implementation

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS. Custom proof view renders underlines by severity, linked to issue cards.
- **API**: FastAPI (Python), deployed as a Vercel Python serverless function at `/api`.
- **Storage**: Supabase Postgres, one `lbc_items` table of JSON documents (workspace records, drafts with versions and decisions, overrides, audit events), row-level security on and accessed only with the server key. Local JSON file for development.
- **Checks**: Python regex rule engine with rule IDs, severities and citations; fact matcher with Indian-format amounts (Rs, ₹, k, lakh), percent offers, result counts and validity dates.
- **AI**: none. Every finding comes from a fixed rule, a comparison with approved facts, an image measurement or brand memory learned from people's decisions, so results are repeatable and explainable. Brand guideline PDFs are read by a pattern reader and tone is checked with fixed rules, so the product calls no AI service (see "Why the tone check uses rules, not AI").
- **Chrome extension**: Manifest V3; an offscreen page runs the same `lib/image.js` OCR and image checks; the panel calls the same API with the user's own session.
- **Vision**: tesseract.js OCR (normal and inverted pass) and canvas pixel analysis in the browser for contrast (WCAG relative luminance), dominant colours, brand-colour share and logo match (normalised cross-correlation); colour distance to the brand palette uses CIE Lab ΔE on the server.
- **APIs**: `GET /api/platforms`, `/api/input-schema`, `/api/validation-profile`, `POST /api/drafts/{id}/adapt`, `GET /api/drafts/{id}/results`, `POST /api/extract-text`, `POST /api/check`, `/api/drafts` (create, save, decisions, submit, review), `/api/brandkit` (parse, activate, update, reset), `/api/memory`, `/api/memory/forget`, `/api/workspace`, `/api/facts`, `/api/guidelines`, `/api/rules`, `/api/insights`, `/api/analytics`, `/api/brands`, `/api/team`, `/api/audit/verify`, `/api/drafts/{id}/record.pdf`, `/api/backup`, `/api/reset`.

## Latest changes (image-first and brand kit upload)

- **Brand kit from any PDF.** The marketing head uploads the brand guideline PDF; a pattern reader extracts the brand name, colours, fonts, logo rule, required text, banned words, facts with dates, tone rules, positioning, sensitive topics and what the brand talks about. Every item shows the page and words it came from, and a person reviews and edits everything before activating. Indian ad rules always stay on.
- **Image-first checking.** Posts are checked mainly through their images (up to 5): text read from each image goes through the same rules and fact checks, plus brand-colour share, off-brand colours, logo presence, required text, contrast and alt text. The caption is an optional extra.
- **Better image reading.** Images are enlarged, converted to greyscale and read both normally and inverted; low-confidence words are dropped, and the creator can correct the read text before checking.
- **Several brands from one login.** An agency's marketing head switches between brands in the sidebar and adds new ones; each brand has its own kit, facts, posts, reviews, insights and audit log. Creators and reviewers are assigned to one or more brands and see only those, with a read-only My team page.
- **History kept for each brand.** The marketing head can update the live kit (a preview shows every change before it is applied, and open posts are re-checked) or reset it to switch brands (typing the brand name to confirm). Earlier posts are never deleted: they stay as read-only history, grouped by brand in Insights and Analytics.

## Brand fit and brand memory

- **"Not a post for this brand."** Every post gets a brand-fit answer from the brand kit: brand name, logo, brand colours, other brands' names, the brand's topics and approved offers. If it clearly isn't for this brand, a big red banner says so, lists each reason with its source, and blocks sending. A partial match gets an amber warning.
- **Brand memory.** The app learns from working with the brand: topics and house style from approved posts, what reviewers ask for, mistakes creators keep fixing, and exceptions they keep with a reason. It is stored apart from the brand kit, which it never changes, and it can only add topics and suggestions, never blockers. Creators see past reviewer requests as tips; the marketing head can make it forget a learned topic.

## Platform Intelligence Engine (one brand, multiple platforms, different rules)

- **Adaptive composer.** The creator picks the platform, the format (only formats that platform has) and the commercial context. The composer shows only the fields that combination needs, keeps everything typed when switching, and lets the creator flip between writing and an illustrative platform preview.
- **Five validation layers.** Platform requirements, Indian ad regulations, brand governance, factual verification and visual intelligence. Each finding states its layer, source, location and confidence; anything that can't be measured is marked "Couldn't verify".
- **Commercial context checks.** Paid partnerships and influencer posts must disclose the endorsement (ASCI influencer guidelines, Department of Consumer Affairs endorsement guidance); promotional offers are checked for expired dates and "free" claims without conditions.
- **Create once, adapt everywhere.** A post can be copied into linked drafts for other platforms; each is checked on its own and reviewed by a person. Wording is not rewritten by AI.

## Changes from the Round 1 plan

| Plan | What we did | Why |
| --- | --- | --- |
| Round 2 = checking engine only; editor, approvals and audit in Round 3 | Built the full workflow now | Round 2 is judged on the end-to-end workflow |
| Login with roles | Personal accounts built in-house (scrypt hashes, invites, pairing, lockouts) plus three public demo accounts; roles enforced by the server | Judges can try every role without help; no paid identity service needed |
| TipTap editor | Text box plus a custom marked-up proof view | Same inline underlines with far less complexity |
| Server OCR with Tesseract and OpenCV | tesseract.js in the browser | Serverless hosting can't run native Tesseract; banners also stay on the user's device |
| AI engine for claim extraction and tone (cited, retrieval-grounded) | Rule-based tone check that cites the brand's tone guideline; claims checked by exact fact matching | Free, repeatable and explainable; see "Why the tone check uses rules, not AI" |
| pgvector retrieval | Not built | Only needed for an AI tone check, which we chose not to use |
| Guideline compiler (brand PDF to rules) | Built: brand PDF to a draft brand kit (pattern reader, no AI), confirmed by the marketing head | Brands can be onboarded without hand-writing rules |
| Text-only posts | Image-first, platform-aware posts (platform, format, commercial context) | Most brand mistakes are in the creative, and each platform has its own rules |
| PDF input, logo matching | Built (PDF attachments read for text; logo matched in the browser) | Needed for image-first checking |
| DOCX input, local model | Not built | Deferred to keep the core flow reliable |
| Rules only from the guideline | Brand-fit verdict and brand memory learned from people's decisions | A post for the wrong brand should be stopped outright, and repeat feedback should not be lost |
| "Meaning preserved" score on every fix | Not shown | It depended on the AI layer; rule fixes deliberately change the claim, so a percentage would be misleading |
| "No source, no flag" | Every finding cites its source; missing evidence is shown as "couldn't verify" | Missing evidence should be visible, not silently dropped |
| Inline checking while writing | Check button in the app, and a Chrome extension panel that checks while writing on Instagram and Facebook | The extension only reads and shows findings beside the composer; it never edits the post, so a person stays in control |
| One brand per workspace | Several brands per workspace, people assigned per brand | Agencies work for many brands at once |

## Three improvements for Round 3 (all built and working)

1. **Tone and messaging check (rule-based).** Runs when the brand kit has a Tone or Voice guideline. It flags words that guideline says to avoid, shouting in capitals, repeated or many exclamation marks, and a fixed list of hype and pressure words ("hurry", "last chance"). Each finding quotes the post, cites the tone guideline and is always a suggestion, never a blocker.
2. **Chrome extension.** A read-only panel beside the Instagram and Facebook post composer checks the caption as it is typed and the images as they are attached, with the same rules, facts and brand kit as the web app. Images are read on the device; it uses the person's own sign-in and stores no keys. Install it from the **Chrome extension** page in the app (download, 7 steps, a live "connected" check and a sample banner to try). Close it on one page with ×, or switch it off everywhere from its popup.
3. **Evidence-bound approvals and trusted history.**
   - **Approvals tied to facts:** each approval stores fingerprints of the facts it relied on. If a fact is edited, removed or expires, the post reopens as "re-review needed" with the reason.
   - **Side-by-side comparison** of any two versions: words added, removed and changed.
   - **Tamper-evident log:** every history entry stores the previous entry's fingerprint; `GET /api/audit/verify` and the History page show whether the chain is intact.
   - **Approval record PDF:** the approved post, the facts it relied on, every creator decision and override, and who approved it when, with the log's fingerprint.

## Why the tone check uses rules, not AI

We first planned an AI tone check and built one, then replaced it with fixed rules. Our reasons:

- **Free.** An AI model costs money for every check, and the app is meant to run on free hosting with no API keys at all.
- **Same answer every time.** The same post always gets the same findings, so a creator who fixes a word sees the warning disappear, and the reviewer sees exactly what the creator saw.
- **Every finding has a source.** Each tone finding quotes the exact words and cites the brand's own tone guideline, matching our rule that nothing is flagged without a source.
- **Nothing leaves our server.** Post text is never sent to an outside AI service.
- **The trade-off we accept:** rules can't judge meaning, so subtly off-tone writing (a cold or sarcastic sentence with no flagged words) isn't caught. That is why tone findings are suggestions only and a human reviewer always decides. If AI is added later, it would only suggest, would cite the guideline, and would stay optional.

## Roadmap

**Next (weeks)**
- Test OCR and logo matching on real banners and tune the thresholds (OCR confidence 60, logo match 0.6, brand-colour share 0.25, colour distance 25).
- A labelled test set of real posts with per-rule precision and recall shown in the app, so accuracy is measured, not claimed.
- Test the extension on live Instagram and Facebook composers and keep its page detection up to date.
- Upgrade to Next.js 15 and add a nonce-based Content-Security-Policy.

**Later (months)**
- DOCX and slide-deck brand guidelines; pass and fail examples for each rule.
- Hindi and Telugu captions and image text.
- Regulation packs per industry (education, finance, health, food).
- Two-factor sign-in and single sign-on for agencies; email alerts when a post is sent back or approved.
- Publish the extension on the Chrome Web Store (one-time US$5 developer fee) so installing takes one click.
- Scheduled checks so approvals reopen when a fact expires even if nobody opens the app.

## Team contributions

Each member should write their own statement of what they personally built, tested or decided, matching the commit history.

- B.V. Sri Gautam: [write your own contribution]
- K. Sai Rajasree: [write your own contribution]

## AI and tool disclosure

Significant parts of the code and documentation were drafted with an AI assistant (Claude, Anthropic) and then reviewed, tested and adapted by the team. Product decisions, scope, testing and the demo are the team's. The app itself uses no AI: posts, tone and brand guideline PDFs are all checked or read with fixed rules.
