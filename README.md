# Live Brand Check

Pre-publication brand and ad-claim checker for Indian marketing teams. A creator pastes a post (and optionally a banner), the system checks it against the organisation's brand guidelines, approved facts and Indian advertising rules, explains every issue with its source, suggests a fix, and a human reviewer makes the final decision. Every action is recorded.

Team RaaGa: B.V. Sri Gautam and K. Sai Rajasree.

## Try it (judges)

0. Sign in with the password given in our submission form, and choose who you are (you can switch later from the header).
1. A sample post for a fictional coaching institute is already loaded. Press **Check post**.
2. Each issue is underlined in the post and listed on the right with why, the source (brand guideline, approved fact or regulation) and a suggested fix. **Accept fix**, **Edit**, or **Keep original** with a reason.
3. When no blockers remain, press **Send for review**.
4. In the header, switch **Acting as** to *Arjun (brand reviewer)*, open **Review**, and approve or request changes.
5. Open **History** to see every version and decision, **Brand workspace** to change a fee or rule (the next check uses it), and **Insights** for repeated mistakes and rules people keep overriding.

The sample "Diwali greeting" in Review shows sensitive-topic routing: only *Meera (marketing head)* can approve it.

All data is fictional demo data. **Brand workspace → Reset demo data** restores the starting state.

## How it works

- **Rule engine** (`api/_lbc/engine.py`): exact, explainable rules from the brand guide and Indian regulations: CCPA Guidelines for Prevention of Misleading Advertisement in Coaching Sector 2024 (no "100% selection" claims; disclose course, duration and paid/free for result claims), ASCI Code Chapter I (substantiation), ASCI influencer disclosure, Drugs and Magic Remedies Act, plus brand tone, terminology and sensitive-topic routing.
- **Fact checks**: fees, offers and result claims in the text are compared with the approved-facts table, including validity dates. Outcomes: matches approved fact, outdated fact, evidence conflict, or couldn't verify.
- **Banner checks** (`lib/banner.js`): OCR with tesseract.js in the browser (only a small 480 px preview is saved for the reviewer), lowest text contrast against WCAG 4.5:1, main colours against the brand palette, alt text. The text read from the banner goes through the same rule and fact checks.
- **Workflow** (`api/index.py`): drafts, versions, creator decisions (rejecting a flag needs a reason), submission blocked while blockers are open, reviewer approve / request changes, sensitive posts need the marketing head, append-only audit events.
- **Insights**: rules fired per post, fixes accepted, overrides with reasons, and rules overridden in at least 40% of posts flagged for investigation.

## Stack

Next.js 14 + Tailwind CSS (frontend), FastAPI on Python (API, deployed as a Vercel Python function), Supabase Postgres (storage), tesseract.js (in-browser OCR). No AI service is used in this version.

## Run locally

```bash
npm install
pip install -r requirements.txt uvicorn
export LBC_PASSWORD_HASH="$(python api/_lbc/auth.py 'your-password')"
npm run api      # FastAPI on :8000 (stores data in /tmp/lbc-data.json)
npm run dev      # Next.js on :3000, proxies /api to :8000
python -m pytest -q tests
```

## Deploy (Vercel + Supabase)

1. Create a Supabase project and run `supabase.sql` in its SQL editor.
2. Import this repository into Vercel (framework: Next.js).
3. Environment variables (Vercel → Project → Settings → Environment Variables). Never commit these:
   - `LBC_PASSWORD_HASH`: run `python api/_lbc/auth.py 'your-password'` and paste the output. The password itself is never stored.
   - `LBC_SESSION_SECRET`: a long random string, for example the output of `python -c "import secrets; print(secrets.token_hex(32))"`.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project settings → API). Required: without them each serverless instance keeps its own temporary data.
4. Deploy. The first request seeds the demo workspace.

## Security

See ARCHITECTURE.md for the full design: hashed password, signed HttpOnly session cookie, server-enforced roles (no self-approval), CSRF header, input limits, security headers, and a database reachable only from the server.

## Disclosures

- Demo data (Northstar Civils Academy, students, fees) is fictional.
- Open-source libraries: Next.js, React, Tailwind CSS, FastAPI, httpx, tesseract.js.
- External services: Supabase (storage), jsDelivr/tessdata CDN (OCR engine and language data loaded by the browser).
- AI assistance in building the project: see SUBMISSION.md.

## Future scope

Planned for the final round:
- **AI tone and messaging check**: retrieves the most relevant brand guidelines, masks emails, phone numbers and confidential names before any text leaves the server, and shows a finding only if it quotes the post and cites a real guideline.
- **Browser plugin for real-time checking**: a Chrome extension that checks captions as you type them on Instagram and Facebook, Grammarly-style, and checks images and banners as you attach them.
- **Evidence-bound approvals and trusted history**: approvals reopen when a fact they relied on changes; side-by-side comparison of versions; a tamper-proof, hash-linked audit log; and a downloadable PDF approval record.

Later: guideline compiler (brand PDF to rules), measured accuracy on a labelled test set, sign-in with real accounts, DOCX and PDF input, logo matching, Hindi and Telugu.
