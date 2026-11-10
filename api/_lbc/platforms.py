"""Platform Intelligence Engine: one brand, multiple platforms, different rules.

Everything that depends on where a post goes (platform), how (format) and under what commercial
context lives here as data: the fields the composer shows, the media it accepts, and the checks in
each validation layer. The API and the composer read this configuration; nothing else branches on
platform names. To add a platform, add an entry to PLATFORMS.

Rules for this file (agreed with the team):
- Only platform limits that the platform documents publicly, each with its source. Formatting limits
  are warnings or suggestions, never compliance blockers.
- Regulatory checks cite the regulation. A brand preference is never presented as law.
- When something can't be measured (for example a label inside a video), the finding says
  "Couldn't verify" instead of guessing.
"""
import re
from datetime import date

from . import engine

# ---------- fields the composer can show ----------

FIELDS = {
    "main_text": {"label": "Post text", "type": "longtext", "max": 5000},
    "headline": {"label": "Headline", "type": "text", "max": 150, "placeholder": "Admissions open for 2026-27"},
    "hashtags": {"label": "Hashtags", "type": "text", "max": 500, "placeholder": "#admissions #learning"},
    "cta": {"label": "Call to action", "type": "text", "max": 80, "placeholder": "Enrol now"},
    "url": {"label": "Link", "type": "url", "max": 500, "placeholder": "https://"},
    "link_title": {"label": "Link preview title", "type": "text", "max": 150},
    "tagged": {"label": "Tagged brand or product", "type": "text", "max": 150, "placeholder": "@brand, product name"},
    "doc_title": {"label": "Document title", "type": "text", "max": 150},
    "contact": {"label": "Business or contact details", "type": "text", "max": 300, "placeholder": "Phone, address or website"},
    "poll_question": {"label": "Poll question", "type": "text", "max": 300},
    "poll_options": {"label": "Poll options (one per line)", "type": "lines", "max": 500},
    # commercial context
    "sponsor": {"label": "Sponsor / advertiser", "type": "text", "max": 150},
    "partner_brand": {"label": "Brand being promoted", "type": "text", "max": 150},
    "product": {"label": "Product or service promoted", "type": "text", "max": 150},
    "creator_script": {"label": "Creator's script (spoken or on-screen text)", "type": "longtext", "max": 5000},
    "relationship": {"label": "Brand–creator relationship", "type": "select", "options": [
        "Paid", "Free product or service", "Gift or trip", "Affiliate or commission", "Employee or family", "Other"]},
    "connection_details": {"label": "Material connection details", "type": "text", "max": 300,
                           "placeholder": "For example: paid Rs 20,000 for two posts; free course access"},
    "disclosure": {"label": "Disclosure label", "type": "select", "options": [
        "#ad", "#sponsored", "#collab", "#partnership", "Platform paid-partnership label", "Not decided yet"]},
    "offer_details": {"label": "Offer details", "type": "longtext", "max": 1000, "placeholder": "20% off the foundation course"},
    "offer_valid_from": {"label": "Offer valid from", "type": "date"},
    "offer_valid_until": {"label": "Offer valid until", "type": "date"},
    "offer_terms": {"label": "Offer terms (or a link to them)", "type": "text", "max": 500},
}

# Details for the reviewer, not published: never checked as ad copy (e.g. "paid Rs 15,000" is not a fee claim).
INTERNAL_FIELDS = {"sponsor", "partner_brand", "product", "relationship", "connection_details", "disclosure"}

MEDIA_ACCEPT = {"image": "image/png,image/jpeg,image/webp", "video": "video/mp4,video/webm,video/quicktime",
                "document": "application/pdf"}

# ---------- platforms and their formats ----------
# media: kinds accepted, how many, and whether it is required. fields: (id, required) in display order;
# "media" marks where the upload box sits (visual-first platforms put it first).

def _f(*items):
    return [(i, False) if isinstance(i, str) else i for i in items]


PLATFORMS = {
    "instagram": {
        "label": "Instagram", "layout": "visual", "main_label": "Caption",
        "text_limit": {"max": 2200, "source": "Instagram Help Centre: captions can be up to 2,200 characters"},
        "hashtag_limit": {"max": 30, "source": "Instagram Help Centre: a post can have up to 30 hashtags"},
        "formats": {
            "feed": {"label": "Feed post", "media": {"kinds": ["image"], "min": 1, "max": 1},
                     "fields": _f("media", ("main_text", True), "hashtags", "cta", "tagged"),
                     "aspect": {"min": 0.8, "max": 1.91, "label": "between 4:5 and 1.91:1",
                                "source": "Instagram Help Centre: feed photos can have an aspect ratio between 1.91:1 and 4:5"}},
            "carousel": {"label": "Carousel", "media": {"kinds": ["image", "video"], "min": 2, "max": 10},
                         "fields": _f("media", ("main_text", True), "hashtags", "cta", "tagged"),
                         "aspect": {"min": 0.8, "max": 1.91, "label": "between 4:5 and 1.91:1",
                                    "source": "Instagram Help Centre: feed photos can have an aspect ratio between 1.91:1 and 4:5"}},
            "reel": {"label": "Reel", "media": {"kinds": ["video"], "min": 1, "max": 1},
                     "fields": _f("media", ("main_text", True), "hashtags", "cta", "tagged"),
                     "aspect": {"min": 0.5, "max": 0.6, "label": "vertical 9:16", "recommended": True,
                                "source": "Instagram Help Centre: Reels are designed for vertical 9:16 video"}},
            "story": {"label": "Story", "media": {"kinds": ["image", "video"], "min": 1, "max": 1},
                      "fields": _f("media", "cta", "url", "tagged"), "no_caption": True,
                      "aspect": {"min": 0.5, "max": 0.6, "label": "vertical 9:16", "recommended": True,
                                 "source": "Instagram Help Centre: stories are shown full screen in vertical 9:16"}},
        },
    },
    "linkedin": {
        "label": "LinkedIn", "layout": "text", "main_label": "Main post text",
        "text_limit": {"max": 3000, "source": "LinkedIn Help: a post can be up to 3,000 characters"},
        "formats": {
            "text": {"label": "Text-only post", "media": None, "fields": _f(("main_text", True), "url", "hashtags")},
            "text_image": {"label": "Text + image", "media": {"kinds": ["image"], "min": 1, "max": 10},
                           "fields": _f(("main_text", True), "media", "url", "hashtags")},
            "document": {"label": "Document / carousel", "media": {"kinds": ["document"], "min": 1, "max": 1},
                         "fields": _f(("main_text", True), "media", ("doc_title", True), "hashtags")},
            "video": {"label": "Video", "media": {"kinds": ["video"], "min": 1, "max": 1},
                      "fields": _f(("main_text", True), "media", "url", "hashtags")},
            "poll": {"label": "Poll", "media": None,
                     "fields": _f(("main_text", True), ("poll_question", True), ("poll_options", True), "hashtags"),
                     "poll": {"question_max": 140, "options_min": 2, "options_max": 4, "option_max": 30,
                              "source": "LinkedIn Help: a poll has a question of up to 140 characters and 2 to 4 options of up to 30 characters"}},
        },
    },
    "facebook": {
        "label": "Facebook", "layout": "social", "main_label": "Post text",
        "text_limit": {"max": 63206, "source": "Facebook Help Centre: a post can be up to 63,206 characters"},
        "formats": {
            "text": {"label": "Text post", "media": None, "fields": _f(("main_text", True), "cta")},
            "image": {"label": "Image post", "media": {"kinds": ["image", "video"], "min": 1, "max": 10},
                      "fields": _f(("main_text", True), "media", "cta")},
            "video": {"label": "Video", "media": {"kinds": ["video"], "min": 1, "max": 1},
                      "fields": _f(("main_text", True), "media", "cta")},
            "link": {"label": "Link post", "media": {"kinds": ["image"], "min": 0, "max": 1},
                     "fields": _f(("main_text", True), ("url", True), "link_title", "media", "cta")},
        },
    },
    "whatsapp": {
        "label": "WhatsApp broadcast", "layout": "message", "main_label": "Message text",
        "text_limit": {"max": 4096, "source": "WhatsApp Business Platform: a text message body can be up to 4,096 characters"},
        "formats": {
            "text": {"label": "Text-only message", "media": None, "fields": _f(("main_text", True), "cta", "url", "contact")},
            "image": {"label": "Text + image", "media": {"kinds": ["image"], "min": 1, "max": 1},
                      "fields": _f(("main_text", True), "media", "cta", "url", "contact")},
            "document": {"label": "Document", "media": {"kinds": ["document"], "min": 1, "max": 1},
                         "fields": _f(("main_text", True), "media", "cta", "url", "contact")},
            "video": {"label": "Video", "media": {"kinds": ["video"], "min": 1, "max": 1},
                      "fields": _f(("main_text", True), "media", "cta", "url", "contact")},
        },
    },
    "website": {
        "label": "Website", "layout": "banner", "main_label": "Supporting description",
        "formats": {
            "hero": {"label": "Hero banner", "media": {"kinds": ["image"], "min": 1, "max": 1},
                     "fields": _f("media", ("headline", True), "main_text", ("cta", True), ("url", True))},
            "promo": {"label": "Promotional banner", "media": {"kinds": ["image"], "min": 1, "max": 1},
                      "fields": _f("media", ("headline", True), "main_text", ("cta", True), ("url", True))},
            "section": {"label": "Landing page section", "media": {"kinds": ["image"], "min": 0, "max": 1},
                        "fields": _f(("headline", True), ("main_text", True), "media", "cta", "url")},
        },
    },
}

CONTEXTS = {
    "organic": {"label": "Organic", "help": "The brand's own unpaid post.", "fields": []},
    "sponsored": {"label": "Sponsored", "help": "The brand pays the platform to promote its own post.",
                  "fields": [("sponsor", True)]},
    "paid_partnership": {"label": "Paid partnership", "help": "A creator or partner is paid to publish this.",
                         "fields": [("partner_brand", True), ("product", True), ("relationship", True),
                                    ("connection_details", True), ("disclosure", True)], "endorsement": True},
    "influencer": {"label": "Influencer collaboration", "help": "A creator posts about the brand in return for something.",
                   "fields": [("partner_brand", True), ("product", True), ("relationship", True),
                              ("connection_details", True), ("disclosure", True)], "endorsement": True},
    "promo_offer": {"label": "Promotional offer", "help": "The post advertises a discount, price or limited-time offer.",
                    "fields": [("offer_details", True), ("offer_valid_from", False), ("offer_valid_until", True),
                               ("offer_terms", False)], "offer": True},
}

LAYERS = [
    {"id": "platform", "label": "Platform requirements"},
    {"id": "regulation", "label": "Indian advertising regulations"},
    {"id": "brand", "label": "Brand governance"},
    {"id": "facts", "label": "Factual verification"},
    {"id": "visual", "label": "Visual intelligence"},
]

ASCI_INFLUENCER = "ASCI Guidelines for Influencer Advertising in Digital Media (2021)"
CCPA_ENDORSE = "Department of Consumer Affairs, Endorsement Know-hows! for celebrities, influencers and virtual influencers (2023)"
CCPA_2022 = "CCPA Guidelines for Prevention of Misleading Advertisements and Endorsements for Misleading Advertisements, 2022"
ASCI_CODE = "ASCI Code, Chapter I: advertisements must be truthful and honest and must not mislead by omission"

LEGACY_CHANNELS = {  # posts saved before the composer had platforms
    "Instagram post": ("instagram", "feed", "organic"), "Facebook post": ("facebook", "image", "organic"),
    "LinkedIn post": ("linkedin", "text", "organic"), "WhatsApp broadcast": ("whatsapp", "text", "organic"),
    "Website banner": ("website", "promo", "organic"), "Influencer post": ("instagram", "feed", "influencer"),
    "Paid partnership": ("instagram", "feed", "paid_partnership"),
}

VIDEO_FORMATS = lambda fmt: (fmt.get("media") or {}).get("kinds") == ["video"]


class ConfigError(ValueError):
    pass


def get_combo(platform, fmt, context="organic"):
    p = PLATFORMS.get(platform)
    if not p:
        raise ConfigError(f"Unknown platform: {platform}")
    f = p["formats"].get(fmt)
    if not f:
        raise ConfigError(f"{p['label']} has no format called {fmt}")
    c = CONTEXTS.get(context)
    if not c:
        raise ConfigError(f"Unknown commercial context: {context}")
    return p, f, c


def channel_label(platform, fmt, context):
    p, f, c = get_combo(platform, fmt, context)
    return f"{p['label']} · {f['label']}" + ("" if context == "organic" else f" · {c['label']}")


def field_label(platform, fid):
    if fid == "main_text":
        return PLATFORMS.get(platform, {}).get("main_label", "Post text")
    return FIELDS.get(fid, {}).get("label", fid)


def input_schema(platform, fmt, context="organic"):
    """The ordered list of inputs the composer shows for this combination, and nothing else."""
    p, f, c = get_combo(platform, fmt, context)
    out = []
    for fid, required in f["fields"]:
        if fid == "media":
            m = f["media"]
            if m:
                kinds = m["kinds"]
                noun = " or ".join(kinds)
                out.append({"id": "media", "type": "media", "label": _media_label(kinds, m["max"]), "kinds": kinds,
                            "accept": ",".join(MEDIA_ACCEPT[k] for k in kinds), "min": m["min"], "max": m["max"],
                            "required": m["min"] > 0, "help": _media_help(kinds, m), "noun": noun})
            continue
        out.append(_field(platform, fid, required))
    if context in ("paid_partnership", "influencer") and VIDEO_FORMATS(f):
        out.append(_field(platform, "creator_script", False))
    for fid, required in c["fields"]:
        if not any(x["id"] == fid for x in out):
            out.append(_field(platform, fid, required) | {"group": c["label"], "internal": fid in INTERNAL_FIELDS})
    return {"platform": platform, "format": fmt, "context": context, "layout": p["layout"],
            "label": channel_label(platform, fmt, context), "fields": out}


def _field(platform, fid, required):
    spec = dict(FIELDS[fid])
    spec["label"] = field_label(platform, fid)
    if fid == "main_text":
        limit = PLATFORMS[platform].get("text_limit")
        if limit:
            spec["limit"] = limit["max"]
    return spec | {"id": fid, "required": bool(required)}


def _media_label(kinds, mx):
    if kinds == ["document"]:
        return "Document (PDF)"
    if mx > 1:
        plural = " or ".join({"image": "images", "video": "videos"}[k] for k in kinds)
        return f"{plural[:1].upper()}{plural[1:]} (up to {mx})"
    return " or ".join({"image": "image", "video": "video"}[k] for k in kinds).capitalize()


def _media_help(kinds, m):
    bits = []
    if "image" in kinds:
        bits.append("Images are read in your browser; only a small preview is saved for the reviewer.")
    if "video" in kinds:
        bits.append("Videos stay on your device; one frame is read and saved as a preview.")
    if "document" in kinds:
        bits.append("The PDF's text is read on the server to check it; the file itself is not stored.")
    if m["min"] > 1:
        bits.insert(0, f"Add at least {m['min']}.")
    return " ".join(bits)


def validation_profile(platform, fmt, context, rules=None):
    """Which checks run, layer by layer, for this combination. The engine runs exactly these."""
    p, f, c = get_combo(platform, fmt, context)
    schema = input_schema(platform, fmt, context)
    kinds = (f.get("media") or {}).get("kinds", [])
    layers = {k["id"]: [] for k in LAYERS}
    if p.get("text_limit") and not f.get("no_caption"):
        layers["platform"].append({"id": "PLAT-LENGTH", "name": f"{p['main_label']} within {p['text_limit']['max']:,} characters",
                                   "source": p["text_limit"]["source"]})
    if p.get("hashtag_limit"):
        layers["platform"].append({"id": "PLAT-HASHTAGS", "name": f"At most {p['hashtag_limit']['max']} hashtags",
                                   "source": p["hashtag_limit"]["source"]})
    if f.get("aspect"):
        layers["platform"].append({"id": "PLAT-ASPECT", "name": f"Image shape {f['aspect']['label']}", "source": f["aspect"]["source"]})
    if f.get("poll"):
        layers["platform"].append({"id": "PLAT-POLL", "name": "Poll question and options within limits", "source": f["poll"]["source"]})
    layers["platform"].append({"id": "INPUT", "name": "Required fields and uploads for this format", "source": "Composer input schema"})
    for r in rules or []:
        if not r.get("enabled", True):
            continue
        layer = "regulation" if r.get("source_type") == "regulatory" else "brand"
        layers[layer].append({"id": r["id"], "name": r["name"], "source": (r.get("sources") or [""])[0]})
    if c.get("endorsement"):
        layers["regulation"].append({"id": "CTX-DISCLOSURE", "name": "Endorsement is clearly disclosed",
                                     "source": f"{ASCI_INFLUENCER}; {CCPA_ENDORSE}"})
    if c.get("offer"):
        layers["facts"].append({"id": "CTX-OFFER-DATES", "name": "Offer period is current", "source": "Offer validity entered in the composer"})
        layers["regulation"].append({"id": "CTX-OFFER-TERMS", "name": "Offer conditions are stated", "source": f"{CCPA_2022}; {ASCI_CODE}"})
    layers["facts"].append({"id": "FACTS", "name": "Prices, offers and results match approved facts (with expiry dates)",
                            "source": "Approved facts"})
    if kinds:
        layers["visual"] += [{"id": "OCR", "name": "Text inside images, video frames and PDFs is checked like typed text",
                              "source": "Text recognition (OCR) in the browser; PDF text on the server"}]
        if "image" in kinds or "video" in kinds:
            layers["visual"] += [
                {"id": "IMG-CONTRAST", "name": "Text contrast", "source": "WCAG 2.1 success criterion 1.4.3"},
                {"id": "IMG-BRAND-COLOUR", "name": "Uses brand colours", "source": "Brand kit colours"},
                {"id": "IMG-BRAND", "name": "Brand name or logo visible", "source": "Brand kit: brand name and logo"},
                {"id": "IMG-REQUIRED", "name": "Required text present", "source": "Brand kit required text"},
            ]
        if "image" in kinds:
            layers["visual"].append({"id": "IMG-ALT", "name": "Alt text", "source": "WCAG 2.1 success criterion 1.1.1"})
    return {"label": schema["label"], "layers": [{"id": L["id"], "label": L["label"], "checks": layers[L["id"]]} for L in LAYERS],
            "required_fields": [x["id"] for x in schema["fields"] if x.get("required")],
            "optional_fields": [x["id"] for x in schema["fields"] if not x.get("required")]}


def config():
    """Everything the composer needs in one call."""
    return {
        "platforms": [{"id": pid, "label": p["label"], "layout": p["layout"],
                       "formats": [{"id": fid, "label": f["label"]} for fid, f in p["formats"].items()]}
                      for pid, p in PLATFORMS.items()],
        "contexts": [{"id": cid, "label": c["label"], "help": c["help"]} for cid, c in CONTEXTS.items()],
        "layers": LAYERS,
    }


# ---------- input validation (missing fields, invalid uploads) ----------

URL_RE = re.compile(r"^https?://[^\s/$.?#][^\s]*\.[^\s]{2,}", re.I)


def input_errors(platform, fmt, context, fields, media):
    """Problems with what was entered: missing required fields, wrong or too many uploads, bad links.
    These stop a post from being sent for review; they are not compliance findings."""
    schema = input_schema(platform, fmt, context)
    errors = []
    for x in schema["fields"]:
        if x["type"] == "media":
            n = len(media)
            wrong = [m for m in media if m.get("kind", "image") not in x["kinds"]]
            if wrong:
                errors.append({"field": "media", "message": f"{wrong[0].get('file_name') or 'An upload'} is a {wrong[0].get('kind', 'image')}; "
                               f"{schema['label']} accepts {x['noun']} only."})
            if n < x["min"]:
                errors.append({"field": "media", "message": f"Add at least {x['min']} {x['noun']}{'s' if x['min'] > 1 else ''}."})
            if n > x["max"]:
                errors.append({"field": "media", "message": f"Use at most {x['max']} {x['noun']} upload{'s' if x['max'] > 1 else ''}."})
            continue
        value = (fields.get(x["id"]) or "").strip()
        if x.get("required") and not value:
            errors.append({"field": x["id"], "message": f"{x['label']} is required for {schema['label']}."})
        elif value and x["type"] == "url" and not URL_RE.match(value):
            errors.append({"field": x["id"], "message": f"{x['label']} must be a full web address starting with https://"})
        elif value and x["type"] == "date":
            try:
                date.fromisoformat(value)
            except ValueError:
                errors.append({"field": x["id"], "message": f"{x['label']} must be a date."})
    start, end = fields.get("offer_valid_from"), fields.get("offer_valid_until")
    if start and end and start > end:
        errors.append({"field": "offer_valid_until", "message": "The offer ends before it starts."})
    return errors


def text_parts(platform, fmt, context, fields):
    """Every typed text field that goes through the brand, regulation and fact checks, with its location."""
    schema = input_schema(platform, fmt, context)
    parts = []
    for x in schema["fields"]:
        if x["id"] in INTERNAL_FIELDS:
            continue
        if x["type"] in ("text", "longtext", "lines") and (fields.get(x["id"]) or "").strip():
            loc = "caption" if x["id"] == "main_text" else f"field:{x['id']}"
            parts.append((loc, x["id"], fields[x["id"]]))
    return parts


# ---------- layer 1 and context checks ----------

DISCLOSURE_RE = re.compile(
    r"#(ad|ads|advertisement|sponsored|collab|collaboration|partnership|paidpartnership|employeepost|freegift)\b"
    r"|\b(paid partnership|advertisement|sponsored|employee post|free gift)\b", re.I)
HASHTAG_RE = re.compile(r"#\w+")
FREE_RE = re.compile(r"\bfree\b", re.I)


def _finding(rule_id, name, layer, severity, why, sources, location="caption", quote="", suggestion="",
             outcome="Rule risk", confidence="High", start=0, end=0):
    f = engine._finding(rule_id=rule_id, name=name, category=next(L["label"] for L in LAYERS if L["id"] == layer),
                        severity=severity, start=start, end=end, text=quote, why=why, sources=sources,
                        suggestion=suggestion, location=location, outcome=outcome)
    return f | {"layer": layer, "confidence": confidence}


def platform_findings(platform, fmt, context, fields, media, today=None):
    """Layer 1 (platform requirements) plus the context checks: disclosure for endorsements and offer validity."""
    p, f, c = get_combo(platform, fmt, context)
    today = (today or date.today()).isoformat()
    out = []
    main = fields.get("main_text") or ""
    limit = p.get("text_limit")
    if limit and not f.get("no_caption") and len(main) > limit["max"]:
        out.append(_finding("PLAT-LENGTH", "Text longer than the platform allows", "platform", "warning",
                            f"The {p['main_label'].lower()} has {len(main):,} characters; {p['label']} allows {limit['max']:,}. "
                            "The platform will cut it off or refuse to publish it.", [limit["source"]],
                            suggestion=f"Shorten it by {len(main) - limit['max']:,} characters"))
    hl = p.get("hashtag_limit")
    if hl:
        tags = HASHTAG_RE.findall(main + " " + (fields.get("hashtags") or ""))
        if len(tags) > hl["max"]:
            out.append(_finding("PLAT-HASHTAGS", "Too many hashtags", "platform", "warning",
                                f"The post has {len(tags)} hashtags; {p['label']} allows up to {hl['max']}.", [hl["source"]],
                                location="field:hashtags", suggestion=f"Remove {len(tags) - hl['max']} hashtags"))
    asp = f.get("aspect")
    if asp:
        for n, m in enumerate(media, 1):
            w, h = m.get("width"), m.get("height")
            if not w or not h:
                continue
            r = w / h
            if r < asp["min"] - 0.01 or r > asp["max"] + 0.01:
                kind = m.get("kind", "image")
                out.append(_finding("PLAT-ASPECT", "Shape doesn't fit this format", "platform", "suggestion",
                                    f"{kind.title()} {n} is {w}×{h} (about {r:.2f}:1). {f['label']} {'works best' if asp.get('recommended') else 'supports'} "
                                    f"{asp['label']}, so the platform may crop or letterbox it.", [asp["source"]],
                                    location=f"{kind} {n}", suggestion=f"Resize to {asp['label']}"))
    poll = f.get("poll")
    if poll:
        q = (fields.get("poll_question") or "").strip()
        opts = [o.strip() for o in (fields.get("poll_options") or "").splitlines() if o.strip()]
        problems = []
        if len(q) > poll["question_max"]:
            problems.append(f"the question has {len(q)} characters (limit {poll['question_max']})")
        if opts and not poll["options_min"] <= len(opts) <= poll["options_max"]:
            problems.append(f"there are {len(opts)} options (needs {poll['options_min']} to {poll['options_max']})")
        long_opts = [o for o in opts if len(o) > poll["option_max"]]
        if long_opts:
            problems.append(f"{len(long_opts)} option(s) are longer than {poll['option_max']} characters")
        if problems:
            out.append(_finding("PLAT-POLL", "Poll doesn't fit LinkedIn's limits", "platform", "warning",
                                "In this poll, " + "; ".join(problems) + ".", [poll["source"]], location="field:poll_options"))

    if c.get("endorsement"):
        out += _disclosure_findings(p, f, fields, media)
    if c.get("offer"):
        out += _offer_findings(fields, media, today)
    return out


def _disclosure_findings(p, f, fields, media):
    texts = [("caption", fields.get("main_text") or ""), ("field:creator_script", fields.get("creator_script") or "")]
    texts += [(f"{m.get('kind', 'image')} {n}", m.get("text") or "") for n, m in enumerate(media, 1)]
    hits = [(loc, mt) for loc, t in texts for mt in DISCLOSURE_RE.finditer(t)]
    sources = [ASCI_INFLUENCER + ": a disclosure label such as #ad, #collab or #sponsored must be upfront and prominent",
               CCPA_ENDORSE + ": disclosures must be prominent and not buried in a group of hashtags or links"]
    out = []
    platform_label = (fields.get("disclosure") or "") == "Platform paid-partnership label"
    if not hits and not platform_label:
        out.append(_finding("CTX-DISCLOSURE", "Endorsement is not disclosed", "regulation", "blocker",
                            f"This is marked as a {('paid partnership' if fields.get('relationship') else 'brand collaboration')}, "
                            "but no disclosure label was found in the text, the script or the images.",
                            sources, suggestion="#ad ", outcome="Rule risk"))
        return out
    if not hits and platform_label:
        out.append(_finding("CTX-DISCLOSURE-PLATFORM", "Platform label needs to be switched on", "regulation", "warning",
                            "You chose the platform's paid-partnership label, which is applied when publishing. "
                            "The app can't see it, so confirm it is switched on.", sources,
                            outcome="Couldn't verify", confidence="Unverified"))
    caption_hits = [mt for loc, mt in hits if loc == "caption"]
    main = fields.get("main_text") or ""
    if caption_hits and all(_buried(main, mt) for mt in caption_hits):
        mt = caption_hits[0]
        out.append(_finding("CTX-DISCLOSURE-BURIED", "Disclosure is buried among hashtags", "regulation", "warning",
                            "The disclosure label only appears inside a group of hashtags at the end, where it is easy to miss.",
                            sources, quote=mt.group(0), start=mt.start(), end=mt.end(),
                            suggestion="Put the label at the start of the caption"))
    if f.get("no_caption") and not any(loc != "caption" and not loc.startswith("field:") for loc, _ in hits) and not platform_label:
        out.append(_finding("CTX-DISCLOSURE-ON-IMAGE", "Label should be on the story itself", "regulation", "warning",
                            "Stories have no caption, so the disclosure must be shown on the image or video. "
                            "No label was read on it.", [ASCI_INFLUENCER + ": for picture or video-only posts, the label must be superimposed on the content"],
                            location="image 1", outcome="Couldn't verify", confidence="Medium"))
    if any(m.get("kind") == "video" for m in media):
        out.append(_finding("CTX-DISCLOSURE-VIDEO", "Check the label inside the video", "regulation", "suggestion",
                            "The app reads one frame of a video, so it can't confirm how long the label is on screen. "
                            "Check that the label is shown in the video for long enough to be noticed.",
                            [ASCI_INFLUENCER + ": in videos the label must stay on screen long enough to be noticed"],
                            location="video 1", outcome="Couldn't verify", confidence="Unverified"))
    return out


def _buried(text, match):
    """True when the label is one of 3 or more hashtags grouped at the end, after the actual message."""
    if not match.group(0).startswith("#"):
        return False
    tail = re.search(r"(?:#\w+\s*)+$", text)
    if not tail or not tail.start() <= match.start() < tail.end():
        return False
    return len(HASHTAG_RE.findall(tail.group(0))) >= 3 and bool(text[:tail.start()].strip())


def _offer_findings(fields, media, today):
    out = []
    until, start = fields.get("offer_valid_until") or "", fields.get("offer_valid_from") or ""
    if until and until < today:
        out.append(_finding("CTX-OFFER-ENDED", "Offer has already ended", "facts", "blocker",
                            f"The offer end date you entered is {until}, which is before today ({today}).",
                            ["Offer validity entered in the composer", CCPA_2022 + ": an advertisement must not be misleading"],
                            location="field:offer_valid_until", suggestion="Update the dates or remove the offer"))
    elif start and start > today:
        out.append(_finding("CTX-OFFER-FUTURE", "Offer hasn't started yet", "facts", "suggestion",
                            f"The offer starts on {start}. Schedule the post for then, or say when it starts.",
                            ["Offer validity entered in the composer"], location="field:offer_valid_from"))
    all_text = " ".join([fields.get("main_text") or "", fields.get("headline") or "", fields.get("offer_details") or ""]
                        + [m.get("text") or "" for m in media])
    if FREE_RE.search(all_text) and not (fields.get("offer_terms") or "").strip():
        out.append(_finding("CTX-OFFER-TERMS", "“Free” offer without its conditions", "regulation", "warning",
                            "The post says “free” but no terms are given. If anything must be bought or paid to get it, say so.",
                            [CCPA_2022 + ": conditions for ‘free’ claims", ASCI_CODE], location="field:offer_terms",
                            suggestion="Add the offer terms or a link to them"))
    if until and until >= today and until not in all_text and not _mentions_date(all_text):
        out.append(_finding("CTX-OFFER-DATE-MISSING", "Offer end date not mentioned", "regulation", "suggestion",
                            "The post doesn't say when the offer ends. Stating it avoids misleading people who see the post later.",
                            [ASCI_CODE], suggestion=f"Add “Valid till {until}”"))
    return out


def _mentions_date(text):
    return bool(re.search(r"\b(till|until|valid|ends?|last date|offer ends|\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))", text, re.I))


def platform_check_ids(platform, fmt, context, media):
    """The (check id, location, name) of every platform and context check that ran, for pass counts."""
    p, f, c = get_combo(platform, fmt, context)
    out = []
    if p.get("text_limit") and not f.get("no_caption"):
        out.append(("PLAT-LENGTH", "caption", "Within the platform's text limit"))
    if p.get("hashtag_limit"):
        out.append(("PLAT-HASHTAGS", "field:hashtags", "Hashtag count within limit"))
    if f.get("aspect"):
        out += [("PLAT-ASPECT", f"{m.get('kind', 'image')} {n}", "Image shape fits the format") for n, m in enumerate(media, 1)
                if m.get("width")]
    if f.get("poll"):
        out.append(("PLAT-POLL", "field:poll_options", "Poll within limits"))
    if c.get("endorsement"):
        out.append(("CTX-DISCLOSURE", "caption", "Endorsement disclosed"))
    if c.get("offer"):
        out += [("CTX-OFFER-ENDED", "field:offer_valid_until", "Offer period is current"),
                ("CTX-OFFER-TERMS", "field:offer_terms", "Offer conditions stated")]
    return out


# ---------- multi-platform adaptation ----------

def adapt_fields(fields, src_platform, target_platform, target_format, context):
    """Copy a post's content into another platform's fields. Structure only: the wording is not rewritten.
    (AI rewriting would plug in here; it is off because the team keeps AI out of post content in Round 2.)"""
    schema = input_schema(target_platform, target_format, context)
    wanted = {x["id"] for x in schema["fields"]}
    out = {k: v for k, v in fields.items() if k in wanted and v}
    main = (fields.get("main_text") or "").strip()
    if "headline" in wanted and not out.get("headline") and main:
        first = re.split(r"(?<=[.!?])\s+|\n", main, maxsplit=1)[0]
        out["headline"] = first[:150]
    if "hashtags" not in wanted and fields.get("hashtags") and "main_text" in wanted and target_platform != "website":
        out["main_text"] = (out.get("main_text", main) + "\n\n" + fields["hashtags"]).strip()
    if target_platform in ("website", "whatsapp") and out.get("main_text"):
        out["main_text"] = re.sub(r"(?:\s*#\w+)+\s*$", "", out["main_text"]).strip()
    if "cta" in wanted and not out.get("cta") and fields.get("url") and target_platform == "website":
        out["cta"] = "Learn more"
    return out


def adapt_media(media, target_platform, target_format):
    f = PLATFORMS[target_platform]["formats"][target_format]
    m = f.get("media")
    if not m:
        return []
    return [x for x in media if x.get("kind", "image") in m["kinds"]][: m["max"]]


def legacy_combo(channel):
    return LEGACY_CHANNELS.get(channel, ("instagram", "feed", "organic"))
