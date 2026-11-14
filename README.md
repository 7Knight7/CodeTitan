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

- **Brand kit from a PDF** (`api/_lbc/brandkit.py`, `brandapply.py`): a pattern reader (always on, no AI) reads colours, fonts, logo rule, required text, banned words, tone, positioning, sensitive topics, fees and offers with dates, and the brand's topics. No AI is used; every item keeps the page and words it came from. A person reviews everything before it goes live. Indian ad regulations always stay on.
- **Multi-brand workspaces** (`api/_lbc/brands.py`, `components/BrandSwitcher.jsx`): an agency works on several brands from one login. Each brand has its own brand kit, approved facts, rules, posts, review queue, brand memory, insights, analytics and audit log (a namespace per brand in the store; the first brand uses the original names, so older data needs no migration). Marketing heads see every brand, switch from the Workspace box in the sidebar and can add a brand (it starts with the Indian ad rules only). Creators and reviewers work on one or more brands chosen by the marketing head (on invite, editable on Team) and only ever see those; the brand cookie is checked against membership on every request. Creators and reviewers get a read-only My team page (the marketing head, plus the creators a reviewer reviews or a creator's reviewers on the open brand). First run: existing data becomes the first brand and a second fictional demo brand is added (Northstar sample, or Sunrise Tutorials read from the sample PDF); demo Priya and Arjun work on both. "Start the demo over" restores only the sample brand.
- **Brand kit lifecycle** (per brand): update the live kit (preview of changes, then apply; open posts are re-checked) or reset it for a different brand (earlier posts stay as read-only history, grouped by brand).
- **Platform Intelligence Engine** (`api/_lbc/platforms.py`): per platform, format and context, the fields to show and the checks to run in five layers: platform limits (only documented ones, with source), Indian ad regulations, brand governance, approved facts, visuals.
- **Rule engine and fact checks** (`api/_lbc/engine.py`): exact, explainable rules (CCPA coaching-sector guidelines 2024, ASCI Code, ASCI influencer disclosure, Drugs and Magic Remedies Act, plus the brand kit's words and names). Fees, offers and results are compared with approved facts and their validity dates.
- **Image checks** (`lib/image.js`, in the browser): OCR with tesseract.js, text contrast against WCAG 4.5:1, palette and share of brand colours, logo match. Only the read text, measurements and a 480 px preview leave the browser.
- **Brand fit** (`api/_lbc/brandfit.py`): combines brand name, logo, brand colours, other brands' names, the brand's topics and unapproved offers into one answer: fits, partly on brand, or "not a post for this brand" (a blocker). Every reason cites its source.
- **Brand memory** (`api/_lbc/memory.py`): learns from approved posts (topics, house style), reviewer change requests, fixes creators accept (repeat mistakes) and overrides with reasons (accepted exceptions). It only adds topics and suggestions, never blockers, and never changes the brand kit. The marketing head can make it forget a topic.
- **Workflow** (`api/index.py`): drafts with versions, creator decisions (keeping flagged text needs a reason), sending blocked while blockers are open, reviewer approve / request changes, sensitive posts need the marketing head, append-only audit events.
- **Insights and Analytics**: repeat issues, rules overridden in at least 40% of posts, blockers, warnings, suggestions and checks passed, for the current brand kit or all history by brand.
- **Tone and messaging check** (`api/_lbc/tone.py`, fixed rules, no AI, no key, free): runs when the brand kit has a tone or voice guideline and flags words that guideline says to avoid (quoted in it, such as 'hurry'), several words in capitals, too many exclamation marks, and hype or pressure words from a fixed list. Every finding quotes the post, cites the tone guideline and is a suggestion, never a blocker. It is repeatable and explainable but doesn't understand meaning, and its accuracy isn't measured yet. If the kit has no tone guideline, the composer says tone wasn't checked.
- **Evidence-bound approvals** (`api/_lbc/audit.py`): an approval records the approved facts it relied on, with a fingerprint of each. If one of them is edited, removed or expires, the post goes back to review with the reason (shown on Review and History).
- **Trusted history**: compare any two versions side by side (words added and removed, per field and per image text); every audit entry is fingerprinted with SHA-256 and linked to the one before, and the History page re-checks the whole chain (`GET /api/audit/verify`); approved posts have a downloadable PDF approval record (`GET /api/drafts/{id}/record.pdf`) with the approved text, evidence, decisions, the post's audit trail and the log's state at export.
- **Chrome extension** (`extension/`, see `extension/README.md`): checks captions, images and banners in the Instagram and Facebook composer as you write, using your Live Brand Check sign-in and the same server-side checks. It only reads the page and shows a panel; it never edits or posts.

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
   - Sign-in mode (pick one):
     - nothing set: **demo mode**, people pick a role, no password (for the judges);
     - `LBC_REQUIRE_PASSWORD=1` with `LBC_PASSWORD_HASH`: one shared password;
     - `LBC_AUTH_MODE=accounts` with `LBC_SETUP_CODE` (any long random text): **personal accounts**. Open `/setup`, enter the setup code and create the first account (the marketing head), then invite the team from **Team**. Three demo accounts for the judges (meera@xyz.com, priya@xyz.com, arjun@xyz.com, passwords shown on the sign-in page) are created automatically in accounts mode; they get the 15-minute pause but are never blocked, and their password, role and access can't be changed. Turn them off for real use with `LBC_DEMO_ACCOUNTS=0`. Creators and reviewers are paired (several each way): inviting a creator means choosing their reviewer(s), inviting a reviewer means choosing the creator(s) they look after (optional only while nobody exists to choose), and pairings can be edited on Team. Only a creator's paired, active reviewers or the marketing head can approve or send back that creator's posts; posts whose creator has no active paired reviewer can be reviewed by any reviewer. Demo Priya is paired with demo Arjun. 3 wrong passwords pause that account's sign-in for 15 minutes; 2 more block it until a marketing head unblocks it on Team (or from the server: `python api/_lbc/accounts.py unblock <email>`). The count is stored on the account, so it holds across server instances.
4. Deploy. The first request seeds the demo workspace.

## Security

See ARCHITECTURE.md: signed HttpOnly session cookie, server-enforced roles (no self-approval), optional hashed password, CSRF header, input limits, security headers, and a database reachable only from the server. The judges' demo runs without a password; turn it back on before any real use.

## Disclosures

- Demo data (Northstar Civils Academy, Sunrise Tutorials, students, fees) is fictional.
- Open-source libraries: Next.js, React, Tailwind CSS, FastAPI, pypdf, httpx, tesseract.js.
- External services: Supabase (storage), jsDelivr/tessdata CDN (OCR engine and language data loaded by the browser). No AI or other paid service is called.
- AI assistance in building the project: see SUBMISSION.md.

## Future scope

The three Round 3 improvements (tone check, Chrome extension, evidence-bound approvals and trusted history) are built; see How it works. Still to do: test the extension in real Chrome on live Instagram and Facebook composers, and publish it to the Chrome Web Store.

Later: measured accuracy on a labelled test set, sign-in with real accounts, industry-specific regulation packs, Hindi and Telugu.
