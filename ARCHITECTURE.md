# Live Brand Check: architecture and security design

## 1. Requirements

**Functional (the workflow from the Round 1 plan):** the marketing head turns the brand guideline PDF into a reviewed brand kit → a creator prepares a post for a platform, format and context (images plus text) → the server checks it against the brand kit, approved facts and Indian ad rules, and says whether it belongs to the brand at all → each issue is explained with its source and a fix → the creator accepts, edits or keeps the original with a reason → a reviewer approves or requests changes (sensitive topics need the marketing head) → every version and decision is recorded → insights show repeated mistakes and contested rules.

**Non-functional:** no data or secret leakage, server-enforced roles, explainable and repeatable results, under 1 second per check, works on mobile, runs on free tiers (Vercel, Supabase).

**Constraints:** two-person team, 1–3 days, judges must be able to use it unaided. The live site runs in personal-accounts mode with three demo accounts whose passwords are shown on the sign-in page; locally the default is a role choice with no password (`LBC_REQUIRE_PASSWORD=1` or `LBC_AUTH_MODE=accounts` change that). Everything must be free to run: no paid services and no AI keys.

## 2. High-level design

```
 Browser (Next.js pages)                         Vercel                                   Supabase
┌──────────────────────────┐   HTTPS   ┌──────────────────────────────┐   HTTPS   ┌────────────────────┐
│ Login, Write, Review,    │──────────▶│ Next.js middleware            │           │ Postgres            │
│ Workspace, Insights      │           │  no cookie → /login           │           │  lbc_items (JSONB)  │
│                          │  /api/*   │ FastAPI (Python function)     │──────────▶│  RLS on, no public  │
│ Image OCR (tesseract.js) │──────────▶│  1 X-LBC header check (CSRF)  │ service   │  policies           │
│  480px preview only      │  cookie + │  2 session signature + expiry │ key only  └────────────────────┘
└──────────────────────────┘  X-LBC:1  │  3 role check per endpoint    │
         ▲                             │  4 input validation (pydantic)│
         │ CDN: OCR engine + language  │  5 rule engine + fact checks  │
         │ data (jsDelivr, tessdata)   │  6 workflow + audit log       │
                                       └──────────────────────────────┘
```

**Trust boundary:** everything in the browser is untrusted. The server never accepts identity, role, findings or authorship from a request body.

### Request flow for "Check post"

1. Browser reads each image locally (OCR, contrast, palette, brand-colour share, logo match, 480 px preview) and sends `PUT /api/drafts/{id}` with title, platform, format, context, fields and those measurements, plus the session cookie and `X-LBC: 1`.
2. Middleware rejects the request if the header is missing (403) or the cookie is missing, tampered or expired (401).
3. Endpoint checks the role is Creator and the post isn't locked, validates input sizes, then runs the rule engine and fact checks **on the server**.
4. Findings, a new version and an audit event are stored. The response returns the findings for display.

### Platform Intelligence Engine (`api/_lbc/platforms.py`)

One configuration module decides, for each platform (Instagram, LinkedIn, Facebook, WhatsApp, Website), format (feed post, carousel, reel, document, poll, hero banner, ...) and commercial context (organic, sponsored, paid partnership, influencer, promotional offer):

- **Input schema**: which fields and uploads the composer shows, in what order, and which are required (`GET /api/input-schema`). The composer renders whatever comes back; there is no per-platform form.
- **Validation profile**: which checks run in each of five layers (`GET /api/validation-profile`): platform requirements (documented limits only, each with its source; warnings or suggestions, never compliance blockers), Indian ad regulations (ASCI, CCPA, Drugs and Magic Remedies Act), brand governance (the active brand kit), factual verification (approved facts with dates) and visual intelligence (OCR, contrast, colours, logo, alt text).
- **Context checks**: endorsement disclosure for paid partnerships and influencer posts (missing, buried among hashtags, not on a story, not verifiable inside a video), and offer dates and conditions for promotional offers. Anything that can't be measured is reported as "Couldn't verify".
- **Adaptation**: `POST /api/drafts/{id}/adapt` creates one linked draft per destination with the same wording, restructured into that platform's fields. Each version is checked separately and needs its own review. AI rewriting is not used (team rule for Round 2); the hook is `adapt_fields`.

Every finding carries `layer`, `confidence` (High, Medium or Low from OCR confidence, or Unverified) and a readable `location_label`. Missing fields and invalid uploads are stored as `input_errors` and block sending for review; they are not compliance findings. Videos stay on the device (one frame is read); PDF attachments are read on the server for their text and not stored.

### Brand kit (`api/_lbc/brandkit.py`, `brandapply.py`)

- **Reading the PDF**: a pattern reader (always on, no AI) reads HEX colours, fonts, the logo rule, "must include" text, banned words (quoted words and "words we don't use" lists), tone and positioning lines, named sensitive topics, rupee fees and percent offers with dates, the brand name (without words like "Brand Toolkit"), and the brand's topics (its hashtags and often-repeated words). No AI is used. Every item keeps its page and quote.
- **Human confirmation**: the marketing head edits the draft kit on Brand workspace and activates it. Only then does it become live guidelines, rules and facts. Indian regulatory rules are always added.
- **Multi-brand**: every brand's data lives in its own namespace (store type `<brand>__<type>`; the first brand, `main`, keeps the plain type names). Accounts, invitations and the brand list (`brand`) are shared. The middleware picks the request's brand from the `lbc_brand` cookie only if the person works on it (marketing heads and sign-ins without personal accounts: every brand; creators and reviewers: their `brand_ids`), else their first brand. Pairing and the reviewer check only count people who work on the open brand.
- **Lifecycle (per brand)**: activation is refused while a kit is live. `/api/brandkit/update` shows a change preview, then applies it, keeping rule and fact ids for unchanged items and re-checking posts not yet approved. `/api/brandkit/reset` (brand name typed to confirm) removes the kit; its posts are archived with `kit_id` and `kit_name`, never deleted, and shown read-only under All history by brand.

### Brand fit (`api/_lbc/brandfit.py`)

Answers "is this a post for this brand at all?" from signals that are already measured or written in the kit: brand name in any text, logo match, average brand-colour share, another brand's name (a wrong name from the kit, or a brand that had its own kit here before), the brand's topics (kit topics plus topics learned by brand memory) and offers or fees missing from the approved facts. A signal with nothing to measure is "unknown" and never counts against the post. The verdict is *no* when another brand is named, three or more signals fail, or neither name nor logo is found and another signal fails; this adds the blocker "Not a post for {brand}" and a red banner on Write and check, Review and History. One or two failures give an amber "partly on brand" banner with no blocker.

### Brand memory (`api/_lbc/memory.py`)

What the app learns as people work with a brand, stored separately (type `memory`, one document per kit id) so the brand kit is never changed by learning. It learns only from human decisions:

| Source | What is learned | How it is used |
| --- | --- | --- |
| A reviewer approves a post | Words and hashtags (a topic after 2 approved posts), house style: length, "!", hashtags, capital-letter words, emoji | Learned topics count in brand fit; after 3 approved posts, a post far outside the house style gets a suggestion (`MEM-STYLE`) |
| A reviewer requests changes | The comment, who and on which post | Shown to creators as tips in the composer |
| A creator accepts or edits a fix | The issue as a repeat mistake | Later findings say "This has come up N times before" |
| A creator keeps flagged text with a reason | An accepted exception with its reasons | Shown on Brand workspace |

Memory never adds blockers. `GET /api/memory` shows it; only the marketing head can make it forget a learned topic (`POST /api/memory/forget`), and forgotten topics are not learned again.

### Speed

- **One database read per page for the basics.** Each API request starts a request cache; the middleware loads accounts, brands and the open brand's settings, guidelines, rules and facts in one Supabase call, and later reads in the same request come from memory. Most requests make 1–3 database calls (before: 7–11). Each response carries a `Server-Timing` header with the count.
- **Lighter start.** The PDF library is loaded only when a brand PDF is uploaded, which cuts the Python function's cold start.
- **Browser.** Identical requests made while a page loads share one call; fixed platform data is kept for 10 minutes. The OCR engine and its language data load only when an image is added.
- **Region.** The API function runs in Mumbai (`bom1` in `vercel.json`); keeping Supabase in the same region (Mumbai, `ap-south-1`) avoids a long round trip on every call.
- **Phones.** Every main page fits a 375 px screen without sideways scrolling; the five-step bar shows only the current step on small screens.

## 3. Data model

One table, `lbc_items(id, type, data jsonb, created_at)`, with `type` one of: `guideline`, `rule`, `fact`, `meta` (workspace and the live brand kit), `draft` (with platform, format, context, fields, input errors, versions, findings, decisions, review, campaign links, `kit_id`, `kit_name`, `archived`), `override`, `event` (audit log), `memory` (brand memory per kit), plus the shared types `user`, `invite`, `brand` and `ratelimit` (sign-in attempts per hashed IP). Each brand's types are stored as `<brand>__<type>`. A single document table keeps the demo simple; see section 6 for when to split it.

## 4. Security design

### Authentication
Three sign-in modes, chosen with server settings: **demo** (default), **shared password** (`LBC_REQUIRE_PASSWORD=1`) and **personal accounts** (`LBC_AUTH_MODE=accounts`).

- **Personal accounts** (`api/_lbc/accounts.py`, all free, no outside service): one account per email, with its own password (scrypt hash) and a role set by the marketing head. The first account is created at `/setup`, which needs `LBC_SETUP_CODE` in production and only works while no account exists. Everyone else joins through a one-time invitation link (only a SHA-256 hash of the token is stored; links expire after 7 days) that the marketing head copies and sends. 3 wrong passwords pause that account's sign-in for 15 minutes; 2 more block it until a marketing head unblocks it on Team (or from the server: `python api/_lbc/accounts.py unblock <email>`). The count is stored on the account, so it holds across server instances. Each session carries the account id and a session version: changing a role, deactivating someone, changing a password or “sign out other devices” ends old sessions at once. Authors and reviewers are matched by account id, so nobody can approve their own post. Accounts are kept when demo data is reset. Three demo accounts for the judges (meera@xyz.com, priya@xyz.com, arjun@xyz.com, passwords shown on the sign-in page) are created automatically in accounts mode; they get the 15-minute pause but are never blocked, and their password, role and access can't be changed. Turn them off for real use with `LBC_DEMO_ACCOUNTS=0`. Creators and reviewers are paired (several each way): inviting a creator means choosing their reviewer(s), inviting a reviewer means choosing the creator(s) they look after (optional only while nobody exists to choose), and pairings can be edited on Team. Only a creator's paired, active reviewers or the marketing head can approve or send back that creator's posts; posts whose creator has no active paired reviewer can be reviewed by any reviewer. Demo Priya is paired with demo Arjun.
- **Judges' demo**: no password; the sign-in page only asks for a role, and the server still issues the signed session below. Turn the password on before any real use with `LBC_REQUIRE_PASSWORD=1`.
- **Shared password** (when on), stored only as a salted **scrypt** hash in the `LBC_PASSWORD_HASH` environment variable. The password is never in the code, the repository or the database.
- Constant-time comparison, a 0.4-second delay on failure, and **5 attempts per 10 minutes per IP** before a 429 response.
- On success the server issues a session token: `{role, name, issued, expires}` signed with **HMAC-SHA256** using `LBC_SESSION_SECRET`, valid 12 hours, in a cookie that is **HttpOnly** (scripts can't read it), **SameSite=Lax** and **Secure** over HTTPS.
- Tampered, forged or expired tokens are rejected. Production refuses to run without `LBC_SESSION_SECRET`.

### Authorisation (enforced on the server)

| Action | Creator | Reviewer | Marketing head |
| --- | --- | --- | --- |
| Read posts, workspace, history, brand memory | Yes | Yes | Yes |
| Invite people, change roles, deactivate or unblock accounts (accounts mode) | No | No | Yes |
| Insights and Analytics | No | Yes | Yes |
| Create, edit, decide on findings, send for review | Yes | No | No |
| Approve or request changes | No | Yes, not on own posts | Yes, not on own posts |
| Approve sensitive-topic posts | No | No | Yes |
| Upload, update or reset the brand kit; change facts, guidelines, rules; forget a learned topic; reset demo | No | No | Yes |

Posts are locked while in review and after approval. Nobody can review a post they wrote or submitted.

### Leakage and attack prevention

| Risk | How it's handled |
| --- | --- |
| Password or keys in the repo | Only hashes and secrets in Vercel environment variables; `.env*` is git-ignored |
| Database exposed to the internet | Supabase row-level security on with no public policies; only the server holds the service key; the browser never talks to Supabase |
| Session theft through scripts (XSS) | HttpOnly cookie; React escapes all text; no raw HTML rendering; Content-Security-Policy limits scripts to our site and the OCR CDN |
| Cross-site request forgery | SameSite cookie, plus every state-changing request needs the `X-LBC: 1` header, which other sites can't send without CORS (none is enabled) |
| Clickjacking | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` |
| Faking identity or role | Identity and role come only from the signed session |
| Hiding blockers before submitting | Findings are computed by the server on every save; decisions reference server-side finding IDs |
| Oversized or malformed input | Pydantic limits: post 5,000 characters, title 150, notes 500, banner text 3,000, palette 8 colours, date and number ranges |
| Brute-force login | Attempt limit counted in the database (so it holds across serverless instances; IPs stored only as hashes), per-account pause and block, slow failure and a scrypt hash |
| Error details leaking internals | Generic JSON errors; API docs pages are switched off |
| Post images leaking | OCR and image measurements run in the browser; only the read text, numbers and a 480 px preview for the reviewer are sent |
| Open redirect after login | The `next` parameter must be a same-site path |
| Data sent to AI services | None. Posts, images and brand guideline PDFs are all checked or read on our own server and in the browser, with fixed rules |
| Learning changing the rules | Brand memory is stored apart from the brand kit, learns only from human decisions, and can only add topics and suggestions, never blockers |
| Audit tampering | Users can't edit or delete events through the API. Every event stores its place (seq), the previous entry's SHA-256 fingerprint and its own, so any later change, removal or reordering is detected by `GET /api/audit/verify` and shown on History and in the PDF approval record. It detects tampering; someone with database access could rewrite the whole chain, which the head fingerprint printed in exported records exposes |
| Stale approvals | Approvals store the facts they relied on with fingerprints; an edited, removed or expired fact sends the post back to review with the reason |
| Malicious brand PDF | Size limit; PDFs with scripts, launch actions, attachments or embedded media are refused before reading |
| Losing data | The marketing head can download a backup of the brand (no password hashes) from Brand guidelines |
| Vulnerable packages | GitHub Actions run the tests and `pip-audit` on every push; Dependabot proposes updates; an hourly health check pings the live site |
| Browser extension | Read-only on Instagram and Facebook: never edits the page or posts. Uses the user's own signed-in session (no keys stored); images are read on the device; it can only reach the Live Brand Check address and the Instagram/Facebook image CDNs |

Also set on every page: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera, microphone, location off), `Cross-Origin-Opener-Policy`, HSTS. API responses are `Cache-Control: no-store`.

## 5. Trade-offs

- **Demo accounts with public passwords.** They let judges in without help but anyone can use them; `LBC_DEMO_ACCOUNTS=0` turns them off for real use. Personal accounts are our own code (scrypt hashes, one-time invites) instead of a paid identity service; there is no two-factor sign-in (team decision).
- **Rule-based brand fit and memory.** Repeatable and explainable, but the thresholds (colour share 0.25, logo match 0.6, 2 posts for a topic, 3 posts for house style) are untuned and their accuracy is not measured yet.
- **Sign-in limit in the same table.** It works across instances but adds one database read per sign-in attempt.
- **Short browser cache.** Identical page-load requests share one call and answers are reused for 2 seconds (fixed platform data for 10 minutes); any change clears it. A second browser tab can show data up to 2 seconds old.
- **`'unsafe-inline'` scripts in CSP.** Next.js needs inline scripts without a nonce setup. Nonce-based CSP is a later hardening step.
- **Single JSON table.** Fast to build and fine for demo volumes; it doesn't enforce relations or allow per-row access policies.
- **Rules instead of AI, tone included.** Every post check is repeatable, explainable and free to run. The tone check uses the kit's tone guideline plus fixed signals (avoided words, capitals, exclamation marks, hype words); it can't judge meaning, so subtle off-tone writing isn't caught.
- **Hash chain in the same table.** Detects edits but can't prevent a database administrator from rewriting everything; anchoring the head fingerprint outside the database (for example, emailing it daily) would close that gap. Two log writes at the same moment on different serverless instances could fork the chain; verify would report it.

## 6. What to revisit as it grows

- Two-factor sign-in, single sign-on for agencies, and row-level security per brand.
- Normalised tables (drafts, versions, findings, decisions, events) with foreign keys and an append-only events table.
- Nonce-based CSP (needs the Next.js 15+ upgrade, which also clears the remaining npm audit warnings) and error monitoring.
- Approvals reopen on fact edits immediately and on expiry when posts are next listed; a scheduled job would catch expiries with no one using the app.
