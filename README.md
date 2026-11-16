# Live Brand Check

Live Brand Check checks marketing posts before they are published. A marketing head uploads the brand's guideline PDF once. Creators then write posts (text, images, banners) for Instagram, LinkedIn, Facebook, WhatsApp or a website. Each post is checked against the brand kit, the brand's approved facts (fees, offers, results, with their dates) and Indian advertising rules. Every problem is explained with its source and a suggested fix. A human reviewer approves the post or sends it back, and everything is recorded.

It never publishes anything and never changes a post by itself: people decide. No AI service is used; all checks are fixed, explainable rules.

Team RaaGa: B.V. Sri Gautam and K. Sai Rajasree. All demo data (Northstar Civils Academy, Sunrise Tutorials, students, fees) is fictional.

---

## Try it online

**https://live-brand-check.vercel.app**

Sign in with one of the demo accounts shown on the sign-in page (press **Use**, then **Sign in**):

| Person | Role | Email | Password |
|---|---|---|---|
| Priya | Creator: writes posts | priya@xyz.com | Priya@_1 |
| Arjun | Reviewer: approves or sends back | arjun@xyz.com | Arjun@_1 |
| Meera | Marketing head: brand kit, team, sensitive posts | meera@xyz.com | Meera@_1 |

**Quickest tour:** on **Overview**, press **Start the guided demo**. A guide card follows you through six steps and switches person for you.

**Or try the main journey yourself (about 3 minutes):**

1. As **Priya**, open **Content checker** and pick **Claims that break ad rules** under *Try a ready-made example* (or write your own post and press **Check post**).
2. Read the results on the right: each issue says what is wrong, why, its source and a fix. Press **Accept fix** on each critical issue, or **Keep original** with a reason.
3. When the panel says **Ready for review**, press **Send for review**.
4. Press **Try the reviewer side: open as Arjun** (or sign out and sign in as Arjun). On **Review & approvals** the post is already open: press **Approve**, or write a comment and press **Request changes**.
5. Back as Priya, the decision appears in the bell at the top right and on **Review & approvals**.

A step bar at the top of the Content checker always shows where the post is in this process.

---

## Run it on your computer

### 1. What you need

- **Git**
- **Node.js 18.17 or newer** (20 recommended): https://nodejs.org
- **Python 3.11 or newer**: https://www.python.org (on Windows, tick *Add Python to PATH* when installing)
- **Google Chrome**, only for the browser extension

Check them:

```bash
git --version
node --version
python --version
```

On Windows, if `python` isn't found, use `py` instead of `python` in the commands below.

### 2. Get the code

```bash
git clone https://github.com/7Knight7/CodeTitan.git
cd CodeTitan
```

### 3. Install

Website packages:

```bash
npm install
```

API packages, plus the local server (`uvicorn`) and the test runner (`pytest`):

```bash
python -m pip install -r requirements.txt uvicorn pytest
```

(Optional: to keep these separate from your other Python projects, first create and activate a virtual environment: `python -m venv .venv`, then `.venv\Scripts\activate` on Windows or `source .venv/bin/activate` on macOS and Linux.)

### 4. Choose how people sign in (optional)

Without any settings, the app runs in **role-picking mode**: the sign-in page asks who you are, with no password. To use **personal accounts with passwords** (the demo accounts above, invitations, the Team page), copy the example settings file:

macOS and Linux:

```bash
cp .env.example .env
```

Windows (PowerShell):

```bash
Copy-Item .env.example .env
```

`.env` is git-ignored. It also lets you change where local data is stored; see the comments inside.

### 5. Start the app

Use two terminals, both in the `CodeTitan` folder.

Terminal 1, the API on port 8000:

```bash
npm run api
```

Terminal 2, the website on port 3000:

```bash
npm run dev
```

Open **http://localhost:3000** and sign in. The first start creates a sample brand (Northstar Civils Academy) and a second demo brand, with example posts, so everything can be tried straight away. Local data is kept in `/tmp/lbc-data.json` (on Windows `C:\tmp\lbc-data.json`); delete that file to start fresh, or press **Start the demo over** on Overview.

### 6. Run the tests

```bash
python -m pytest -q tests
```

All 44 tests should pass in about a minute.

### Troubleshooting

| Problem | What to do |
|---|---|
| `Port 8000 (or 3000) is already in use` | Another copy is still running. Close its terminal (or stop it with Ctrl+C) and start again. Run only one API and one `npm run dev` at a time. |
| Pages show "404" or errors right after you change code | Stop `npm run dev` (Ctrl+C) and start it again. |
| Sign-in page asks to pick a role, not for an email | You're in role-picking mode: do step 4, then restart `npm run api`. |
| "Too many attempts" when signing in | 5 wrong tries from one device pause sign-in for 10 minutes; 3 wrong passwords on one account pause it for 15 minutes. Wait, or restart with a fresh data file. |
| Reading text in an image takes a while the first time | The reader downloads its language data once (internet needed). Later images are faster. |

---

## Chrome extension (checks posts inside Instagram and Facebook)

Inside the app, open **Chrome extension** in the sidebar. It has a download button, step-by-step install instructions with copy buttons, a live "installed and connected" check, and a try-out on Instagram with a sample banner and caption. The extension only reads the page; it never edits or posts anything. Details: [extension/README.md](extension/README.md).

---

## Deploy your own copy (Vercel + Supabase, free plans)

1. **Database:** create a project at https://supabase.com, open its SQL editor and run [`supabase.sql`](supabase.sql).
2. **Hosting:** at https://vercel.com, import this GitHub repository (framework: Next.js). The Python API in `api/index.py` is deployed automatically next to the website.
3. **Settings:** in Vercel, Project → Settings → Environments → Production → Environment Variables. Never put these in the code.

   | Name | Value |
   |---|---|
   | `LBC_SESSION_SECRET` | Required. A long random value, e.g. the output of `python -c "import secrets; print(secrets.token_hex(32))"` |
   | `SUPABASE_URL` | Required. From Supabase: Project settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Required. From the same page. Keep it secret |
   | `LBC_AUTH_MODE` | `accounts` for personal accounts with passwords (leave unset for role picking) |
   | `LBC_SETUP_CODE` | Recommended with accounts: a private code that protects the first-time `/setup` page |
   | `LBC_DEMO_ACCOUNTS` | `0` to switch the demo accounts off (do this for real use) |

4. **Deploy.** Every push to `main` deploys again. Check `https://<your-site>/api/health`: it should say `"ok": true` and `"storage": "supabase"`.
5. **With accounts and no demo accounts:** open `/setup`, enter the setup code and create the first marketing head, then invite the team from **Team**.

GitHub runs the tests and security scans on every push ([.github/workflows](.github/workflows)) and checks the live site every hour. The deployment and security guide (limits, risks, and what to switch off after a demo) is kept with the team's documents.

---

## What's inside

| Folder or file | What it is |
|---|---|
| `app/` | Website pages (Next.js 14): content checker, review, brand guidelines, insights, analytics, team, extension guide |
| `components/`, `lib/` | Shared interface parts; `lib/image.js` reads text, contrast and colours in images in the browser |
| `api/index.py` | The API (FastAPI): sign-in, posts, checks, reviews, brands, team |
| `api/_lbc/engine.py` | Advertising rules and checks of fees, offers and results against approved facts |
| `api/_lbc/brandkit.py`, `brandapply.py` | Reads a brand guideline PDF into a draft brand kit that a person confirms |
| `api/_lbc/platforms.py` | Per-platform fields, documented limits and checks |
| `api/_lbc/brandfit.py`, `memory.py`, `tone.py` | "Is this post for this brand?", what the brand learned from approved posts, and the tone check |
| `api/_lbc/accounts.py`, `auth.py`, `brands.py` | Personal accounts, sessions and passwords, and multi-brand workspaces |
| `api/_lbc/audit.py`, `pdf.py` | Hash-linked audit log, approvals tied to facts, and the PDF approval record |
| `api/_lbc/store.py` | Storage: a local JSON file, or Supabase when its settings are present |
| `extension/` | The Chrome extension |
| `tests/test_app.py` | The automated tests |
| `ARCHITECTURE.md`, `SUBMISSION.md`, `DEMO_SCRIPT.md` | Design and security notes, the competition submission, and the demo video script |

**How a check works:** the browser reads the text in each image (it never uploads the full image); the API checks every text field and image against the active brand kit's rules and approved facts, the Indian advertising rules (CCPA coaching guidelines 2024, ASCI Code, ASCI influencer disclosure, Drugs and Magic Remedies Act), the platform's documented limits, brand fit and tone. Every finding is computed on the server and names its source; anything that can't be checked is shown as "Couldn't verify". More in [ARCHITECTURE.md](ARCHITECTURE.md).

## Security in short

Signed, HttpOnly session cookies; roles, creator–reviewer pairing and brand membership enforced on the server; nobody approves their own post; passwords stored only as scrypt hashes; 3 wrong passwords pause an account for 15 minutes and 5 block it; a sign-in limit per device shared across servers; a CSRF header on every change; size limits on every input; security headers on every page; the database reachable only from the server; a tamper-evident audit log; and a backup download for the marketing head. The demo accounts' passwords are public on purpose: switch them off with `LBC_DEMO_ACCOUNTS=0` for real use.

## Disclosures

- Open-source libraries: Next.js, React, Tailwind CSS, FastAPI, pypdf, httpx, tesseract.js.
- External services: Supabase (storage) and the jsDelivr and tessdata CDNs (the image-reading engine and its language data, loaded by the browser). No AI or paid service is called.
- AI assistance in building the project: see SUBMISSION.md.
