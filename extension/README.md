# Live Brand Check for Chrome (Round 3)

The extension checks a post while you write it on Instagram or Facebook. It covers the caption, the images and the banners in the post composer. It uses the same brand kit, rules, approved facts and image checks as the web app.

## What it does and doesn't do

- **It only reads.** It never changes your caption, never clicks Share or Post, and never publishes anything.
- **Every finding shows its source**, the same as in the web app. Images it can't read show as "Couldn't verify".
- **Images are read on your device.** An offscreen extension page does the OCR, contrast, colour and logo checks with the same code as the web app (`lib/image.js`). Only the read text, the measurements and a small preview go to your Live Brand Check server.
- **The server does all the checking.** It identifies you from your normal Live Brand Check sign-in in the same browser; the extension holds no passwords or keys.

## Install (developer mode)

The easiest way: open **Chrome extension** in the app's sidebar. It has a download button, the steps below with copy buttons, a live "installed and connected" check, and an Instagram try-out with a sample banner and caption.

1. Build the extension (only needed after changing it; the built files and `public/downloads/live-brand-check-extension.zip` are in the repo). This copies the OCR engine and `lib/image.js` into `extension/vendor/` and packs the zip:

   ```bash
   npm install
   npm run extension
   ```

2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension/` folder.
3. Click the extension button and set the Live Brand Check address. The default is `https://live-brand-check.vercel.app`; for local runs use the address your app opens on, such as `http://localhost:3001`.
4. Sign in to Live Brand Check in the same Chrome profile.
5. Open the post composer on instagram.com or facebook.com and start writing. The panel appears in the bottom right.

## Limits

- **Composer detection is by structure.** It looks for the text box and images inside the composer dialog. Instagram and Facebook change their pages often, so detection may need updating.
- **First image read is slow.** The first time an image is read, the English OCR data downloads once from tessdata.projectnaptha.com.
- **Not yet tested in real Chrome.** The panel and the server calls were tested on a mock composer page. Loading the extension in Chrome and using it on a live Instagram or Facebook composer still needs testing.
