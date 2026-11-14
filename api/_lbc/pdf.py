"""A tiny text-only PDF writer (A4, Helvetica), so approval records need no extra library.

lines: list of (style, text) where style is "title", "h", "b" (bold), "p" (normal), "small" or "gap".
"""
import re

W, H, MARGIN = 595, 842, 50
STYLES = {"title": ("F2", 18, 26), "h": ("F2", 12.5, 22), "b": ("F2", 10, 14), "p": ("F1", 10, 14),
          "small": ("F1", 8, 11), "mono": ("F3", 7.5, 10)}
SUBS = {"₹": "Rs.", "“": '"', "”": '"', "‘": "'", "’": "'", "—": "-", "–": "-",
        "→": "->", "…": "...", "•": "-", " ": " ", "✓": "OK", "✕": "x"}


def _clean(text):
    text = "".join(SUBS.get(c, c) for c in str(text))
    return text.encode("latin-1", "replace").decode("latin-1")


def _esc(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(text, size, font):
    per = 0.6 if font == "F3" else 0.5 if font == "F1" else 0.55  # rough average glyph width
    width = int((W - 2 * MARGIN) / (size * per))
    out = []
    for para in _clean(text).split("\n"):
        words, line = para.split(" "), ""
        for w in words:
            while len(w) > width:  # very long words (hashes, links)
                if line:
                    out.append(line)
                    line = ""
                out.append(w[:width])
                w = w[width:]
            if len(line) + len(w) + (1 if line else 0) > width:
                out.append(line)
                line = w
            else:
                line = f"{line} {w}" if line else w
        out.append(line)
    return out


def render(lines, footer=""):
    pages, ops, y = [], [], H - MARGIN

    def new_page():
        nonlocal ops, y
        if ops:
            pages.append(ops)
        ops, y = [], H - MARGIN

    for style, text in lines:
        if style == "gap":
            y -= 8
            continue
        font, size, lead = STYLES[style]
        for ln in _wrap(text, size, font):
            if y - lead < MARGIN + 20:
                new_page()
            y -= lead
            ops.append(f"BT /{font} {size} Tf {MARGIN} {y:.1f} Td ({_esc(ln)}) Tj ET")
        if style == "h":
            ops.append(f"0.8 G {MARGIN} {y - 4:.1f} m {W - MARGIN} {y - 4:.1f} l S 0 G")
            y -= 4
    pages.append(ops)

    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"]
    kids = []
    for n, page_ops in enumerate(pages, 1):
        foot = _esc(_clean(f"{footer}   Page {n} of {len(pages)}"))
        stream = "\n".join(page_ops + [f"BT /F1 7.5 Tf {MARGIN} 28 Td ({foot}) Tj ET"]).encode("latin-1")
        objs.append(f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] "
                    f"/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents {len(objs)} 0 R >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"

    out, offsets = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        body = o if isinstance(o, bytes) else o.encode("latin-1")
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{off:010d} 00000 n \n" for off in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def safe_filename(title):
    return (re.sub(r"[^A-Za-z0-9]+", "-", title or "post").strip("-")[:60] or "post").lower()
