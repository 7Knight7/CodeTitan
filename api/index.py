"""Live Brand Check API (FastAPI). Deployed as a Vercel Python function; runs locally with uvicorn.

Security model (see SECURITY.md):
- Every /api route except /api/health and /api/login needs a valid signed session cookie.
- Every state-changing request must carry the header X-LBC: 1 (blocks cross-site form posts).
- Identity and role come from the session only; request bodies cannot claim a user or role.
- Findings are computed on the server on every save; the browser cannot submit its own findings.
"""
import base64
import os
import re
import sys
import time
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from typing import Annotated, Literal, Optional

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from _lbc import auth, brandfit, brandkit, engine, memory, platforms  # noqa: E402
from _lbc.brandapply import build_workspace  # noqa: E402
from _lbc.store import get_store, storage_mode  # noqa: E402

app = FastAPI(title="Live Brand Check API", docs_url=None, redoc_url=None, openapi_url=None)

SENIOR_ROLE = "Marketing head"
ADMIN_ROLES = {SENIOR_ROLE}
REVIEW_ROLES = {"Reviewer", SENIOR_ROLE}
CREATOR_ROLES = {"Creator"}
PUBLIC = {"/api/health", "/api/login"}
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}

Short = Annotated[str, Field(max_length=150)]
Text = Annotated[str, Field(max_length=5000)]
Note = Annotated[str, Field(max_length=500)]
Day = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api"):
        return await call_next(request)
    if request.method in UNSAFE and request.headers.get("x-lbc") != "1":
        return JSONResponse({"detail": "Request blocked: missing X-LBC header."}, status_code=403)
    try:
        if path not in PUBLIC:
            session = auth.read_token(request.cookies.get(auth.COOKIE, ""))
            if not session:
                return JSONResponse({"detail": "Sign in to continue."}, status_code=401)
            request.state.session = session
        response = await call_next(request)
    except RuntimeError as exc:  # missing server configuration, never a stack trace
        return JSONResponse({"detail": f"Server is not configured: {exc}."}, status_code=500)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def me(request: Request):
    return request.state.session


def need(request: Request, roles, action):
    s = me(request)
    if s["role"] not in roles:
        raise HTTPException(403, f"Only {' or '.join(sorted(roles))} can {action}.")
    return s


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id():
    return uuid.uuid4().hex[:8]


def workspace():
    s = get_store()
    meta = s.get("meta", "workspace") or {}
    return {
        "meta": meta,
        "guidelines": sorted(s.list("guideline"), key=lambda g: int(g["id"][1:])),
        "rules": sorted(s.list("rule"), key=lambda r: int(r["id"][1:])),
        "facts": sorted(s.list("fact"), key=lambda f: f["id"]),
        "confidential_terms": meta.get("confidential_terms", []),
    }


def log(draft_id, actor, role, action, detail=""):
    get_store().put("event", {"id": new_id(), "draft_id": draft_id, "actor": actor, "role": role,
                              "action": action, "detail": detail[:600], "at": now()})


# ---------- sessions ----------

class LoginIn(BaseModel):
    password: Annotated[str, Field(max_length=128)] = ""
    role: Literal["Creator", "Reviewer", "Marketing head"] = "Creator"


class RoleIn(BaseModel):
    role: Literal["Creator", "Reviewer", "Marketing head"]


def client_ip(request: Request):
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def set_session(request: Request, response: JSONResponse, role):
    secure = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
    response.set_cookie(auth.COOKIE, auth.make_token(role), max_age=auth.SESSION_TTL, httponly=True,
                        secure=secure, samesite="lax", path="/")
    return response


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    if auth.password_required():
        ip = client_ip(request)
        if not auth.allow_attempt(ip):
            raise HTTPException(429, "Too many wrong attempts. Wait 10 minutes and try again.")
        stored = os.environ.get("LBC_PASSWORD_HASH", "")
        if not stored:
            raise HTTPException(503, "Sign-in is not set up: the server has no LBC_PASSWORD_HASH.")
        if not auth.verify_password(body.password, stored):
            auth.record_failure(ip)
            time.sleep(0.4)
            raise HTTPException(401, "Wrong password.")
        auth.clear_failures(ip)
    log(None, auth.ROLES[body.role], body.role, "Signed in")
    return set_session(request, JSONResponse({"role": body.role, "name": auth.ROLES[body.role]}), body.role)


@app.get("/api/session")
def session(request: Request):
    s = me(request)
    return {"role": s["role"], "name": s["name"], "expires": s["exp"]}


@app.post("/api/session/role")
def switch_role(body: RoleIn, request: Request):
    log(None, auth.ROLES[body.role], body.role, "Switched role", f"from {me(request)['role']}")
    return set_session(request, JSONResponse({"role": body.role, "name": auth.ROLES[body.role]}), body.role)


@app.post("/api/logout")
def logout():
    r = JSONResponse({"ok": True})
    r.delete_cookie(auth.COOKIE, path="/")
    return r


# ---------- checks ----------

class ImageMeta(BaseModel):
    """One upload, measured in the browser: an image, one frame of a video, or the text of a PDF.
    A small JPEG preview (max 480 px) is kept so reviewers can see the post; full files are never stored."""
    kind: Literal["image", "video", "document"] = "image"
    file_name: Short = ""
    preview: Optional[Annotated[str, Field(max_length=300_000, pattern=r"^data:image/jpeg;base64,[A-Za-z0-9+/=]+$")]] = None
    text: Annotated[str, Field(max_length=20000)] = ""
    alt_text: Note = ""
    contrast_min: Optional[Annotated[float, Field(ge=1, le=21)]] = None
    contrast_text: Short = ""
    palette: Annotated[list[dict], Field(max_length=8)] = []
    brand_share: Optional[Annotated[float, Field(ge=0, le=1)]] = None
    logo_score: Optional[Annotated[float, Field(ge=-1, le=1)]] = None
    ocr_confidence: Optional[Annotated[float, Field(ge=0, le=100)]] = None
    width: Optional[Annotated[int, Field(ge=1, le=20000)]] = None
    height: Optional[Annotated[int, Field(ge=1, le=20000)]] = None
    duration: Optional[Annotated[float, Field(ge=0, le=36000)]] = None
    pages: Optional[Annotated[int, Field(ge=0, le=5000)]] = None


FieldText = Annotated[str, Field(max_length=5000)]
Media = Annotated[list[ImageMeta], Field(max_length=10)]


class PostIn(BaseModel):
    """Where (platform), how (format) and under what commercial context, plus the composer's fields.
    Posts saved before platforms existed only have a channel name; they keep working as before."""
    content: Text = ""
    channel: Short = "Instagram post"
    platform: Optional[Short] = None
    format: Optional[Short] = None
    context: Short = "organic"
    fields: Annotated[dict[Annotated[str, Field(max_length=40)], FieldText], Field(max_length=40)] = {}
    images: Media = []


class CheckIn(PostIn):
    pass


def stored_post(d):
    """The platform details of a saved draft, in the shape run_all expects (None for old channel-only posts)."""
    if not d.get("platform"):
        return None
    return {"platform": d["platform"], "format": d["format"], "context": d.get("context", "organic"),
            "fields": dict(d.get("fields") or {}) | {"main_text": d.get("content", "")}}


def post_of(body):
    """The platform/format/context and the fields that belong to it, or None for an old channel-only post."""
    if not body.platform:
        return None
    try:
        platforms.get_combo(body.platform, body.format or "", body.context)
    except platforms.ConfigError as exc:
        raise HTTPException(400, str(exc))
    fields = {k: v for k, v in body.fields.items() if k in platforms.FIELDS and k != "main_text"}
    fields["main_text"] = body.content
    return {"platform": body.platform, "format": body.format, "context": body.context, "fields": fields}


def hex_to_lab(h):
    h = h.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047
    y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722
    z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883
    f = [t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116 for t in (x, y, z)]
    return 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])


def delta_e(a, b):
    return sum((p - q) ** 2 for p, q in zip(hex_to_lab(a), hex_to_lab(b))) ** 0.5


def valid_hex(h):
    return isinstance(h, str) and len(h) == 7 and h[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in h[1:])


def _norm(s):
    return re.sub(r"[^a-z0-9@.]+", "", s.lower())


def required_missing(required, text):
    """A required line counts as present if its URLs, emails and phone numbers appear, or the whole line does."""
    hay = _norm(text)
    missing = []
    for line in required:
        tokens = re.findall(r"(?:https?://)?(?:www\.)?[\w-]+\.(?:com|in|org|net|edu|co\.in)\b|[\w.+-]+@[\w-]+\.[\w.]+|(?:\+91[\s-]?)?[6-9]\d{9}", line, re.I)
        quoted = re.findall(r"[\"\u201c]([^\"\u201d]{3,60})[\"\u201d]", line)
        keys = tokens + quoted or [line]
        if not all(_norm(re.sub(r"^https?://", "", k)) in hay for k in keys):
            missing.append(line)
    return missing


def image_findings(img: ImageMeta, n, meta):
    """Layer 5: what the browser measured in an image or a video frame. PDFs only have text, checked elsewhere."""
    loc = f"{img.kind} {n}"
    out = []
    if img.kind == "document":
        return out
    is_video = img.kind == "video"
    what = "this video frame" if is_video else "this image"
    colours = meta.get("brand_colours", [])
    palette_hint = ", ".join(f"{c['name']} {c['hex']}" for c in colours[:3]) or "the brand colours"

    def add(rule_id, name, category, severity, why, sources, suggestion="", quote="", **extra):
        out.append(engine._finding(rule_id=rule_id, name=name, category=category, severity=severity,
                                   start=0, end=0, text=quote, why=why, sources=sources,
                                   suggestion=suggestion, location=loc, **extra) | {"layer": "visual"})

    if img.ocr_confidence is not None and img.ocr_confidence < 60 and img.text.strip():
        add("IMG-OCR", "Text was hard to read", "Reading quality", "suggestion",
            f"The text in {what} was read with low confidence ({img.ocr_confidence:.0f}%). Check the extracted text and correct it if needed, then check again.",
            ["Text recognition (OCR) confidence"])
    if img.contrast_min is not None and img.contrast_min < 4.5:
        add("IMG-CONTRAST", "Low text contrast", "Accessibility", "warning",
            f"The text “{img.contrast_text[:40]}” has a contrast ratio of about {img.contrast_min:.1f}:1; the minimum is 4.5:1.",
            ["WCAG 2.1 success criterion 1.4.3 (contrast minimum)"], f"Use darker text on a light background from {palette_hint}", img.contrast_text[:60])
    if not is_video and not img.alt_text.strip():
        add("IMG-ALT", "Missing alt text", "Accessibility", "warning",
            "The image has no alt text, so screen-reader users get no description.",
            ["WCAG 2.1 success criterion 1.1.1 (non-text content)"], "Describe the image in one sentence, including any text it shows")
    if colours and img.brand_share is not None and img.brand_share < 0.25:
        add("IMG-BRAND-COLOUR", "Mostly off-brand colours", "Visual consistency", "warning",
            f"Only about {round(img.brand_share * 100)}% of {what} uses brand colours.",
            ["Brand kit colours: " + ", ".join(c["hex"] for c in colours[:6])], f"Rework the design using {palette_hint}")
    brand_hex = [c["hex"] for c in colours]
    for c in img.palette:
        share = c.get("share", 0)
        if valid_hex(c.get("hex")) and isinstance(share, (int, float)) and share >= 0.2 and brand_hex \
                and min(delta_e(c["hex"], h) for h in brand_hex) > 25:
            add("IMG-COLOUR", "Off-brand colour", "Visual consistency", "suggestion",
                f"About {round(share * 100)}% of {what} uses {c['hex']}, which is not close to any brand colour.",
                ["Brand kit colours"], f"Use {palette_hint}", c["hex"])
    logo_found = img.logo_score is not None and img.logo_score >= 0.6
    if meta.get("logo") and not logo_found and meta.get("logo_required"):
        add("IMG-LOGO", "Logo not found", "Visual consistency", "warning",
            f"The brand logo could not be found in {what}, and the brand kit says every post must carry it.",
            ["Brand kit: logo required"], "Add the approved logo",
            **({"outcome": "Couldn't verify"} if is_video else {}))
    name = meta.get("name", "")
    if name and _norm(name) not in _norm(img.text) and not logo_found:
        if is_video:  # one frame can't prove the brand never appears
            add("IMG-BRAND", "Brand not seen in the checked frame", "Visual consistency", "warning",
                f"Neither “{name}” nor the logo was found in the frame that was read. Check that the video shows the brand.",
                ["Brand kit: brand name and logo"], f"Show the logo or the name {name}", outcome="Couldn't verify")
        else:
            add("IMG-BRAND", "Brand not visible", "Visual consistency", "blocker",
                f"Neither the name “{name}” nor the logo was found in this image.",
                ["Brand kit: brand name and logo"], f"Add the logo or the name {name}")
    for line in required_missing(meta.get("required_text", []), img.text):
        add("IMG-REQUIRED", "Required text missing", "Required content", "suggestion" if is_video else "warning",
            f"The brand kit says every image must include: “{line[:120]}”." + (" It was not in the frame that was read." if is_video else ""),
            ["Brand kit required text"], line[:120], **({"outcome": "Couldn't verify"} if is_video else {}))
    return out


def checks_run(content, channel, images, ws, post=None):
    """Every check that was applied to this post, as (check_id, location, name). Used to count what passed."""
    meta, out = ws["meta"], []
    rules = [r for r in ws["rules"] if r.get("enabled", True) and r.get("pattern")]

    def text_checks(loc):
        if any(r.get("category") == "Brand wording" for r in rules):  # banned phrases count as one check
            out.append(("WORDING", loc, "No banned brand phrases"))
        out.extend((r["id"], loc, r["name"]) for r in rules if r.get("category") != "Brand wording")
        out.append(("FACTS", loc, "Fees, offers and results match approved facts"))

    if post:
        for loc, _, _ in platforms.text_parts(post["platform"], post["format"], post["context"], post["fields"]):
            text_checks(loc)
        out += platforms.platform_check_ids(post["platform"], post["format"], post["context"], [i.model_dump() for i in images])
    elif content.strip():
        text_checks("caption")
        if channel in engine.DISCLOSURE_CHANNELS:
            out.append((engine.DISCLOSURE_RULE["id"], "caption", engine.DISCLOSURE_RULE["name"]))
    colours = meta.get("brand_colours", [])
    for n, img in enumerate(images, 1):
        loc = f"{img.kind} {n}"
        if img.text.strip():
            text_checks(loc)
            if img.ocr_confidence is not None:
                out.append(("IMG-OCR", loc, "Text read clearly"))
        if img.kind == "document":
            continue
        if img.contrast_min is not None:
            out.append(("IMG-CONTRAST", loc, "Text contrast"))
        if img.kind == "image":
            out.append(("IMG-ALT", loc, "Alt text"))
        if colours and img.brand_share is not None:
            out.append(("IMG-BRAND-COLOUR", loc, "Uses brand colours"))
        if colours and img.palette:
            out.append(("IMG-COLOUR", loc, "No off-brand colour"))
        if meta.get("logo") and meta.get("logo_required"):
            out.append(("IMG-LOGO", loc, "Logo present"))
        if meta.get("name"):
            out.append(("IMG-BRAND", loc, "Brand visible"))
        if meta.get("required_text"):
            out.append(("IMG-REQUIRED", loc, "Required text present"))
    return out


def check_group(f):
    if f["rule_id"].startswith("FACT-"):
        return "FACTS"
    if f["rule_id"].startswith("CTX-DISCLOSURE"):
        return "CTX-DISCLOSURE"
    return "WORDING" if f.get("category") == "Brand wording" else f["rule_id"]


def passed_checks(applied, findings):
    fired = {(check_group(f), f["location"]) for f in findings}
    return [{"check": cid, "name": name, "location": loc} for cid, loc, name in applied if (cid, loc) not in fired]


def annotate(findings, images, ws, post=None):
    """Give every finding its validation layer, a confidence level and a readable location."""
    regulatory = {r["id"] for r in ws["rules"] if r.get("source_type") == "regulatory"} | {engine.DISCLOSURE_RULE["id"]}
    ocr = {f"{i.kind} {n}": i.ocr_confidence for n, i in enumerate(images, 1)}
    kinds = {f"{i.kind} {n}": i.kind for n, i in enumerate(images, 1)}
    platform = (post or {}).get("platform")
    for f in findings:
        rid, loc = f["rule_id"], f.get("location", "caption")
        if not f.get("layer"):
            f["layer"] = ("facts" if rid.startswith("FACT-") else "visual" if rid.startswith("IMG-")
                          else "regulation" if rid in regulatory else "brand")
        if f.get("outcome") == "Couldn't verify":
            f["confidence"] = "Unverified" if f.get("confidence") in (None, "High") else f["confidence"]
        elif not f.get("confidence"):
            if loc in ocr:
                if rid in ("IMG-CONTRAST", "IMG-BRAND-COLOUR", "IMG-COLOUR", "IMG-LOGO", "IMG-ALT"):
                    f["confidence"] = "High" if rid == "IMG-ALT" else "Medium"
                elif kinds.get(loc) == "document":
                    f["confidence"] = "High"
                else:
                    c = ocr.get(loc)
                    f["confidence"] = "High" if c is not None and c >= 85 else "Medium" if c is None or c >= 60 else "Low"
            else:
                f["confidence"] = "High"
        # how the creator can apply the suggestion: replace the marked words, add a label, or fix it by hand
        f["fix"] = ("replace" if f["end"] > f["start"] and f.get("suggestion") and not loc[:5] in ("image", "video", "docum")
                    else "append" if rid == engine.DISCLOSURE_RULE["id"] else "prepend" if rid == "CTX-DISCLOSURE" else "manual")
        if loc == "caption":
            f["location_label"] = platforms.field_label(platform, "main_text") if platform else "Caption"
        elif loc.startswith("field:"):
            f["location_label"] = platforms.field_label(platform, loc[6:]) if platform else loc[6:]
        else:
            f["location_label"] = loc[:1].upper() + loc[1:]
    return findings


def run_all(content, channel, images, post=None):
    ws = workspace()
    meta = ws["meta"]
    findings, verified = [], []
    if post:  # every typed field goes through the brand, regulation and fact checks
        for loc, _, text in platforms.text_parts(post["platform"], post["format"], post["context"], post["fields"]):
            findings += engine.check_rules(text, ws["rules"], channel, location=loc)
            f2, v2 = engine.check_facts(text, ws["facts"], location=loc)
            findings += f2
            verified += v2
    elif content.strip():
        findings, verified = engine.run_checks(content, channel, ws)
    for n, img in enumerate(images, 1):
        loc = f"{img.kind} {n}"
        if img.text.strip():
            findings += engine.check_rules(img.text, ws["rules"], channel, location=loc)
            f2, v2 = engine.check_facts(img.text, ws["facts"], location=loc)
            findings += f2
            verified += v2
        findings += image_findings(img, n, meta)
    if post:
        findings += platforms.platform_findings(post["platform"], post["format"], post["context"], post["fields"],
                                                [i.model_dump() for i in images])
    mem = get_store().get("memory", current_kit_id(meta))
    main = post["fields"].get("main_text", "") if post else content
    findings += memory.style_findings(mem, main, lambda rid, name, why, src, sugg: engine._finding(
        rule_id=rid, name=name, category="House style", severity="suggestion", start=0, end=0, text="", why=why,
        sources=src, suggestion=sugg, location="caption", confidence="Medium") | {"layer": "brand"})
    findings = engine.dedupe(findings)
    for f in findings:  # a mistake this brand's creators have fixed before
        n = memory.seen_before(mem, f["name"])
        if n >= 2:
            f["seen_before"] = n
            f["why"] = f"{f['why']} This has come up {n} times before in {meta.get('name', 'this brand')} posts."
    fit = post_brand_fit(content, images, findings, meta, post, memory.learned_topics(mem, meta.get("keywords") or []))
    if fit and fit["verdict"] == "no":
        findings.insert(0, brandfit.finding(fit) | {"id": engine._id()})
    findings = annotate(findings, images, ws, post)
    counts = Counter(f["severity"] for f in findings)
    applied = checks_run(content, channel, images, ws, post)
    if fit:
        applied.insert(0, ("BRAND-FIT", "post", f"Fits {fit['brand']}"))
    if memory.house_style(mem) and main.strip():
        applied.append(("MEM-STYLE", "caption", "Matches the brand's house style"))
    passed = passed_checks(applied, findings)
    if fit and fit["verdict"] == "weak":  # partly on brand: not counted as passed, and not a blocker either
        passed = [x for x in passed if x["check"] != "BRAND-FIT"]
    summary = {"blocker": counts["blocker"], "warning": counts["warning"], "suggestion": counts["suggestion"],
               "sensitive": any(f.get("sensitive") for f in findings),
               "checks_run": len(applied), "checks_passed": len(passed), "passed": passed,
               "layers": dict(Counter(f["layer"] for f in findings)), "brand_fit": fit}
    return findings, verified, summary


def other_brand_names(meta):
    """Brands that had their own kit in this workspace before (from archived posts), other than the live one."""
    names = {d.get("kit_name") for d in get_store().list("draft") if d.get("archived") and d.get("kit_name")}
    return sorted(n for n in names if n and n != meta.get("name") and n != "No brand kit yet")


def post_brand_fit(content, images, findings, meta, post=None, learned=()):
    """Is this a post for the live brand at all? See _lbc/brandfit.py."""
    if post:
        texts = [t for _, _, t in platforms.text_parts(post["platform"], post["format"], post["context"], post["fields"])]
        partner = {_norm(post["fields"].get(k, "")) for k in ("partner_brand", "sponsor") if post["fields"].get(k)}
    else:
        texts, partner = [content], set()
    texts += [i.text for i in images]
    others = [b for b in other_brand_names(meta) if _norm(b) not in partner]
    return brandfit.brand_fit(meta, texts, [i.model_dump() for i in images], findings, others, learned)


@app.get("/api/health")
def health():
    return {"ok": True, "storage": storage_mode(), "today": date.today().isoformat(),
            "login_configured": bool(os.environ.get("LBC_PASSWORD_HASH")) or not auth.password_required(),
            "password_required": auth.password_required(), "brand": (get_store().get("meta", "workspace") or {}).get("name", "")}


def need_input(content, images, post=None):
    if (get_store().get("meta", "workspace") or {}).get("empty"):
        raise HTTPException(409, "No brand kit is live yet. The marketing head must upload one in Brand workspace first.")
    typed = any((v or "").strip() for v in (post or {}).get("fields", {}).values())
    if not content.strip() and not images and not typed:
        raise HTTPException(400, "Add at least one image or some caption text.")


@app.post("/api/check")
def check(body: CheckIn):
    post = post_of(body)
    need_input(body.content, body.images, post)
    channel = platforms.channel_label(post["platform"], post["format"], post["context"]) if post else body.channel
    findings, verified, summary = run_all(body.content, channel, body.images, post)
    errors = platforms.input_errors(post["platform"], post["format"], post["context"], post["fields"],
                                    [i.model_dump() for i in body.images]) if post else []
    return {"findings": findings, "verified": verified, "summary": summary, "input_errors": errors,
            "profile": platforms.validation_profile(post["platform"], post["format"], post["context"], workspace()["rules"]) if post else None}


# ---------- platform intelligence: configuration-driven composer ----------

@app.get("/api/platforms")
def list_platforms():
    """Supported platforms, the formats of each, the commercial contexts and the validation layers."""
    return platforms.config()


@app.get("/api/platforms/{platform}/formats")
def platform_formats(platform: Annotated[str, Field(max_length=40)]):
    p = platforms.PLATFORMS.get(platform)
    if not p:
        raise HTTPException(404, "Unknown platform")
    return [{"id": fid, "label": f["label"]} for fid, f in p["formats"].items()]


def _combo_or_400(platform, fmt, context):
    try:
        platforms.get_combo(platform, fmt, context)
    except platforms.ConfigError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/input-schema")
def get_input_schema(platform: Annotated[str, Field(max_length=40)], format: Annotated[str, Field(max_length=40)],
                     context: Annotated[str, Field(max_length=40)] = "organic"):
    """The fields the composer shows for this platform, format and context, in order."""
    _combo_or_400(platform, format, context)
    return platforms.input_schema(platform, format, context)


@app.get("/api/validation-profile")
def get_validation_profile(platform: Annotated[str, Field(max_length=40)], format: Annotated[str, Field(max_length=40)],
                           context: Annotated[str, Field(max_length=40)] = "organic"):
    """Which checks run, layer by layer, for this combination."""
    _combo_or_400(platform, format, context)
    return platforms.validation_profile(platform, format, context, workspace()["rules"])


class PdfIn(BaseModel):
    file_name: Short
    data_b64: Annotated[str, Field(max_length=4_300_000)]


@app.post("/api/extract-text")
def extract_text(body: PdfIn, request: Request):
    """Read the text of a PDF attachment so it can be checked. The file is not stored."""
    need(request, CREATOR_ROLES, "attach documents")
    import io
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(base64.b64decode(body.data_b64, validate=True)))
        pages = [(pg.extract_text() or "") for pg in reader.pages[:300]]
    except Exception:
        raise HTTPException(400, "That file could not be read as a PDF.")
    text = "\n".join(pages).strip()
    return {"file_name": body.file_name, "pages": len(reader.pages), "text": text[:20000],
            "note": "" if text else "No text found in this PDF (it may be scanned images). Its text can't be checked."}


# ---------- workspace (read: everyone signed in; change: marketing head) ----------

@app.get("/api/workspace")
def get_workspace(request: Request):
    ws = workspace()
    today = date.today().isoformat()
    for f in ws["facts"]:
        f["status"] = "current" if f.get("valid_from", "") <= today <= f.get("valid_until", "") else (
            "expired" if f.get("valid_until", "") < today else "not yet valid")
    meta = ws["meta"]
    return ws | {"today": today, "can_edit": me(request)["role"] in ADMIN_ROLES,
                 "live": kit_is_live(meta), "empty": bool(meta.get("empty")), "password_required": auth.password_required(),
                 "post_count": len(live_drafts()), "archived_count": sum(1 for d in get_store().list("draft") if d.get("archived")), "meta": {k: v for k, v in meta.items() if k != "kit"}}


class FactIn(BaseModel):
    label: Optional[Short] = None
    amount: Optional[Annotated[int, Field(ge=0, le=100_000_000)]] = None
    percent: Optional[Annotated[int, Field(ge=0, le=100)]] = None
    valid_from: Optional[Day] = None
    valid_until: Optional[Day] = None
    full_course: Optional[Annotated[int, Field(ge=0, le=100000)]] = None
    interview_guidance: Optional[Annotated[int, Field(ge=0, le=100000)]] = None
    kind: Optional[Literal["fee", "offer", "result"]] = None
    owner: Optional[Short] = None


@app.put("/api/facts/{fact_id}")
def update_fact(fact_id: str, body: FactIn, request: Request):
    s_ = need(request, ADMIN_ROLES, "change approved facts")
    s = get_store()
    fact = s.get("fact", fact_id)
    if not fact:
        raise HTTPException(404, "Fact not found")
    changes = body.model_dump(exclude_none=True, exclude={"kind"})
    fact.update(changes)
    if fact["kind"] == "result":
        fact["total"] = fact.get("full_course", 0) + fact.get("interview_guidance", 0)
    s.put("fact", fact)
    log(None, s_["name"], s_["role"], "Updated fact", f"{fact_id}: " + ", ".join(f"{k}={v}" for k, v in changes.items()))
    return fact


@app.post("/api/facts")
def add_fact(body: FactIn, request: Request):
    s_ = need(request, ADMIN_ROLES, "add approved facts")
    s = get_store()
    if body.kind is None or not body.label or not body.valid_from or not body.valid_until:
        raise HTTPException(400, "A fact needs a type, a label and valid-from and valid-until dates.")
    ids = [int(f["id"][1:]) for f in s.list("fact")]
    fact = body.model_dump(exclude_none=True) | {"id": f"F{max(ids, default=0) + 1}"}
    if fact["kind"] == "result":
        fact["total"] = fact.get("full_course", 0) + fact.get("interview_guidance", 0)
    s.put("fact", fact)
    log(None, s_["name"], s_["role"], "Added fact", f"{fact['id']}: {fact['label']}")
    return fact


class GuidelineIn(BaseModel):
    text: Annotated[str, Field(min_length=5, max_length=1000)]


@app.put("/api/guidelines/{gid}")
def update_guideline(gid: str, body: GuidelineIn, request: Request):
    s_ = need(request, ADMIN_ROLES, "edit brand guidelines")
    s = get_store()
    g = s.get("guideline", gid)
    if not g:
        raise HTTPException(404, "Guideline not found")
    g["text"] = body.text.strip()
    g["updated_at"] = now()
    s.put("guideline", g)
    log(None, s_["name"], s_["role"], "Edited guideline", gid)
    return g


class RuleToggle(BaseModel):
    enabled: bool


@app.put("/api/rules/{rid}")
def toggle_rule(rid: str, body: RuleToggle, request: Request):
    s_ = need(request, ADMIN_ROLES, "turn rules on or off")
    s = get_store()
    r = s.get("rule", rid)
    if not r:
        raise HTTPException(404, "Rule not found")
    r["enabled"] = body.enabled
    s.put("rule", r)
    log(None, s_["name"], s_["role"], "Turned rule " + ("on" if body.enabled else "off"), rid)
    return r


# ---------- drafts and workflow ----------

class DraftIn(PostIn):
    title: Short = "Untitled draft"


def post_record(body, post):
    """What a draft stores about where and how it will be published."""
    if not post:
        return {"channel": body.channel}
    return {"channel": platforms.channel_label(post["platform"], post["format"], post["context"]),
            "platform": post["platform"], "format": post["format"], "context": post["context"],
            "fields": {k: v for k, v in post["fields"].items() if k != "main_text"},
            "input_errors": platforms.input_errors(post["platform"], post["format"], post["context"], post["fields"],
                                                   [i.model_dump() for i in body.images])}


def current_kit_id(meta=None):
    """Which brand kit the checks run against. Rule ids (R10, R11, ...) are renumbered per kit,
    so insights only compare posts checked against the same kit."""
    meta = workspace()["meta"] if meta is None else meta
    return meta.get("activated_at") or ("none" if meta.get("empty") else "seed")


def draft_kit_id(d, meta):
    if d.get("kit_id"):
        return d["kit_id"]
    if d.get("sample"):
        return "seed"
    act = meta.get("activated_at")
    return current_kit_id(meta) if not act or d.get("updated_at", "") >= act else "older"


def draft_brand(d, meta):
    """(kit id, brand name) a post was checked against, so history can be shown brand by brand."""
    kit = draft_kit_id(d, meta)
    if d.get("kit_name"):
        return kit, d["kit_name"]
    if kit == "seed":
        from _lbc import seed
        return kit, f"{seed.WORKSPACE['name']} (demo)"
    if kit == current_kit_id(meta):
        return kit, meta.get("name") or "Current brand"
    return kit, "Earlier brand kit"


def remember_raised(d, findings):
    """Keep every rule that fired on any version, so insights count fixed issues too.
    If the brand kit changed since the last check, start over: old rule ids mean something else now.
    The brand name is stored with the post so history stays grouped by brand."""
    meta = workspace()["meta"]
    kit = current_kit_id(meta)
    d["kit_name"] = meta.get("name") if kit not in ("seed", "none") else d.get("kit_name")
    if d.get("kit_id") != kit:
        d["raised"] = {}
        d["kit_id"] = kit
    raised = d.setdefault("raised", {})
    for f in findings:
        raised[f["rule_id"]] = f["name"]


def summary(d):
    review = d.get("review") or {}
    return {k: d.get(k) for k in ("id", "title", "channel", "status", "author", "version", "updated_at",
                                  "requires_senior", "platform", "format", "context", "campaign_id")} | {
        "preview": d["content"][:140] or (d.get("fields") or {}).get("headline", "")[:140] or " ".join(i.get("text", "") for i in d.get("images", []))[:140],
        "review": {k: review.get(k) for k in ("action", "comment", "by", "at", "version")} if review else None,
        "open_blockers": [b["name"] for b in open_blockers(d)]}


def get_or_404(draft_id, editable=False):
    d = get_store().get("draft", draft_id)
    if not d:
        raise HTTPException(404, "Draft not found")
    if editable and d.get("archived"):
        raise HTTPException(409, f"This post belongs to an earlier brand kit ({d.get('kit_name') or 'archived'}) and is kept as read-only history.")
    return d


def live_drafts():
    """Posts of the brand that is live now. Posts from earlier brand kits are archived history."""
    return [d for d in get_store().list("draft") if not d.get("archived")]


def archive_posts(meta, s_, reason):
    """Keep every post, its versions, decisions and audit trail, labelled with the brand it belonged to,
    so All history in Analytics and Insights still shows it. Archived posts leave Write and Review."""
    n = 0
    for d in get_store().list("draft"):
        if d.get("archived"):
            continue
        kit, name = draft_brand(d, meta)
        d.update(archived=True, archived_at=now(), kit_id=kit, kit_name=name)
        get_store().put("draft", d)
        n += 1
    if n:
        log(None, s_["name"], s_["role"], "Archived posts", f"{n} post(s) of {meta.get('name', 'the previous brand')} moved to history: {reason}")
    return n


@app.get("/api/drafts")
def list_drafts(status: Optional[Annotated[str, Field(max_length=80)]] = None):
    ds = live_drafts()
    if status:
        wanted = set(status.split(","))
        ds = [d for d in ds if d["status"] in wanted]
    return [summary(d) for d in sorted(ds, key=lambda d: d["updated_at"], reverse=True)]


@app.get("/api/drafts/{draft_id}")
def get_draft(draft_id: str):
    d = get_or_404(draft_id)
    events = sorted([e for e in get_store().list("event") if e.get("draft_id") == draft_id], key=lambda e: e["at"])
    return d | {"events": events, "open_blockers": [b["name"] for b in open_blockers(d)]}


@app.post("/api/drafts")
def create_draft(body: DraftIn, request: Request):
    s_ = need(request, CREATOR_ROLES, "create posts")
    post = post_of(body)
    need_input(body.content, body.images, post)
    rec = post_record(body, post)
    findings, verified, summ = run_all(body.content, rec["channel"], body.images, post)
    images = [i.model_dump() for i in body.images]
    d = {"id": new_id(), "title": body.title.strip() or "Untitled draft", **rec,
         "content": body.content, "images": images,
         "findings": findings, "verified": verified, "summary": summ,
         "status": "draft", "author": s_["name"], "version": 1,
         "versions": [{"version": 1, "content": body.content, "images": images, "fields": rec.get("fields"),
                       "channel": rec["channel"], "by": s_["name"], "at": now()}],
         "decisions": [], "created_at": now(), "updated_at": now()}
    remember_raised(d, findings)
    get_store().put("draft", d)
    log(d["id"], s_["name"], s_["role"], "Created draft", f"{rec['channel']}, version 1 with {len(findings)} findings")
    return d


@app.put("/api/drafts/{draft_id}")
def save_draft(draft_id: str, body: DraftIn, request: Request):
    s_ = need(request, CREATOR_ROLES, "edit posts")
    s = get_store()
    d = get_or_404(draft_id, editable=True)
    if d["status"] in ("in_review", "approved"):
        raise HTTPException(409, "This post is with the reviewer or already approved, so it can't be edited.")
    post = post_of(body)
    need_input(body.content, body.images, post)
    rec = post_record(body, post)
    findings, verified, summ = run_all(body.content, rec["channel"], body.images, post)
    images = [i.model_dump() for i in body.images]
    changed = (body.content != d["content"] or images != d.get("images", []) or rec.get("fields") != d.get("fields")
               or rec["channel"] != d.get("channel"))
    if changed:
        d["version"] += 1
        d["versions"].append({"version": d["version"], "content": body.content, "images": images, "fields": rec.get("fields"),
                              "channel": rec["channel"], "by": s_["name"], "at": now()})
        log(draft_id, s_["name"], s_["role"], "Saved new version", f"{rec['channel']}, version {d['version']} with {len(findings)} findings")
    for k in ("platform", "format", "context", "fields", "input_errors"):
        d.pop(k, None)
    d.update(title=body.title, content=body.content, images=images, **rec,
             findings=findings, verified=verified, summary=summ, updated_at=now())
    remember_raised(d, findings)
    s.put("draft", d)
    return d


LAYER_ORDER = [L["id"] for L in platforms.LAYERS]


@app.get("/api/drafts/{draft_id}/results")
def draft_results(draft_id: str):
    """The latest validation results of a post, grouped by layer, with the profile that produced them."""
    d = get_or_404(draft_id)
    fs = d.get("findings", [])
    profile = (platforms.validation_profile(d["platform"], d["format"], d.get("context", "organic"), workspace()["rules"])
               if d.get("platform") else None)
    return {"id": d["id"], "version": d["version"], "channel": d.get("channel"), "summary": d.get("summary"),
            "input_errors": d.get("input_errors", []), "profile": profile, "verified": d.get("verified", []),
            "layers": [{"id": L["id"], "label": L["label"], "findings": [f for f in fs if f.get("layer", "brand") == L["id"]]}
                       for L in platforms.LAYERS]}


class Target(BaseModel):
    platform: Short
    format: Short


class AdaptIn(BaseModel):
    targets: Annotated[list[Target], Field(min_length=1, max_length=5)]


@app.post("/api/drafts/{draft_id}/adapt")
def adapt(draft_id: str, body: AdaptIn, request: Request):
    """Create once, adapt everywhere: one linked draft per destination, each checked on its own and each
    needing its own human review. Content is restructured for the platform, not rewritten."""
    s_ = need(request, CREATOR_ROLES, "adapt posts")
    src = get_or_404(draft_id, editable=True)
    if not src.get("platform"):
        raise HTTPException(400, "Choose a platform and format for this post first, then adapt it.")
    need_input(src["content"], [], {"fields": src.get("fields") or {"main_text": src["content"]}})
    campaign = src.get("campaign_id") or src["id"]
    if not src.get("campaign_id"):
        src["campaign_id"] = campaign
        get_store().put("draft", src)
    src_fields = dict(src.get("fields") or {}) | {"main_text": src["content"]}
    created = []
    for t in body.targets:
        _combo_or_400(t.platform, t.format, src.get("context", "organic"))
        if t.platform == src["platform"] and t.format == src["format"]:
            continue
        fields = platforms.adapt_fields(src_fields, src["platform"], t.platform, t.format, src.get("context", "organic"))
        media = [ImageMeta(**{k: v for k, v in m.items() if k in ImageMeta.model_fields})
                 for m in platforms.adapt_media(src.get("images", []), t.platform, t.format)]
        body_in = DraftIn(title=f"{src['title']} ({platforms.PLATFORMS[t.platform]['label']})", content=fields.pop("main_text", ""),
                          platform=t.platform, format=t.format, context=src.get("context", "organic"), fields=fields, images=media)
        post = post_of(body_in)
        rec = post_record(body_in, post)
        findings, verified, summ = run_all(body_in.content, rec["channel"], media, post)
        images = [m.model_dump() for m in media]
        d = {"id": new_id(), "title": body_in.title, **rec, "content": body_in.content, "images": images,
             "findings": findings, "verified": verified, "summary": summ, "status": "draft", "author": s_["name"],
             "version": 1, "campaign_id": campaign, "adapted_from": src["id"],
             "versions": [{"version": 1, "content": body_in.content, "images": images, "fields": rec.get("fields"),
                           "channel": rec["channel"], "by": s_["name"], "at": now()}],
             "decisions": [], "created_at": now(), "updated_at": now()}
        remember_raised(d, findings)
        get_store().put("draft", d)
        log(d["id"], s_["name"], s_["role"], "Adapted from another post",
            f"From \u201c{src['title']}\u201d for {rec['channel']}: {len(findings)} findings, {len(rec.get('input_errors', []))} fields to complete. Needs its own review.")
        created.append({"id": d["id"], "title": d["title"], "channel": d["channel"], "summary": summ,
                        "input_errors": rec.get("input_errors", [])})
    log(src["id"], s_["name"], s_["role"], "Adapted for other platforms", ", ".join(c["channel"] for c in created))
    return {"campaign_id": campaign, "created": created,
            "note": "Each version keeps the original wording and approved claims, restructured for its platform. "
                    "Edit and check each one; every version needs its own review."}


class DecisionIn(BaseModel):
    finding_id: Annotated[str, Field(max_length=40)]
    action: Literal["accept", "edit", "reject"]
    reason: Note = ""
    new_text: Note = ""


@app.post("/api/drafts/{draft_id}/decisions")
def decide(draft_id: str, body: DecisionIn, request: Request):
    s_ = need(request, CREATOR_ROLES, "decide on findings")
    s = get_store()
    d = get_or_404(draft_id, editable=True)
    if d["status"] in ("in_review", "approved"):
        raise HTTPException(409, "This post is locked while it is with the reviewer or approved.")
    f = next((x for x in d.get("findings", []) if x["id"] == body.finding_id), None)
    if not f:
        raise HTTPException(404, "That finding is not in the current version. Check the post again.")
    if body.action == "reject" and len(body.reason.strip()) < 5:
        raise HTTPException(400, "Give a short reason for keeping the original text.")
    dec = {"id": new_id(), "finding_id": f["id"], "rule_id": f["rule_id"], "name": f["name"],
           "severity": f["severity"], "engine": f["engine"], "quote": f["quote"],
           "location": f["location"], "action": body.action, "reason": body.reason.strip(),
           "new_text": body.new_text, "by": s_["name"], "at": now()}
    d["decisions"].append(dec)
    d["updated_at"] = now()
    s.put("draft", d)
    remember(d, lambda m: memory.learn_decision(m, body.action, dec["name"], dec["quote"], dec["reason"], d.get("title") or "Untitled"))
    if body.action == "reject":
        s.put("override", {"id": dec["id"], "draft_id": draft_id, "rule_id": dec["rule_id"], "name": dec["name"],
                           "reason": dec["reason"], "by": s_["name"], "at": now()})
    verb = {"accept": "Accepted fix", "edit": "Edited fix", "reject": "Kept original (override)"}[body.action]
    log(draft_id, s_["name"], s_["role"], verb,
        f"{dec['name']}: \"{dec['quote']}\"" + (f" because {dec['reason']}" if dec["reason"] else ""))
    return dec


def post_text(d):
    """Everything a post says: its typed fields (not internal ones) and the text read from its images."""
    post = stored_post(d)
    parts = ([t for _, _, t in platforms.text_parts(post["platform"], post["format"], post["context"], post["fields"])]
             if post else [d.get("content", "")])
    return "\n".join(parts + [i.get("text", "") for i in d.get("images", [])])


def remember(d, update):
    """Teach the brand memory of the kit this post was checked against. The brand kit itself is never changed."""
    meta = workspace()["meta"]
    kid, name = draft_brand(d, meta)
    if kid in ("none", "older") or d.get("archived"):
        return
    mem = get_store().get("memory", kid) or memory.empty(kid, name)
    update(mem)
    get_store().put("memory", mem)


def open_blockers(d):
    rejected = {(x["rule_id"], x["quote"], x.get("location")) for x in d["decisions"] if x["action"] == "reject"}
    # "I will fix the image" counts for uploads; typed text must actually be changed (or kept with a reason)
    acknowledged = {(x["rule_id"], x.get("location")) for x in d["decisions"]
                    if x["action"] in ("accept", "edit") and (x.get("location") or "").split(" ")[0] in ("image", "video", "document")}
    return [f for f in d.get("findings", []) if f["severity"] == "blocker"
            and (f["rule_id"], f["quote"], f.get("location")) not in rejected
            and (f["rule_id"], f.get("location")) not in acknowledged]


@app.post("/api/drafts/{draft_id}/submit")
def submit(draft_id: str, request: Request):
    s_ = need(request, CREATOR_ROLES, "send posts for review")
    s = get_store()
    d = get_or_404(draft_id, editable=True)
    if d["status"] not in ("draft", "changes_requested"):
        raise HTTPException(409, "Only drafts or returned posts can be sent for review.")
    if d.get("input_errors"):
        raise HTTPException(400, {"message": f"{len(d['input_errors'])} field(s) to complete before sending: "
                                             + "; ".join(e["message"] for e in d["input_errors"][:3]),
                                  "input_errors": d["input_errors"]})
    blockers = open_blockers(d)
    if blockers:
        raise HTTPException(400, {"message": f"{len(blockers)} blocker(s) still open. Fix them, or keep the original with a reason.",
                                  "blockers": [b["name"] for b in blockers]})
    d["requires_senior"] = any(f.get("sensitive") for f in d.get("findings", []))
    d["status"] = "in_review"
    d["submitted_version"] = d["version"]
    d["submitted_by"] = s_["name"]
    d["updated_at"] = now()
    s.put("draft", d)
    log(draft_id, s_["name"], s_["role"], "Sent for review",
        f"Version {d['version']}" + (" (needs marketing head: sensitive topic)" if d["requires_senior"] else ""))
    return d


class ReviewIn(BaseModel):
    action: Literal["approve", "request_changes"]
    comment: Note = ""


@app.post("/api/drafts/{draft_id}/review")
def review(draft_id: str, body: ReviewIn, request: Request):
    s_ = need(request, REVIEW_ROLES, "review posts")
    s = get_store()
    d = get_or_404(draft_id, editable=True)
    if d["status"] != "in_review":
        raise HTTPException(409, "This post is not waiting for review.")
    if s_["name"] in (d.get("author"), d.get("submitted_by")):
        raise HTTPException(403, "You can't review a post you wrote or submitted.")
    if body.action == "approve" and d.get("requires_senior") and s_["role"] != SENIOR_ROLE:
        raise HTTPException(403, "This post mentions a sensitive topic, so only the marketing head can approve it.")
    if body.action == "request_changes" and len(body.comment.strip()) < 5:
        raise HTTPException(400, "Tell the creator what to change.")
    d["status"] = "approved" if body.action == "approve" else "changes_requested"
    d["review"] = {"action": body.action, "comment": body.comment.strip(), "by": s_["name"], "role": s_["role"],
                   "at": now(), "version": d["version"]}
    if body.action == "approve":
        d["approved_version"] = d["version"]
    d["updated_at"] = now()
    s.put("draft", d)
    title = d.get("title") or "Untitled"
    if body.action == "approve":
        kw = workspace()["meta"].get("keywords") or []
        remember(d, lambda m: memory.learn_approved(m, post_text(d), title, kw))
    else:
        remember(d, lambda m: memory.learn_feedback(m, body.comment.strip(), s_["name"], title))
    log(draft_id, s_["name"], s_["role"], "Approved" if body.action == "approve" else "Requested changes",
        f"Version {d['version']}" + (f": {body.comment.strip()}" if body.comment.strip() else ""))
    return d


# ---------- insights ----------

IMAGE_SOURCES = {
    "IMG-ALT": ("Accessibility", "WCAG 2.1 success criterion 1.1.1 (non-text content)"),
    "IMG-CONTRAST": ("Accessibility", "WCAG 2.1 success criterion 1.4.3 (contrast minimum)"),
    "IMG-OCR": ("Reading quality", "Text recognition (OCR) confidence"),
    "IMG-BRAND-COLOUR": ("Brand kit", "Brand kit colours"),
    "IMG-COLOUR": ("Brand kit", "Brand kit colours"),
    "IMG-LOGO": ("Brand kit", "Brand kit: logo required"),
    "IMG-BRAND": ("Brand kit", "Brand kit: brand name and logo"),
    "IMG-REQUIRED": ("Brand kit", "Brand kit required text"),
    "BRAND-FIT": ("Brand kit", "Brand kit: name, logo, colours, topics and approved offers"),
    "MEM-STYLE": ("Brand memory", "Brand memory: approved posts of this brand"),
}
GROUP_ORDER = ["Regulation", "Brand kit", "Brand memory", "Approved facts", "Accessibility", "Reading quality", "No longer active"]


def rule_origin(rid, active):
    """Where a rule comes from: an always-on regulation, the active brand kit, approved facts or accessibility."""
    if rid == engine.DISCLOSURE_RULE["id"]:
        return "Regulation", engine.DISCLOSURE_RULE["sources"][0]
    if rid in active:
        r = active[rid]
        group = "Regulation" if r.get("source_type") == "regulatory" else "Brand kit"
        return group, (r.get("sources") or [""])[0]
    if rid.startswith("FACT-"):
        return "Approved facts", "Approved facts sheet"
    if rid in IMAGE_SOURCES:
        return IMAGE_SOURCES[rid]
    return "No longer active", "A rule from an earlier brand kit or the demo data"


def scoped_drafts(scope, brand=None):
    """Posts checked against the active brand kit (default), every post ever checked ("all"),
    or, within all history, only the posts of one brand."""
    ws = workspace()
    drafts = get_store().list("draft")
    if scope == "all":
        if brand:
            kept = [d for d in drafts if draft_kit_id(d, ws["meta"]) == brand]
            return kept, ws, len(drafts) - len(kept)
        return drafts, ws, 0
    kit = current_kit_id(ws["meta"])
    kept = [d for d in drafts if draft_kit_id(d, ws["meta"]) == kit]
    return kept, ws, len(drafts) - len(kept)


def brand_groups(ws):
    """Every brand that has posts, current brand first, with how many posts each has."""
    meta = ws["meta"]
    current = current_kit_id(meta)
    groups = {}
    for d in get_store().list("draft"):
        kit, name = draft_brand(d, meta)
        g = groups.setdefault(kit, {"id": kit, "name": name, "posts": 0, "current": kit == current, "demo": kit == "seed"})
        g["posts"] += 1
    names = Counter(g["name"] for g in groups.values())
    for g in groups.values():
        if names[g["name"]] > 1 and g["id"][:4].isdigit():
            g["name"] = f"{g['name']} (from {g['id'][:10]})"
    return sorted(groups.values(), key=lambda g: (not g["current"], g["demo"], g["name"].lower()))


def kit_info(ws, scope, hidden, brand=None):
    m = ws["meta"]
    return {"name": m.get("name", ""), "file": m.get("kit_file") or "", "activated_at": m.get("activated_at"),
            "is_demo": not m.get("activated_at"), "scope": scope, "hidden_posts": hidden,
            "brand": brand, "brands": brand_groups(ws)}


Scope = Literal["kit", "all"]
BrandId = Optional[Annotated[str, Field(max_length=60)]]


@app.get("/api/insights")
def insights(request: Request, scope: Scope = "kit", brand: BrandId = None):
    need(request, REVIEW_ROLES, "see insights")
    drafts, ws, hidden = scoped_drafts(scope, brand)
    ids = {d["id"] for d in drafts}
    overrides = [o for o in get_store().list("override") if o.get("draft_id") in ids]
    active = {r["id"]: r for r in ws["rules"] if r.get("enabled", True)}
    raised, raised_in = Counter(), defaultdict(set)
    names = {}
    for d in drafts:
        fired = d.get("raised") or {f["rule_id"]: f["name"] for f in d.get("findings", [])}
        for rid, name in fired.items():
            raised[rid] += 1
            raised_in[rid].add(d["id"])
            names[rid] = name
    accepted = Counter(x["rule_id"] for d in drafts for x in d.get("decisions", []) if x["action"] in ("accept", "edit"))
    overridden = Counter(o["rule_id"] for o in overrides)
    reasons = defaultdict(list)
    for o in overrides:
        reasons[o["rule_id"]].append(o["reason"])
        names.setdefault(o["rule_id"], o["name"])
    rows = []
    for rid in set(raised) | set(overridden):
        n_raised, n_over = raised[rid], overridden[rid]
        rate = n_over / n_raised if n_raised else 0
        group, source = rule_origin(rid, active)
        rows.append({"rule_id": rid, "name": names.get(rid, rid), "group": group, "source": source,
                     "raised": n_raised, "drafts": len(raised_in[rid]),
                     "accepted": accepted[rid], "overridden": n_over, "override_rate": round(rate, 2),
                     "needs_review": n_over >= 2 and rate >= 0.4, "reasons": reasons[rid][-5:]})
    rows.sort(key=lambda r: (GROUP_ORDER.index(r["group"]), -r["raised"], r["rule_id"]))
    quiet = [{"rule_id": rid, "name": r["name"], "group": rule_origin(rid, active)[0], "source": (r.get("sources") or [""])[0]}
             for rid, r in active.items() if rid not in raised and rid not in overridden]
    status = Counter(d["status"] for d in drafts)
    if scope == "all" and brand and brand != current_kit_id(ws["meta"]):
        quiet = []  # an earlier brand's rules are not live, so "haven't fired yet" doesn't apply
    return {"kit": kit_info(ws, scope, hidden, brand), "groups": GROUP_ORDER, "rules": rows, "quiet": quiet,
            "status": dict(status), "drafts": len(drafts), "overrides": len(overrides),
            "fixed_before_review": sum(accepted.values())}


@app.get("/api/analytics")
def analytics(request: Request, scope: Scope = "kit", brand: BrandId = None):
    """Blockers, warnings and suggestions in the latest version of every post, and what passed."""
    need(request, REVIEW_ROLES, "see analytics")
    drafts, ws, hidden = scoped_drafts(scope, brand)
    by_brand = {}
    totals = Counter()
    by_category = defaultdict(Counter)
    by_issue = defaultdict(Counter)
    passed_by_check = Counter()
    posts = []
    for d in sorted(drafts, key=lambda d: d["updated_at"], reverse=True):
        findings = d.get("findings", [])
        sev = Counter(f["severity"] for f in findings)
        summ = d.get("summary") or {}
        if "checks_run" in summ:
            run, passed = summ["checks_run"], summ.get("passed", [])
        else:  # sample posts saved before pass counts existed: count against the current rules
            images = [ImageMeta(**{k: v for k, v in i.items() if k in ImageMeta.model_fields}) for i in d.get("images", [])]
            applied = checks_run(d.get("content", ""), d.get("channel", ""), images, ws, stored_post(d))
            run, passed = len(applied), passed_checks(applied, findings)
        for f in findings:
            by_category[f.get("category") or "Other"][f["severity"]] += 1
            by_issue[f["name"]][f["severity"]] += 1
        for p in passed:
            passed_by_check[p["name"]] += 1
        verified = len(d.get("verified", []))
        totals.update({**sev, "checks_run": run, "checks_passed": len(passed), "verified": verified})
        kit, brand_name = draft_brand(d, ws["meta"])
        b = by_brand.setdefault(kit, {"id": kit, "name": brand_name, "posts": 0, "blocker": 0, "warning": 0, "suggestion": 0,
                                      "checks_run": 0, "checks_passed": 0})
        b["posts"] += 1
        for k_ in ("blocker", "warning", "suggestion"):
            b[k_] += sev[k_]
        b["checks_run"] += run
        b["checks_passed"] += len(passed)
        posts.append({"id": d["id"], "title": d["title"], "status": d["status"], "sample": bool(d.get("sample")),
                      "brand": brand_name, "brand_id": kit,
                      "blocker": sev["blocker"], "warning": sev["warning"], "suggestion": sev["suggestion"],
                      "checks_run": run, "checks_passed": len(passed), "verified": verified})
    rank = lambda c: (-(c["blocker"] + c["warning"] + c["suggestion"]), c["name"])
    order = {g["id"]: i for i, g in enumerate(brand_groups(ws))}
    return {
        "kit": kit_info(ws, scope, hidden, brand),
        "by_brand": sorted(by_brand.values(), key=lambda b: order.get(b["id"], 99)),
        "totals": {k: totals[k] for k in ("blocker", "warning", "suggestion", "checks_run", "checks_passed", "verified")},
        "posts": posts,
        "categories": sorted(({"name": k} | {s: v[s] for s in ("blocker", "warning", "suggestion")} for k, v in by_category.items()), key=rank),
        "issues": sorted(({"name": k} | {s: v[s] for s in ("blocker", "warning", "suggestion")} for k, v in by_issue.items()), key=rank)[:12],
        "passed": [{"name": k, "count": v} for k, v in passed_by_check.most_common(12)],
    }


# ---------- brand kit (marketing head) ----------

class KitUpload(BaseModel):
    file_name: Short
    data_b64: Annotated[str, Field(max_length=4_300_000)]


@app.post("/api/brandkit/parse")
def parse_kit(body: KitUpload, request: Request):
    s_ = need(request, ADMIN_ROLES, "upload a brand kit")
    try:
        data = base64.b64decode(body.data_b64, validate=True)
        kit, status = brandkit.parse_brand_pdf(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(400, "The file could not be decoded. Upload the PDF again.")
    draft = {"id": "brandkit_draft", "file_name": body.file_name, "kit": kit, "status": status,
             "uploaded_by": s_["name"], "at": now()}
    get_store().put("meta", draft)
    log(None, s_["name"], s_["role"], "Uploaded brand kit", f"{body.file_name}: {status['message']}")
    return draft


@app.get("/api/brandkit")
def get_kit(request: Request):
    store = get_store()
    meta = workspace()["meta"]
    draft = store.get("meta", "brandkit_draft")
    live_kit = (meta.get("kit") or kit_from_live(workspace())) if kit_is_live(meta) else None
    return {"draft": draft, "live_kit": live_kit, "live": kit_is_live(meta), "ai_reader": brandkit.ai_enabled(),
            "can_edit": me(request)["role"] in ADMIN_ROLES}


class KitActivate(BaseModel):
    kit: dict
    logo_data_url: Optional[Annotated[str, Field(max_length=400_000, pattern=r"^data:image/(png|jpeg|svg\+xml);base64,")]] = None
    file_name: Optional[Short] = None
    confirm_reset: bool = False


def kit_is_live(meta):
    return bool(meta.get("activated_at")) and not meta.get("empty")


POST_TYPES = ["draft", "event", "override"]
KIT_TYPES = ["guideline", "rule", "fact"]


def _items(guidelines, rules, facts):
    return [("guideline", g) for g in guidelines] + [("rule", r) for r in rules] + [("fact", f) for f in facts]


@app.post("/api/brandkit/activate")
def activate_kit(body: KitActivate, request: Request):
    """Start a brand from scratch. Existing posts move to history under their old brand (nothing is deleted)."""
    s_ = need(request, ADMIN_ROLES, "activate a brand kit")
    store = get_store()
    old = workspace()["meta"]
    if kit_is_live(old):
        raise HTTPException(409, f"A brand kit for {old.get('name')} is already live. Update it, or reset it first to start a new brand.")
    if live_drafts() and not body.confirm_reset:
        raise HTTPException(409, "Activating a new brand kit moves every current post to history. Confirm to continue.")
    draft = store.get("meta", "brandkit_draft") or {}
    meta, guidelines, rules, facts = build_workspace(body.kit, body.logo_data_url, body.file_name or draft.get("file_name", ""))
    if not meta["brand_colours"] and not facts and not any(r.get("source_type") == "brand" and not _is_topic_rule(r) for r in rules):
        raise HTTPException(400, "The kit has nothing to activate. Add at least colours, banned phrases or facts.")
    meta |= {"kit": body.kit, "revision": 1, "updated_at": meta["activated_at"]}
    archive_posts(old, s_, f"new brand kit {meta['name']} activated")
    store.replace_types(KIT_TYPES, _items(guidelines, rules, facts))
    store.put("meta", meta)
    log(None, s_["name"], s_["role"], "Activated brand kit",
        f"{meta['name']}: {len(meta['brand_colours'])} colours, {len(rules)} rules, {len(facts)} facts, {len(guidelines)} guidelines. New posts start from zero.")
    return {"ok": True, "meta": meta, "counts": {"guidelines": len(guidelines), "rules": len(rules), "facts": len(facts)}}


def _is_topic_rule(r):
    return r.get("category") == "Needs senior review" and r.get("source_type") == "brand"


def _rule_key(r):
    return "sensitive-topics" if _is_topic_rule(r) else (r.get("pattern") or r["name"])


def keep_ids(old_rules, new_rules, old_facts, new_facts):
    """Rules and facts that did not change keep the same id as before, so history and insights stay linked."""
    by_key = {_rule_key(r): r["id"] for r in old_rules}
    taken = set(by_key.values())
    nxt = max([int(r["id"][1:]) for r in old_rules + new_rules if r["id"][1:].isdigit()] + [9]) + 1
    for r in new_rules:
        if _rule_key(r) in by_key:
            r["id"] = by_key[_rule_key(r)]
        else:
            r["id"] = f"R{nxt}"
            nxt += 1
    fkey = {(f["kind"], f["label"].lower()): f["id"] for f in old_facts}
    fnext = max([int(f["id"][1:]) for f in old_facts + new_facts if f["id"][1:].isdigit()] + [0]) + 1
    for f in new_facts:
        k = (f["kind"], f["label"].lower())
        if k in fkey:
            f["id"] = fkey[k]
        else:
            f["id"] = f"F{fnext}"
            fnext += 1
    return new_rules, new_facts


def _fact_text(f):
    v = (f"Rs {f.get('amount')}" if f["kind"] == "fee" else f"{f.get('percent')}% off" if f["kind"] == "offer"
         else f"{f.get('full_course')} paid + {f.get('interview_guidance')} free")
    return f"{f['label']}: {v} ({f.get('valid_from')} to {f.get('valid_until')})"


def _topics(rules):
    for r in rules:
        if _is_topic_rule(r):
            m = re.search(r"\((.*)\)", r.get("pattern", ""))
            return sorted(t.replace("\\", "") for t in m.group(1).split("|")) if m else []
    return []


def kit_diff(old_meta, old_rules, old_facts, old_guides, meta, rules, facts, guides):
    """What an update changes, area by area, in words the marketing head can check."""
    changes = []

    def area(name, before, after):
        before, after = list(dict.fromkeys(before)), list(dict.fromkeys(after))
        added = [x for x in after if x not in before]
        removed = [x for x in before if x not in after]
        if added or removed:
            changes.append({"area": name, "added": added, "removed": removed})

    area("Brand name", [old_meta.get("name", "")], [meta.get("name", "")])
    area("Colours", [f"{c['name']} {c['hex']}" for c in old_meta.get("brand_colours", [])],
         [f"{c['name']} {c['hex']}" for c in meta.get("brand_colours", [])])
    area("Fonts", old_meta.get("fonts", []), meta.get("fonts", []))
    area("Logo required on every image", ["Yes" if old_meta.get("logo_required") else "No"],
         ["Yes" if meta.get("logo_required") else "No"])
    if (old_meta.get("logo") or None) != (meta.get("logo") or None):
        changes.append({"area": "Logo", "added": ["New logo image"] if meta.get("logo") else [],
                        "removed": ["Previous logo image"] if old_meta.get("logo") else []})
    area("Required text on every image", old_meta.get("required_text", []), meta.get("required_text", []))
    area("What the brand talks about", old_meta.get("keywords", []), meta.get("keywords", []))
    brand_rules = lambda rs: [r["name"] for r in rs if r.get("source_type") == "brand" and not _is_topic_rule(r)]
    area("Banned words and wrong names", brand_rules(old_rules), brand_rules(rules))
    area("Sensitive topics", _topics(old_rules), _topics(rules))
    area("Approved facts", [_fact_text(f) for f in old_facts], [_fact_text(f) for f in facts])
    area("Guidelines and tone", [f"{g['section']}: {g['text']}" for g in old_guides], [f"{g['section']}: {g['text']}" for g in guides])
    return changes


OPEN_STATUSES = ("draft", "changes_requested", "in_review")


def recheck_open_posts(s_):
    """Run the updated kit over every post that is not approved yet. Approved posts keep the record they were approved on."""
    store, n = get_store(), 0
    for d in store.list("draft"):
        if d["status"] not in OPEN_STATUSES or d.get("archived"):
            continue
        try:
            images = [ImageMeta(**{k: v for k, v in i.items() if k in ImageMeta.model_fields}) for i in d.get("images", [])]
        except Exception:
            continue
        before = len(d.get("findings", []))
        post = stored_post(d)
        findings, verified, summ = run_all(d.get("content", ""), d.get("channel", ""), images, post)
        if post:
            d["input_errors"] = platforms.input_errors(post["platform"], post["format"], post["context"], post["fields"],
                                                       [i.model_dump() for i in images])
        d.update(findings=findings, verified=verified, summary=summ, updated_at=now())
        if d["status"] == "in_review":
            d["requires_senior"] = any(f.get("sensitive") for f in findings)
        remember_raised(d, findings)
        store.put("draft", d)
        log(d["id"], s_["name"], s_["role"], "Re-checked after brand kit update",
            f"Version {d['version']}: {len(findings)} findings (was {before})")
        n += 1
    return n


def _unescape(pattern):
    m = re.fullmatch(r"\\b(.*)\\b", pattern or "")
    return re.sub(r"\\(.)", r"\1", m.group(1)) if m else ""


def kit_from_live(ws):
    """Rebuild an editable kit from what is live, for kits activated before the confirmed kit was stored."""
    from _lbc.brandapply import DEFAULT_SENSITIVE
    meta = ws["meta"]
    src = lambda text: {"text": text}
    kit = {"brand_name": {"text": meta.get("name", "")},
           "colours": [dict(c) for c in meta.get("brand_colours", [])],
           "fonts": [{"name": f} for f in meta.get("fonts", [])],
           "logo_required": {"value": bool(meta.get("logo_required"))},
           "required_text": [src(t) for t in meta.get("required_text", [])],
           "keywords": [src(t) for t in meta.get("keywords", [])],
           "banned_phrases": [], "wrong_names": [], "sensitive_topics": [], "tone_rules": [], "guidelines": [], "facts": []}
    for r in ws["rules"]:
        if r.get("source_type") != "brand":
            continue
        if _is_topic_rule(r):
            kit["sensitive_topics"] = [src(t) for t in _topics([r]) if t not in DEFAULT_SENSITIVE]
        elif r.get("category") == "Terminology":
            kit["wrong_names"].append(src(_unescape(r.get("pattern"))))
        else:
            kit["banned_phrases"].append(src(_unescape(r.get("pattern"))))
    for g in ws["guidelines"]:
        if g["section"] == "Tone":
            kit["tone_rules"].append(src(g["text"]))
        elif g["section"] not in ("Colours", "Required on every image"):
            kit["guidelines"].append({"section": g["section"], "text": g["text"]})
    for f in ws["facts"]:
        kit["facts"].append({k: f[k] for k in ("kind", "label", "valid_from", "valid_until", "amount", "percent",
                                                 "full_course", "interview_guidance") if k in f})
    return kit


class KitUpdate(KitActivate):
    apply: bool = False


@app.post("/api/brandkit/update")
def update_kit(body: KitUpdate, request: Request):
    """Revise the live kit (edited, or from a revised PDF). Posts, history and insights are kept;
    unchanged rules keep their ids; open posts are checked again against the new version."""
    s_ = need(request, ADMIN_ROLES, "update the brand kit")
    store = get_store()
    ws = workspace()
    old = ws["meta"]
    if not kit_is_live(old):
        raise HTTPException(409, "No brand kit is live yet. Upload and activate one first.")
    file_name = body.file_name or old.get("kit_file", "")
    meta, guidelines, rules, facts = build_workspace(body.kit, body.logo_data_url or old.get("logo"), file_name)
    rules, facts = keep_ids(ws["rules"], rules, ws["facts"], facts)
    changes = kit_diff(old, ws["rules"], ws["facts"], ws["guidelines"], meta, rules, facts, guidelines)
    if not body.apply:
        return {"changes": changes, "applied": False}
    if not changes:
        raise HTTPException(400, "Nothing changed compared with the live brand kit.")
    revision = int(old.get("revision") or 1) + 1
    meta |= {"kit": body.kit, "activated_at": old["activated_at"], "revision": revision, "updated_at": now()}
    store.replace_types(KIT_TYPES, _items(guidelines, rules, facts))
    store.put("meta", meta)
    log(None, s_["name"], s_["role"], f"Updated brand kit (revision {revision})",
        "; ".join(f"{c['area']}: {len(c['added'])} added, {len(c['removed'])} removed" for c in changes))
    rechecked = recheck_open_posts(s_)
    return {"changes": changes, "applied": True, "revision": revision, "rechecked": rechecked, "meta": meta}


@app.get("/api/memory")
def get_memory(request: Request):
    """What the app has learned about the live brand from approved posts, reviews and decisions."""
    need(request, CREATOR_ROLES | REVIEW_ROLES, "see the brand memory")
    meta = workspace()["meta"]
    mem = get_store().get("memory", current_kit_id(meta))
    return {"memory": memory.summary(mem, meta.get("keywords") or []), "brand": meta.get("name", ""),
            "kit_unchanged": True, "min_posts_style": memory.MIN_POSTS_STYLE, "min_posts_topic": memory.MIN_POSTS_TOPIC}


class ForgetIn(BaseModel):
    topic: Annotated[str, Field(min_length=1, max_length=60)]


@app.post("/api/memory/forget")
def forget_topic(body: ForgetIn, request: Request):
    s_ = need(request, ADMIN_ROLES, "change the brand memory")
    meta = workspace()["meta"]
    mem = get_store().get("memory", current_kit_id(meta))
    if not mem:
        raise HTTPException(404, "Nothing has been learned for this brand yet.")
    memory.forget(mem, body.topic)
    get_store().put("memory", mem)
    log(None, s_["name"], s_["role"], "Brand memory", f"Forgot the learned topic {body.topic.strip().lower()}")
    return memory.summary(mem, meta.get("keywords") or [])


class KitReset(BaseModel):
    confirm: Short


@app.post("/api/brandkit/reset")
def reset_kit(body: KitReset, request: Request):
    """Back to square one for the live brand: no brand kit and no open posts. The brand's posts, reviews and
    audit trail are kept as read-only history (All history in Analytics and Insights).
    Indian ad regulations stay on. The brand name must be typed to confirm."""
    s_ = need(request, ADMIN_ROLES, "reset the brand kit")
    old = workspace()["meta"]
    name = old.get("name", "")
    if body.confirm.strip().lower() != name.strip().lower():
        raise HTTPException(400, f"Type the brand name exactly (“{name}”) to confirm the reset.")
    _, _, rules, _ = build_workspace({}, None, "")
    for r in rules:
        if r["id"] == "R2":
            r["suggestion"] = ""
    meta = {"id": "workspace", "name": "No brand kit yet", "empty": True, "city": "", "note": "",
            "brand_colours": [], "fonts": [], "required_text": [], "keywords": [], "logo_required": False, "logo": None,
            "confidential_terms": [], "reset_at": now(), "reset_from": name}
    archived = archive_posts(old, s_, "brand kit reset")
    get_store().replace_types(KIT_TYPES + ["meta"], [("rule", r) for r in rules] + [("meta", meta)])
    log(None, s_["name"], s_["role"], "Reset brand kit", f"Removed the {name} brand kit; {archived} post(s) kept in history")
    return {"ok": True}


@app.post("/api/reset")
def reset(request: Request):
    s_ = need(request, ADMIN_ROLES, "reset the demo data")
    get_store().reset()
    log(None, s_["name"], s_["role"], "Reset demo data")
    return {"ok": True}
