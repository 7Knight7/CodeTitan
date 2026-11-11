# Live Brand Check

Pre-publication brand and ad-claim checker for Indian marketing teams. The marketing head uploads the brand's guideline PDF once; creators then upload post images (and an optional caption) for any platform. The system checks each post against the brand kit, approved facts and Indian advertising rules, says plainly when a post doesn't belong to the brand at all, explains every issue with its source, suggests a fix, and a human reviewer makes the final decision. Every action is recorded, and the app learns from approved posts and reviews without ever changing the brand kit.

Team RaaGa: B.V. Sri Gautam and K. Sai Rajasree.

## Try it (judges)

**Live demo: https://live-brand-check.vercel.app**

No password and no setup: a sample brand kit (Northstar Civils Academy, fictional) is already loaded. Choose who you are on the sign-in page; you can switch person any time from the account menu in the top right.

**Guided demo.** After signing in you land on **Overview**, where six steps walk you through the product. Each step switches to the right person and opens the right screen:

1. See what gets caught: a post full of risky claims, each issue underlined with its source.
2. Fix a post in one click (**Accept fix** adds `#ad`) and **Send for review**.
3. Approve it as **Arjun (brand reviewer)**.
4. See a sensitive post (a festival greeting) that only **Meera (marketing head)** can approve.
5. Spot repeated mistakes in **Insights** and **Analytics**.
6. Import a brand kit from a PDF: **Read the sample PDF** in one click, review what was read, and activate it.

**Ready-made examples.** **Content checker** has nine one-click examples: claims that break ad rules, a fee and results not on record, a paid post without `#ad`, a banner with problems (its text is read in your browser), a post for another brand, a health claim, an offer that has ended, a festival greeting, and a post that is ready to send. Each one fills in a real post and runs the real check.

**Your own input.** Everything also works by hand: write any post, upload your own images, or import your own brand-kit PDF in **Brand guidelines**. **Start the demo over** (on Overview) restores the sample data.

Posts on sensitive topics can only be approved by Meera. Nobody can approve their own post. Demo data is fictional.

## How it works

- **Brand kit from a PDF** (`api/_lbc/brandkit.py`, `brandapply.py`): a pattern reader (always on, no AI) reads colours, fonts, logo rule, required text, banned words, tone, positioning, sensitive topics, fees and offers with dates, and the brand's topics. An optional AI reader (only when `ANTHROPIC_API_KEY` is set) adds more, such as wrong versions of the brand name, but every AI item must quote the PDF. A person reviews everything before it goes live. Indian ad regulations always stay on.
- **Brand kit lifecycle**: one brand at a time. Update the live kit (preview of changes, then apply; open posts are re-checked) or reset it for a different brand (earlier posts stay as read-only history, grouped by brand).
- **Platform Intelligence Engine** (`api/_lbc/platforms.py`): per platform, format and context, the fields to show and the checks to run in five layers: platform limits (only documented ones, with source), Indian ad regulations, brand governance, approved facts, visuals.
- **Rule engine and fact checks** (`api/_lbc/engine.py`): exact, explainable rules (CCPA coaching-sector guidelines 2024, ASCI Code, ASCI influencer disclosure, Drugs and Magic Remedies Act, plus the brand kit's words and names). Fees, offers and results are compared with approved facts and their validity dates.
- **Image checks** (`lib/image.js`, in the browser): OCR with tesseract.js, text contrast against WCAG 4.5:1, palette and share of brand colours, logo match. Only the read text, measurements and a 480 px preview leave the browser.
- **Brand fit** (`api/_lbc/brandfit.py`): combines brand name, logo, brand colours, other brands' names, the brand's topics and unapproved offers into one answer: fits, partly on brand, or "not a post for this brand" (a blocker). Every reason cites its source.
- **Brand memory** (`api/_lbc/memory.py`): learns from approved posts (topics, house style), reviewer change requests, fixes creators accept (repeat mistakes) and overrides with reasons (accepted exceptions). It only adds topics and suggestions, never blockers, and never changes the brand kit. The marketing head can make it forget a topic.
- **Workflow** (`api/index.py`): drafts with versions, creator decisions (keeping flagged text needs a reason), sending blocked while blockers are open, reviewer approve / request changes, sensitive posts need the marketing head, append-only audit events.
- **Insights and Analytics**: repeat issues, rules overridden in at least 40% of posts, blockers, warnings, suggestions and checks passed, for the current brand kit or all history by brand.

## Stack

Next.js 14 + Tailwind CSS (frontend), FastAPI on Python (API, deployed as a Vercel Python function), Supabase Postgres (storage), tesseract.js (in-browser OCR). Post checks use no AI; the only optional AI use is reading the brand guideline PDF.

## Run locally

```bash
npm install
pip install -r requirements.txt uvicorn
npm run api      # FastAPI on :8000 (stores data in /tmp/lbc-data.json)
npm run dev      # Next.js on :3000, proxies /api to :8000
python -m pytest -q tests
```

Run only one `npm run dev` per folder; two dev servers sharing `.next` break the pages. To turn the password back on, set `LBC_REQUIRE_PASSWORD=1` and `LBC_PASSWORD_HASH="$(python api/_lbc/auth.py 'your-password')"`.

## Deploy (Vercel + Supabase)

1. Create a Supabase project and run `supabase.sql` in its SQL editor.
2. Import this repository into Vercel (framework: Next.js).
3. Environment variables (Vercel → Project → Settings → Environment Variables). Never commit these:
   - `LBC_SESSION_SECRET`: a long random string, for example the output of `python -c "import secrets; print(secrets.token_hex(32))"`.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project settings → API). Required: without them each serverless instance keeps its own temporary data.
   - Optional: `LBC_REQUIRE_PASSWORD=1` with `LBC_PASSWORD_HASH` (password sign-in), `ANTHROPIC_API_KEY` (AI reader for brand PDFs).
4. Deploy. The first request seeds the demo workspace.

## Security

See ARCHITECTURE.md: signed HttpOnly session cookie, server-enforced roles (no self-approval), optional hashed password, CSRF header, input limits, security headers, and a database reachable only from the server. The judges' demo runs without a password; turn it back on before any real use.

## Disclosures

- Demo data (Northstar Civils Academy, Sunrise Tutorials, students, fees) is fictional.
- Open-source libraries: Next.js, React, Tailwind CSS, FastAPI, pypdf, httpx, tesseract.js.
- External services: Supabase (storage), jsDelivr/tessdata CDN (OCR engine and language data loaded by the browser), Anthropic API (only if `ANTHROPIC_API_KEY` is set, for reading brand PDFs).
- AI assistance in building the project: see SUBMISSION.md.

## Future scope

Planned for the final round:
- **AI tone and messaging check**: retrieves the most relevant brand guidelines, masks emails, phone numbers and confidential names before any text leaves the server, and shows a finding only if it quotes the post and cites a real guideline.
- **Browser plugin for real-time checking**: a Chrome extension that checks captions as you type them on Instagram and Facebook and checks images as you attach them.
- **Evidence-bound approvals and trusted history**: approvals reopen when a fact they relied on changes; side-by-side comparison of versions; a tamper-proof, hash-linked audit log; and a downloadable PDF approval record.

Later: measured accuracy on a labelled test set, sign-in with real accounts, industry-specific regulation packs, Hindi and Telugu.
