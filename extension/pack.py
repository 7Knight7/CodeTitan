"""Pack the Chrome extension into public/downloads/live-brand-check-extension.zip for the "Add the Chrome extension"
page. Run after `node extension/build.mjs` (npm run extension does both). The files sit at the top of the zip
(no inner folder), so the folder that Windows "Extract All" or a Mac double-click creates holds manifest.json
directly: that is the folder to choose in Chrome's "Load unpacked"."""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "downloads", "live-brand-check-extension.zip")
FILES = ["manifest.json", "background.js", "content.js", "detect.js", "offscreen.html", "offscreen.js",
         "popup.html", "popup.js", "icon16.png", "icon48.png", "icon128.png", "README.md"]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
TMP = OUT + ".tmp"  # written beside it, then swapped in (OneDrive or a running server may hold the old file)
with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in FILES:
        z.write(os.path.join(HERE, f), f)
    vendor = os.path.join(HERE, "vendor")
    if not os.path.isdir(vendor):
        raise SystemExit("extension/vendor is missing: run `node extension/build.mjs` first")
    for folder, _, names in os.walk(vendor):
        for n in sorted(names):
            full = os.path.join(folder, n)
            z.write(full, os.path.relpath(full, HERE).replace(os.sep, "/"))
os.replace(TMP, OUT)
print(f"Packed {os.path.relpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)")
