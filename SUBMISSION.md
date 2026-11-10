# Live Brand Check: Round 2 submission (Team RaaGa)

Working project link: [add Vercel URL]
Source code: [add GitHub URL]
Sign-in for judges: no password; choose a role (Priya, social media; Arjun, brand reviewer; Meera, marketing head) on the sign-in page

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
10. **Secure sign-in and access control**: password off for the judges' demo (role choice only) and stored only as a salted scrypt hash when turned on; signed, HttpOnly, 12-hour session cookie; login rate limiting; roles enforced by the server (creators write, reviewers and the marketing head approve, only the marketing head changes facts and rules); nobody can approve their own post; findings computed on the server so blockers can't be hidden; CSRF header, input limits and security headers on every page. Full design in ARCHITECTURE.md.
11. **Tests**: 32 automated tests covering the rule engine, fact checks, image findings, the full workflow (blocked submission, required reasons, sensitive-topic approval, change requests), security (no session, forged or expired cookie, wrong password and rate limit, missing CSRF header, role checks, self-approval, input limits), brand kit upload, update and reset, the platform scenarios, brand fit and brand memory.

## Technology and implementation

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS. Custom proof view renders underlines by severity, linked to issue cards.
- **API**: FastAPI (Python), deployed as a Vercel Python serverless function at `/api`.
- **Storage**: Supabase Postgres, one `lbc_items` table of JSON documents (workspace records, drafts with versions and decisions, overrides, audit events), row-level security on and accessed only with the server key. Local JSON file for development.
- **Checks**: Python regex rule engine with rule IDs, severities and citations; fact matcher with Indian-format amounts (Rs, ₹, k, lakh), percent offers, result counts and validity dates.
- **AI**: no AI judges posts. Every finding comes from a fixed rule, a comparison with approved facts, an image measurement or brand memory learned from people's decisions, so results are repeatable and explainable. The only optional AI use is reading the brand guideline PDF (when `ANTHROPIC_API_KEY` is set), and every AI item must quote the PDF.
- **Vision**: tesseract.js OCR (normal and inverted pass) and canvas pixel analysis in the browser for contrast (WCAG relative luminance), dominant colours, brand-colour share and logo match (normalised cross-correlation); colour distance to the brand palette uses CIE Lab ΔE on the server.
- **APIs**: `GET /api/platforms`, `/api/input-schema`, `/api/validation-profile`, `POST /api/drafts/{id}/adapt`, `GET /api/drafts/{id}/results`, `POST /api/extract-text`, `POST /api/check`, `/api/drafts` (create, save, decisions, submit, review), `/api/brandkit` (parse, activate, update, reset), `/api/memory`, `/api/memory/forget`, `/api/workspace`, `/api/facts`, `/api/guidelines`, `/api/rules`, `/api/insights`, `/api/analytics`, `/api/reset`.

## Latest changes (image-first and brand kit upload)

- **Brand kit from any PDF.** The marketing head uploads the brand guideline PDF; a pattern reader (always) and an AI reader (when configured) extract the brand name, colours, fonts, logo rule, required text, banned words, facts with dates, tone rules, positioning, sensitive topics and what the brand talks about. Every item shows the page and words it came from, AI items without a matching quote are dropped, and a person reviews and edits everything before activating. Indian ad rules always stay on.
- **Image-first checking.** Posts are checked mainly through their images (up to 5): text read from each image goes through the same rules and fact checks, plus brand-colour share, off-brand colours, logo presence, required text, contrast and alt text. The caption is an optional extra.
- **Better image reading.** Images are enlarged, converted to greyscale and read both normally and inverted; low-confidence words are dropped, and the creator can correct the read text before checking.
- **One brand at a time, with history kept.** The marketing head can update the live kit (a preview shows every change before it is applied, and open posts are re-checked) or reset it to switch brands (typing the brand name to confirm). Earlier posts are never deleted: they stay as read-only history, grouped by brand in Insights and Analytics.

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
| Login with roles | Password sign-in (hashed) with a signed session; role chosen at sign-in and switchable in the header; roles enforced by the server | Judges can try every role with one password; personal accounts (Supabase Auth) come after the event |
| TipTap editor | Text box plus a custom marked-up proof view | Same inline underlines with far less complexity |
| Server OCR with Tesseract and OpenCV | tesseract.js in the browser | Serverless hosting can't run native Tesseract; banners also stay on the user's device |
| AI engine for claim extraction and tone (cited, retrieval-grounded) | Not in this build; all checks are rule- and fact-based | We moved the AI tone check to the final round so this build is fully repeatable and explainable; claim checking already works with exact fact matching |
| pgvector retrieval | Not needed yet | Retrieval comes with the AI tone check in the final round |
| Guideline compiler (brand PDF to rules) | Built: brand PDF to a draft brand kit (pattern reader, optional AI reader that must quote the PDF), confirmed by the marketing head | Brands can be onboarded without hand-writing rules |
| Text-only posts | Image-first, platform-aware posts (platform, format, commercial context) | Most brand mistakes are in the creative, and each platform has its own rules |
| PDF input, logo matching | Built (PDF attachments read for text; logo matched in the browser) | Needed for image-first checking |
| DOCX input, local model | Not built | Deferred to keep the core flow reliable |
| Rules only from the guideline | Brand-fit verdict and brand memory learned from people's decisions | A post for the wrong brand should be stopped outright, and repeat feedback should not be lost |
| "Meaning preserved" score on every fix | Not shown | It depended on the AI layer; rule fixes deliberately change the claim, so a percentage would be misleading |
| "No source, no flag" | Every finding cites its source; missing evidence is shown as "couldn't verify" | Missing evidence should be visible, not silently dropped |
| Inline checking while writing | Check button, with underlines and fixes in the app | Real-time checking inside Instagram and Facebook is planned as a browser plugin in the final round |

## Three improvements for Round 3

1. **AI tone and messaging check.** Retrieves the brand guidelines most relevant to the post and checks tone and messaging against them. Emails, phone numbers and confidential names are masked before any text leaves our server, and a finding is shown only if it quotes the post and cites a real guideline. Each finding is labelled AI-generated.
2. **Real-time browser plugin.** A Chrome extension that checks captions as they are typed on Instagram and Facebook, underlines issues in place with the reason and fix, and checks images and banners as they are attached. It uses the same rules, facts and approval workflow as the web app.
3. **Evidence-bound approvals and trusted history.** Proving what was approved, on what evidence, and that the record hasn't changed:
   - **Approvals tied to facts:** every approved post is linked to the facts it relied on. When a fact is edited or expires, affected approved posts are reopened as "re-review needed" with the reason.
   - **Side-by-side comparison:** compare any two versions of a post and see exactly which words were added, removed or changed.
   - **Tamper-proof log:** each history entry stores a fingerprint (hash) of the previous one, so any later edit to past records breaks the chain and is detected and shown.
   - **Approval record export:** download a PDF showing the approved post, the facts it relied on, every creator decision and override, and who approved it and when.

## Future scope (after the event)

- Guideline compiler upgrades: DOCX input, and pass and fail examples for each rule.
- Measured accuracy: a labelled test set with per-rule precision and recall shown in the app.
- Sign-in with real accounts and organisation workspaces.
- Industry-specific regulation packs, and Hindi and Telugu support.

## Team contributions

Each member should write their own statement of what they personally built, tested or decided, matching the commit history.

- B.V. Sri Gautam: [write your own contribution]
- K. Sai Rajasree: [write your own contribution]

## AI and tool disclosure

Significant parts of the code and documentation were drafted with an AI assistant (Claude, Anthropic) and then reviewed, tested and adapted by the team. Product decisions, scope, testing and the demo are the team's. The app does not use AI to judge posts; the only optional AI use is reading brand guideline PDFs when an API key is configured.
