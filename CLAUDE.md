# Live Brand Check (Team RaaGa): notes for Claude Code

Hackathon project (problem statement by Inkloom AI, event by We Code Coders). Team: B.V. Sri Gautam (AI and backend lead), K. Sai Rajasree (frontend, vision and product lead). Currently in Round 2 (working product). Read SUBMISSION.md and ARCHITECTURE.md first.

## What it does
Pre-publication brand and ad-claim checker for Indian teams. Image-first:
1. Marketing head uploads the brand's guideline PDF → `api/_lbc/brandkit.py` extracts a draft kit (pattern reader always; AI reader if `ANTHROPIC_API_KEY` is set, every AI item must quote the PDF) → human reviews and edits on /workspace → `brandapply.py` turns it into live guidelines, rules and facts. Indian regulatory rules (R1 guarantees, R2 superlatives, R6 health claims, R8 #ad disclosure) always stay on.
2. Creator uploads up to 5 post images (+ optional caption). `lib/image.js` runs in the browser: OCR with tesseract.js (normal + inverted pass), contrast, palette, share of brand colours, logo match (NCC). The full-size image never leaves the browser; only text, measurements and a small 480 px JPEG preview (so reviewers can see the post) go to the API. Checks use only the text and measurements.
3. Server (`api/index.py` → `engine.py`) checks image text and caption against rules and approved facts (with validity dates), plus image findings (contrast, alt text, brand colours, logo, required text). Every finding has a source.
4. Creator accepts / edits / keeps original with a reason → sends for review → reviewer approves or requests changes; sensitive topics need the marketing head; nobody approves their own post. Versions and audit events recorded. /insights shows repeat issues and rules overridden in ≥40% of posts.

## Non-negotiable rules (agreed with the team)
- Human approves every change; nothing auto-applied or auto-published. Sensitive topics go to a senior human.
- Every finding cites its source (guideline, approved fact, brand-kit page, or named regulation). Missing evidence shows as "Couldn't verify", never silently dropped.
- Post checks are rule- and fact-based (no AI judging posts in Round 2). AI tone checks, a real-time Chrome plugin for Instagram/Facebook, and version-history upgrades (side-by-side diff, hash-linked tamper-proof log, PDF approval record) are the three Round 3 improvements.
- Security: never commit secrets or the real password. Password is stored only as an scrypt hash in `LBC_PASSWORD_HASH`. For the judges' demo the password is OFF: sign-in is role choice only unless `LBC_REQUIRE_PASSWORD=1` is set (then `LBC_PASSWORD_HASH` is required). Turn it back on before any real use. Identity and role come only from the signed session cookie; findings are always computed server-side. Keep the X-LBC header check, input limits and security headers.
- Never claim unmeasured accuracy. Use fictional demo data only.
- Product decisions belong to the team; ask before changing scope.

## Run locally
```
npm install
pip install -r requirements.txt uvicorn
export LBC_PASSWORD_HASH="$(python api/_lbc/auth.py '<password>')"
npm run api      # FastAPI :8000 (data in /tmp/lbc-data.json)
npm run dev      # Next.js :3000, proxies /api
python -m pytest -q tests
```
Deploy: Vercel (Next.js + `api/index.py` Python function) with Supabase (run `supabase.sql`). Env: LBC_PASSWORD_HASH, LBC_SESSION_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional ANTHROPIC_API_KEY.

## Status and next steps
Done: everything above; 26 tests pass; Platform Intelligence Engine (`api/_lbc/platforms.py`: platforms, formats, contexts, input schemas, 5-layer validation profiles, adaptation; composer in `app/page.jsx`, previews in `components/PostPreview.jsx`). Only add platform limits the platform documents publicly, with the source; rule and guideline codes (R1, G1) are internal and not shown in the UI; 'Brand not visible' is a blocker; brand-fit verdict (`api/_lbc/brandfit.py`, rule-based): combines brand name, logo, colour share, other brands' names (kit wrong names + earlier kits' brands), brand topics (`keywords` in the kit, pattern-read from the PDF and editable as "What the brand talks about") and unapproved offers; verdict no = blocker "Not a post for {brand}" + big red banner (composer, Review, history), weak = amber banner only; reviewers see image previews; creators see reviewer change requests in a top-right note on every page and a 'Must do now' warning on /review; /analytics shows blockers, warnings, suggestions and checks passed; "Send for review" saves the on-screen edits first (new version); tabs by role: Creator sees Write and check, Review, Brand workspace; Reviewer sees everything except Write and check; insights/analytics APIs need Reviewer or Marketing head; insights and analytics default to posts checked against the active brand kit (each draft stores `kit_id` = kit `activated_at`; `?scope=all` shows all history) and group rules as Regulation / Brand kit / Approved facts / Accessibility / No longer active; brand kit lifecycle (one brand at a time): activate only when no kit is live; current posts are archived (`archived`, `kit_id`, `kit_name`), never deleted (`confirm_reset` needed if live posts exist); `/api/brandkit/update` revises the live kit (preview diff, then `apply`), keeps rule/fact ids for unchanged items, keeps posts and re-checks posts not yet approved; `/api/brandkit/reset` (brand name typed to confirm) removes the kit and archives its posts (read-only, shown in All history by brand), leaves only regulatory rules, and blocks new posts until a kit is activated; browser-tested login, brand-kit upload and activation, full review workflow.
Not yet verified: OCR and logo matching in a real browser with internet (the build sandbox couldn't reach the tesseract CDN). Test with real banners first, then tune: OCR confidence filter (60), logo threshold (0.6), brand-colour share threshold (0.25), Lab distance (25).
Ideas the team raised: test with a Westfield-style dark banner; demo with the Sunrise sample PDF in tests/fixtures.
Round 2 submission still needs: deployed link, GitHub repo, per-member contribution statements (written by each member), updated project PDF, changes-from-plan list (see SUBMISSION.md, update it for the image-first and brand-kit changes).
