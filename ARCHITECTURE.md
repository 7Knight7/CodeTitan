# Live Brand Check: architecture and security design

## 1. Requirements

**Functional (the workflow from the Round 1 plan):** the marketing head turns the brand guideline PDF into a reviewed brand kit → a creator prepares a post for a platform, format and context (images plus text) → the server checks it against the brand kit, approved facts and Indian ad rules, and says whether it belongs to the brand at all → each issue is explained with its source and a fix → the creator accepts, edits or keeps the original with a reason → a reviewer approves or requests changes (sensitive topics need the marketing head) → every version and decision is recorded → insights show repeated mistakes and contested rules.

**Non-functional:** no data or secret leakage, server-enforced roles, explainable and repeatable results, under 1 second per check, works on mobile, runs on free tiers (Vercel, Supabase).

**Constraints:** two-person team, 1–3 days, judges must be able to use it unaided. For the judges' demo the password is off (sign-in is a role choice); `LBC_REQUIRE_PASSWORD=1` turns it back on.

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

- **Reading the PDF**: a pattern reader (always on, no AI) reads HEX colours, fonts, the logo rule, "must include" text, banned words (quoted words and "words we don't use" lists), tone and positioning lines, named sensitive topics, rupee fees and percent offers with dates, the brand name (without words like "Brand Toolkit"), and the brand's topics (its hashtags and often-repeated words). When `ANTHROPIC_API_KEY` is set an AI reader adds items, and any AI item whose quote is not found in the PDF is dropped. Every item keeps its page and quote.
- **Human confirmation**: the marketing head edits the draft kit on Brand workspace and activates it. Only then does it become live guidelines, rules and facts. Indian regulatory rules are always added.
- **Lifecycle (one brand at a time)**: activation is refused while a kit is live. `/api/brandkit/update` shows a change preview, then applies it, keeping rule and fact ids for unchanged items and re-checking posts not yet approved. `/api/brandkit/reset` (brand name typed to confirm) removes the kit; its posts are archived with `kit_id` and `kit_name`, never deleted, and shown read-only under All history by brand.

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

## 3. Data model

One table, `lbc_items(id, type, data jsonb, created_at)`, with `type` one of: `guideline`, `rule`, `fact`, `meta` (workspace and the live brand kit), `draft` (with platform, format, context, fields, input errors, versions, findings, decisions, review, campaign links, `kit_id`, `kit_name`, `archived`), `override`, `event` (audit log), `memory` (brand memory per kit). A single document table keeps the demo simple; see section 6 for when to split it.

## 4. Security design

### Authentication
- **Judges' demo**: no password; the sign-in page only asks for a role, and the server still issues the signed session below. Turn the password on before any real use with `LBC_REQUIRE_PASSWORD=1`.
- **Shared password** (when on), stored only as a salted **scrypt** hash in the `LBC_PASSWORD_HASH` environment variable. The password is never in the code, the repository or the database.
- Constant-time comparison, a 0.4-second delay on failure, and **5 attempts per 10 minutes per IP** before a 429 response.
- On success the server issues a session token: `{role, name, issued, expires}` signed with **HMAC-SHA256** using `LBC_SESSION_SECRET`, valid 12 hours, in a cookie that is **HttpOnly** (scripts can't read it), **SameSite=Lax** and **Secure** over HTTPS.
- Tampered, forged or expired tokens are rejected. Production refuses to run without `LBC_SESSION_SECRET`.

### Authorisation (enforced on the server)

| Action | Creator | Reviewer | Marketing head |
| --- | --- | --- | --- |
| Read posts, workspace, history, brand memory | Yes | Yes | Yes |
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
| Brute-force login | Rate limit, slow failure and a scrypt hash |
| Error details leaking internals | Generic JSON errors; API docs pages are switched off |
| Post images leaking | OCR and image measurements run in the browser; only the read text, numbers and a 480 px preview for the reviewer are sent |
| Open redirect after login | The `next` parameter must be a same-site path |
| Data sent to AI services | Posts never. Only the text of an uploaded brand guideline PDF, and only when `ANTHROPIC_API_KEY` is set; AI items without a matching quote from the PDF are dropped |
| Learning changing the rules | Brand memory is stored apart from the brand kit, learns only from human decisions, and can only add topics and suggestions, never blockers |
| Audit tampering by users | Users can't edit or delete events through the API. A hash-linked tamper-evident log is a Round 3 improvement |

Also set on every page: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera, microphone, location off), `Cross-Origin-Opener-Policy`, HSTS. API responses are `Cache-Control: no-store`.

## 5. Trade-offs

- **No password for the demo, shared password otherwise, vs. personal accounts.** Role choice (or one shared password) lets judges in easily but can't tell people apart; anyone can choose any role. Personal accounts (Supabase Auth) are the production step.
- **Rule-based brand fit and memory.** Repeatable and explainable, but the thresholds (colour share 0.25, logo match 0.6, 2 posts for a topic, 3 posts for house style) are untuned and their accuracy is not measured yet.
- **Login rate limit per server instance.** Serverless instances don't share memory, so the limit is per instance. A Postgres-backed counter would make it global.
- **`'unsafe-inline'` scripts in CSP.** Next.js needs inline scripts without a nonce setup. Nonce-based CSP is a later hardening step.
- **Single JSON table.** Fast to build and fine for demo volumes; it doesn't enforce relations or allow per-row access policies.
- **Rules instead of AI.** Every result is repeatable and explainable; tone checks are planned for Round 3.

## 6. What to revisit as it grows

- Personal accounts with Supabase Auth, organisation workspaces, and row-level security per organisation.
- Normalised tables (drafts, versions, findings, decisions, events) with foreign keys and an append-only events table.
- Hash-linked audit log and approval record export (Round 3).
- Global rate limiting, nonce-based CSP, and error monitoring.
- Background jobs for re-checking approved posts when a fact changes (Round 3).
