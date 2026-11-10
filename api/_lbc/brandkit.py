"""Read any brand guideline PDF into a draft brand kit for a human to confirm.

Two readers, merged:
- Pattern reader (always on, no AI): HEX colours, fonts, rupee amounts with dates,
  "don't / avoid / never" lists, "must include" lines, sensitive topics.
- AI reader (only when ANTHROPIC_API_KEY is set): structures the rest. Every item it
  returns must carry a quote copied from the PDF; items whose quote isn't found are dropped.

Nothing here changes the live workspace. The marketing head reviews the draft and activates it.
"""
import io
import json
import os
import re

import httpx
from pypdf import PdfReader

MAX_PDF_BYTES = 4 * 1024 * 1024
HEX_RE = re.compile(r"#[0-9A-Fa-f]{6}\b")
MONEY_RE = re.compile(r"(?:₹|rs\.?|inr)\s?(\d[\d,]*)", re.I)
DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
PERCENT_RE = re.compile(r"(\d{1,2})\s?%\s?(?:off|discount)", re.I)
NEG_HEAD = re.compile(r"\b(don['\u2019]?t|do not|avoid|never|banned|prohibited|not allowed)\b", re.I)
MUST_RE = re.compile(r"\b(must (?:include|show|carry|appear)|always (?:include|show|add)|every (?:post|banner|image) (?:must|should))\b", re.I)
FONTS = ["Montserrat", "Poppins", "Roboto", "Open Sans", "Lato", "Inter", "Source Serif", "IBM Plex Sans",
         "Helvetica", "Arial", "Georgia", "Times New Roman", "Playfair Display", "Merriweather", "Nunito",
         "Raleway", "Oswald", "Noto Sans", "Mukta", "Hind", "Gotham", "Futura", "Garamond", "Avenir"]
SENSITIVE = ["religion", "religious", "festival", "diwali", "eid", "christmas", "caste", "politics", "political",
             "election", "health", "medical"]


def read_pdf(data: bytes):
    if len(data) > MAX_PDF_BYTES:
        raise ValueError("The PDF is larger than 4 MB. Export it again with compressed images.")
    if not data.startswith(b"%PDF"):
        raise ValueError("That file is not a PDF.")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("The PDF is password-protected. Remove the password and upload it again.")
        pages = [(p.extract_text() or "") for p in reader.pages[:60]]
    except ValueError:
        raise
    except Exception:
        raise ValueError("The PDF could not be read. Export it again from Word, Google Docs or Canva.")
    if sum(len(p.strip()) for p in pages) < 80:
        raise ValueError("No readable text found. The PDF looks scanned or made of images; export it with real text.")
    return pages


def _clean(s):
    return re.sub(r"\s+", " ", s).strip(" -•*\u2022\t")


def _page_of(pages, quote):
    q = _clean(quote).lower()[:60]
    for i, p in enumerate(pages, 1):
        if q and q in _clean(p).lower():
            return i
    return None


def _join_wrapped(page):
    """PDFs break sentences across lines; join a line with the next when the sentence clearly continues."""
    out = []
    for raw in page.splitlines():
        line = _clean(raw)
        if not line:
            continue
        if out and not re.search(r"[.:!?\u201d\"]$", out[-1]) and re.match(r"[a-z0-9\"\u201c(]", line) and len(out[-1]) > 40:
            out[-1] = out[-1] + " " + line
        else:
            out.append(line)
    return out


def pattern_read(pages):
    """Deterministic extraction. Every item keeps the line it came from."""
    kit = empty_kit()
    for pno, page in enumerate(pages, 1):
        lines = _join_wrapped(page)
        under_negative = False
        for i, line in enumerate(lines):
            src = {"quote": line[:200], "page": pno, "reader": "pattern"}
            for m in HEX_RE.finditer(line):
                name = _clean(re.sub(r"[:\-–(]*\s*$", "", line[:m.start()]).split(":")[-1])[-40:] or "Brand colour"
                kit["colours"].append({"name": name, "hex": m.group(0).upper(), **src})
            for f in FONTS:
                if re.search(rf"\b{re.escape(f)}\b", line, re.I) and not any(x["name"] == f for x in kit["fonts"]):
                    kit["fonts"].append({"name": f, **src})
            dates = DATE_RE.findall(line)
            for m in MONEY_RE.finditer(line):
                amount = int(m.group(1).replace(",", ""))
                kit["facts"].append({"kind": "fee", "label": _clean(line[:m.start()])[-80:] or "Fee", "amount": amount,
                                     "valid_from": dates[0] if len(dates) > 1 else "", "valid_until": dates[-1] if dates else "", **src})
            for m in PERCENT_RE.finditer(line):
                kit["facts"].append({"kind": "offer", "label": _clean(line[:m.start()])[-80:] or "Offer", "percent": int(m.group(1)),
                                     "valid_from": dates[0] if len(dates) > 1 else "", "valid_until": dates[-1] if dates else "", **src})
            if re.search(r"\blogo\b", line, re.I) and re.search(r"\b(must|always|every)\b", line, re.I):
                kit["logo_required"] = {"value": True, **src}
            elif MUST_RE.search(line):
                kit["required_text"].append({"text": line[:200], **src})
            if NEG_HEAD.search(line) and len(line) < 60 and line.endswith(":"):
                under_negative = True
                continue
            quoted = re.findall(r"[\"\u201c']([^\"\u201d']{3,40})[\"\u201d']", line)
            if NEG_HEAD.search(line):
                for q in quoted:
                    kit["banned_phrases"].append({"text": q, **src})
            elif under_negative and len(line) <= 60 and not line.endswith(":"):
                kit["banned_phrases"].append({"text": line.strip("\"'\u201c\u201d."), **src})
            elif line.endswith(":") or (i and len(line) > 80):
                under_negative = False
            low = line.lower()
            for w in SENSITIVE:
                if re.search(rf"\b{w}s?\b", low) and "sensitive" in low and not any(x["text"] == w for x in kit["sensitive_topics"]):
                    kit["sensitive_topics"].append({"text": w, **src})
    kit["keywords"] = read_keywords(pages)
    first = next((ln for ln in (_clean(x) for x in pages[0].splitlines()) if 3 < len(ln) < 60), "")
    if first:
        kit["brand_name"] = {"text": re.sub(r"(?i)\b(brand (guidelines|book|kit|manual)|style guide)\b", "", first).strip(" :-–|") or first,
                             "quote": first, "page": 1, "reader": "pattern"}
    return kit


STOP = set("""a about above after again all also an and any are as at be because been before being below between both
but by can could did do does doing don down during each every few for from further had has have having here how if in
into is it its itself just more most must never no nor not now of off on once only or other our ours out over own same
should so some such than that the their them then there these they this those through to too under until up use used
using very was we were what when where which while who whom why will with would you your yours brand brands guideline
guidelines guide kit page pages colour colours color colors font fonts logo logos text image images post posts banner
banners always avoid include including example examples please make sure write written words word tone voice style
primary secondary background white black name names social media content marketing team approved approval rules rule
like one two three new may per via etc toolkit core space verified sensitive correct usage incorrect preferred
acceptable version versions internal reference only following applicable instead unless overall topic topics""".split())


def read_keywords(pages, limit=15):
    """What the brand talks about: its hashtags, then words the PDF repeats often (no AI). The human edits the list."""
    out, seen = [], set()
    lines = [(pno, ln) for pno, p in enumerate(pages, 1) for ln in _join_wrapped(p)]
    for pno, ln in lines:
        for tag in re.findall(r"(?<![\w&])#([A-Za-z][A-Za-z0-9_]{2,30})", ln):
            if re.fullmatch(r"[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}", tag):  # a colour code, not a hashtag
                continue
            if tag.lower() not in seen:
                seen.add(tag.lower())
                out.append({"text": "#" + tag, "quote": ln[:200], "page": pno, "reader": "pattern"})
    counts = {}
    for pno, ln in lines:
        for w in re.findall(r"[A-Za-z][A-Za-z-]{3,}", ln):
            lw = w.lower()
            if lw in STOP or HEX_RE.search("#" + w):
                continue
            counts.setdefault(lw, [0, pno, ln])[0] += 1
    for lw, (n, pno, ln) in sorted(counts.items(), key=lambda kv: -kv[1][0]):
        if len(out) >= limit or n < 3:
            break
        if lw not in seen:
            seen.add(lw)
            out.append({"text": lw, "quote": ln[:200], "page": pno, "reader": "pattern"})
    return out[:limit]


def empty_kit():
    return {"brand_name": None, "wrong_names": [], "colours": [], "fonts": [], "logo_required": None,
            "required_text": [], "banned_phrases": [], "tone_rules": [], "sensitive_topics": [], "facts": [],
            "guidelines": [], "keywords": []}


AI_PROMPT = """Extract a brand kit from this brand guideline document. Return ONLY JSON, no prose:
{{"brand_name": {{"text": str, "quote": str}},
 "wrong_names": [{{"text": str, "quote": str}}],          // misspellings or old names the brand says not to use
 "colours": [{{"name": str, "hex": "#RRGGBB", "quote": str}}],
 "fonts": [{{"name": str, "quote": str}}],
 "logo_required": {{"value": true|false, "quote": str}} or null,
 "required_text": [{{"text": str, "quote": str}}],        // text that must appear on posts/images
 "banned_phrases": [{{"text": str, "quote": str}}],       // exact words or claims not to use
 "tone_rules": [{{"text": str, "quote": str}}],
 "sensitive_topics": [{{"text": str, "quote": str}}],
 "facts": [{{"kind": "fee"|"offer"|"result"|"other", "label": str, "amount": int|null, "percent": int|null,
            "full_course": int|null, "interview_guidance": int|null,
            "valid_from": "YYYY-MM-DD"|"", "valid_until": "YYYY-MM-DD"|"", "quote": str}}],
 "guidelines": [{{"section": str, "text": str, "quote": str}}],
 "keywords": [{{"text": str, "quote": str}}]}}             // 5-20 products, services, topics and hashtags the brand talks about (1-3 words each)
Rules: "quote" must be copied word for word from the document (max 200 characters). Do not invent anything.
Use empty lists when the document says nothing. Use the document's own words for rules.

Document:
<<<{text}>>>"""


def ai_enabled():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def ai_read(pages, timeout=60.0):
    text = "\n\n".join(f"[Page {i}]\n{p}" for i, p in enumerate(pages, 1))[:60000]
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": os.environ.get("LLM_MODEL", "claude-haiku-5-5"), "max_tokens": 4000,
              "messages": [{"role": "user", "content": AI_PROMPT.format(text=text)}]},
        timeout=timeout,
    )
    r.raise_for_status()
    raw = "".join(b.get("text", "") for b in r.json().get("content", []))
    return json.loads(raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip())


def validate_ai(data, pages):
    """Keep only AI items whose quote really appears in the PDF; tag them with page and reader."""
    joined = _clean(" ".join(pages)).lower()
    kit, dropped = empty_kit(), 0

    def ok(item):
        q = _clean(str(item.get("quote", ""))).lower()
        return bool(q) and q[:120] in joined

    def tag(item):
        return item | {"page": _page_of(pages, item.get("quote", "")), "reader": "AI"}

    for key in ("brand_name", "logo_required"):
        v = data.get(key)
        if isinstance(v, dict):
            if ok(v):
                kit[key] = tag(v)
            else:
                dropped += 1
    for key in ("wrong_names", "colours", "fonts", "required_text", "banned_phrases", "tone_rules",
                "sensitive_topics", "facts", "guidelines", "keywords"):
        for item in data.get(key) or []:
            if not isinstance(item, dict):
                continue
            if key == "colours" and not HEX_RE.fullmatch(str(item.get("hex", ""))):
                dropped += 1
                continue
            if ok(item):
                kit[key].append(tag(item))
            else:
                dropped += 1
    return kit, dropped


def merge(primary, extra):
    """Combine two kits without duplicates (AI first, pattern items added if new)."""
    out = {k: (list(v) if isinstance(v, list) else v) for k, v in primary.items()}
    keys = {"colours": "hex", "fonts": "name", "facts": "quote", "required_text": "text", "banned_phrases": "text",
            "sensitive_topics": "text", "wrong_names": "text", "tone_rules": "text", "guidelines": "text",
            "keywords": "text"}
    for k, field in keys.items():
        seen = {str(x.get(field, "")).lower() for x in out[k]}
        for x in extra.get(k, []):
            if str(x.get(field, "")).lower() not in seen:
                out[k].append(x)
                seen.add(str(x.get(field, "")).lower())
    for k in ("brand_name", "logo_required"):
        out[k] = out[k] or extra.get(k)
    return out


def parse_brand_pdf(data: bytes):
    pages = read_pdf(data)
    kit = pattern_read(pages)
    status = {"pages": len(pages), "ai": "off", "dropped": 0,
              "message": "Read with the pattern reader. Set an AI key to extract tone rules and guidelines from prose."}
    if ai_enabled():
        try:
            ai_kit, dropped = validate_ai(ai_read(pages), pages)
            kit = merge(ai_kit, kit)
            status = {"pages": len(pages), "ai": "on", "dropped": dropped,
                      "message": f"Read with AI and the pattern reader. {dropped} AI item(s) without a matching quote were removed."}
        except Exception as exc:
            status["ai"] = "error"
            status["message"] = f"AI reading failed ({type(exc).__name__}); showing pattern-reader results only."
    return kit, status
