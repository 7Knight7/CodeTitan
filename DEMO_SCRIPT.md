# Demo script: Live Brand Check (about 5 minutes)

Brand used: **Sunrise Tutorials**, a fictional NEET and JEE coaching brand.
Files: `tests/fixtures/sunrise_brand_book.pdf`, `demo/banner_wrong.png`, `demo/banner_right.png`.

**Before you start**
- Open https://live-brand-check.vercel.app, or run it locally (`npm run api` and `npm run dev`, then http://localhost:3000; see README).
- The three demo accounts (Meera, Priya, Arjun) and their passwords are shown on the sign-in page. After signing in once, the **Open as Priya / Arjun / Meera** buttons switch person in one click.
- If a brand kit is already live, open **Brand guidelines** as Meera, press **Reset brand kit** and type the brand name. Its posts stay in All history. (Or add a new brand from the brand dropdown in the sidebar and use that.)

---

## 1. Meera, marketing head: the brand kit (about 1½ min)

**Do:** Sign in as **Meera (marketing head)** and open **Brand guidelines**. Upload `sunrise_brand_book.pdf`.

**Say:** "Every brand starts with its own guideline PDF. The app reads it without AI. Every item shows the page and the exact line it came from."

**Do:** Scroll through what was read.

**Say:**
- "Brand name: Sunrise Tutorials. Colours: Sunrise Orange, Deep Teal and Cloud White. Tone: warm, honest and encouraging."
- "Words not to use: 'guaranteed rank', 'India's best', 'crack NEET in 30 days', plus the wrong names 'Sunrise Academy' and 'STV'."
- "Approved facts, with dates: the fee is Rs 1,20,000 and the offer is 15% off until 31 December. Any other price or offer gets flagged."
- "Required on every post: the website and the line 'Results shown are for the 2025 batch'."

**Do:** Under **What the brand talks about**, add `JEE`, `aspirants`, `Vijayawada` and `admissions`. Press **Activate brand kit**.

**Say:** "A person checks and edits everything before it goes live. Indian ad regulations always stay on: no guaranteed results (CCPA coaching guidelines 2024), no unproven superlatives (ASCI Code), and #ad for paid posts."

---

## 2. Priya, social media: wrong post, then the fix (about 2½ min)

**Do:** Sign in as **Priya (social media)** and open **Content checker**. Choose **Instagram**, **Feed post** and **Organic**.

**Do:** Upload `banner_wrong.png`. Paste this caption and leave the alt text empty:
> India's best NEET coaching!!! Guaranteed rank. Fees only Rs 99,000. Hurry, 50% off!

**Do:** Press **Check post**.

**Say:**
- "The text in the image is read in the browser. The image itself never leaves the device."
- (Point at the red banner.) "First the big answer: **NO, this is not a post for Sunrise Tutorials**. The brand name is missing, the colours are off-brand, and the offer isn't approved. Each reason shows its source."
- (Point at the issue list.) "Then each issue, grouped by layer:
  - Regulation: 'Guaranteed rank' breaks the CCPA coaching guidelines.
  - Brand: 'India's best' is a banned phrase.
  - Facts: Rs 99,000 and 50% off aren't in the approved facts.
  - Visual: low text contrast, missing alt text and the required text.
  
  Every issue says why, cites its source and suggests a fix."

**Do:** Point at **Send for review**: it is greyed out.

**Say:** "With blockers open, it can't go to review."

**Do:** Remove the image and upload `banner_right.png`. Replace the caption with:
> Sunrise Tutorials admissions are open for our NEET two-year programme in Vijayawada. Fee: Rs 1,20,000. Early admission discount: 15% off until 31 December. Details at www.sunrisetutorials.in

Set the alt text to `Sunrise Tutorials NEET admissions banner`. Press **Check post**.

**Say:** "Now it **fits Sunrise Tutorials**: the name, brand colours, the brand's topics, and the fee and offer matched to approved facts. No blockers, and every check passes."

**Do:** Press **Send for review**.

**Say:** "It's saved as version 2. Version 1 and every check are kept in its history."

---

## 3. Arjun, brand reviewer: the verdict (about 1 min)

**Do:** Press **Open as Arjun** in the message shown after sending (or sign in as Arjun) and open **Review & approvals**. Select the post.

**Say:** "The reviewer sees the image, the caption, every check, and every decision the creator made. A person always makes the final call. Nobody can approve their own post, and sensitive topics like festivals or elections go to the marketing head."

**Do:** Press **Approve version 2**. Then click **Full history and versions**.

**Say:** "Approved and locked. Every version, check, decision and approval is recorded with who did it and when. The app also learns from this approval in its brand memory, kept separate from the brand kit, which it never changes."

---

## 4. Trusted history (about 30 s, optional)

**Do:** As Meera, open **Approved facts** and change the fee to Rs 1,25,000. Open the approved post again.

**Say:** "The approval was tied to the fee it relied on. The fee changed, so the post is back in review with the reason. Nobody has to remember which posts used it."

**Do:** On the post's history, press **Compare side by side**, point at the history check, then download the **Approval record (PDF)**.

**Say:** "Each history entry carries a fingerprint of the one before it, so any later edit to the record shows up."

## 5. Chrome extension (about 30 s, optional)

**Do:** Open **Chrome extension** in the sidebar. Show the green "installed and connected" box (install it beforehand with the 7 steps on that page), then open an Instagram post composer and paste the sample caption.

**Say:** "The same checks, beside Instagram's own composer, while you write. It only reads: it never edits or posts anything."

---

**Close:** "Brand kit in, wrong post stopped, right post approved, with a source for every decision. All of it free to run, with no AI deciding anything."

---

**If something looks off**
- **OCR misread:** if the image text is read slightly wrong, correct it in **Text read from the image**, then check again.
- **Optional, to show change requests:** before approving, press **Request changes** with a comment. Priya then sees it at the top right of every page.
- **Tone:** the wrong caption also gets tone suggestions (capitals, "!!!", "Hurry"), each citing the brand's tone guideline. They are suggestions, never blockers.
