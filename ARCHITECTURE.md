# Live Brand Check: architecture and security design

## 1. Requirements

**Functional (the workflow from the Round 1 plan):** a creator writes a post (text, optional banner) → the server checks it against brand guidelines, approved facts and Indian ad rules → each issue is explained with its source and a fix → the creator accepts, edits or keeps the original with a reason → a reviewer approves or requests changes (sensitive topics need the marketing head) → every version and decision is recorded → insights show repeated mistakes and contested rules.

**Non-functional:** no data or secret leakage, server-enforced roles, explainable and repeatable results, under 1 second per check, works on mobile, runs on free tiers (Vercel, Supabase).

**Constraints:** two-person team, 1–3 days, judges must be able to use it unaided once given the password.

## 2. High-level design

```
 Browser (Next.js pages)                         Vercel                                   Supabase
┌──────────────────────────┐   HTTPS   ┌──────────────────────────────┐   HTTPS   ┌────────────────────┐
│ Login, Write, Review,    │──────────▶│ Next.js middleware            │           │ Postgres            │
│ Workspace, Insights      │           │  no cookie → /login           │           │  lbc_items (JSONB)  │
│                          │  /api/*   │ FastAPI (Python function)     │──────────▶│  RLS on, no public  │
│ Banner OCR (tesseract.js)│──────────▶│  1 X-LBC header check (CSRF)  │ service   │  policies           │
│  480px preview only      │  cookie + │  2 session signature + expiry │ key only  └────────────────────┘
└──────────────────────────┘  X-LBC:1  │  3 role check per endpoint    │
         ▲                             │  4 input validation (pydantic)│
         │ CDN: OCR engine + language  │  5 rule engine + fact checks  │
         │ data (jsDelivr, tessdata)   │  6 workflow + audit log       │
                                       └──────────────────────────────┘
```

**Trust boundary:** everything in the browser is untrusted. The server never accepts identity, role, findings or authorship from a request body.

### Request flow for "Check post"

1. Browser sends `PUT /api/drafts/{id}` with title, channel, text and banner measurements, plus the session cookie and `X-LBC: 1`.
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

## 3. Data model

One table, `lbc_items(id, type, data jsonb, created_at)`, with `type` one of: `guideline`, `rule`, `fact`, `meta` (workspace), `draft` (with platform, format, context, fields, input errors, versions, findings, decisions, review, campaign links), `override`, `event` (audit log). A single document table keeps the demo simple; see section 6 for when to split it.

## 4. Security design

### Authentication
- **Shared demo password**, stored only as a salted **scrypt** hash in the `LBC_PASSWORD_HASH` environment variable. The password is never in the code, the repository or the database.
- Constant-time comparison, a 0.4-second delay on failure, and **5 attempts per 10 minutes per IP** before a 429 response.
- On success the server issues a session token: `{role, name, issued, expires}` signed with **HMAC-SHA256** using `LBC_SESSION_SECRET`, valid 12 hours, in a cookie that is **HttpOnly** (scripts can't read it), **SameSite=Lax** and **Secure** over HTTPS.
- Tampered, forged or expired tokens are rejected. Production refuses to run without `LBC_SESSION_SECRET`.

### Authorisation (enforced on the server)

| Action | Creator | Reviewer | Marketing head |
| --- | --- | --- | --- |
| Read posts, workspace, insights, history | Yes | Yes | Yes |
| Create, edit, decide on findings, send for review | Yes | No | No |
| Approve or request changes | No | Yes, not on own posts | Yes, not on own posts |
| Approve sensitive-topic posts | No | No | Yes |
| Change facts, guidelines, rules; reset demo | No | No | Yes |

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
| Banner images leaking | OCR runs in the browser; only extracted text and numbers are sent |
| Open redirect after login | The `next` parameter must be a same-site path |
| Data sent to AI services | None in this version |
| Audit tampering by users | Users can't edit or delete events through the API. A hash-linked tamper-evident log is a Round 3 improvement |

Also set on every page: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera, microphone, location off), `Cross-Origin-Opener-Policy`, HSTS. API responses are `Cache-Control: no-store`.

## 5. Trade-offs

- **One shared password vs. personal accounts.** A shared password lets judges in with one secret but can't tell people apart; anyone with it can choose any role. Personal accounts (Supabase Auth) are the production step.
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
