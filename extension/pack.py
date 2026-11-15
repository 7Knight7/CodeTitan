"""Pack the Chrome extension into public/downloads/live-brand-check-extension.zip for the "Add the Chrome extension"
page. Run after `node extension/build.mjs` (npm run extension does both). Unzipping gives one folder,
live-brand-check-extension/, which holds manifest.json: that is the folder to choose in Chrome's "Load unpacked"."""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "downloads", "live-brand-check-extension.zip")
FILES = ["manifest.json", "background.js", "content.js", "detect.js", "offscreen.html", "offscreen.js",
         "popup.html", "popup.js", "icon16.png", "icon48.png", "icon128.png", "README.md"]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in FILES:
        z.write(os.path.join(HERE, f), f"live-brand-check-extension/{f}")
    vendor = os.path.join(HERE, "vendor")
    if not os.path.isdir(vendor):
        raise SystemExit("extension/vendor is missing: run `node extension/build.mjs` first")
    for folder, _, names in os.walk(vendor):
        for n in sorted(names):
            full = os.path.join(folder, n)
            z.write(full, "live-brand-check-extension/" + os.path.relpath(full, HERE).replace(os.sep, "/"))
print(f"Packed {os.path.relpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)")
