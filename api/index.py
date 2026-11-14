"""Live Brand Check API (FastAPI). Deployed as a Vercel Python function; runs locally with uvicorn.

Security model (see SECURITY.md):
- Every /api route except /api/health and /api/login needs a valid signed session cookie.
- Every state-changing request must carry the header X-LBC: 1 (blocks cross-site form posts).
- Identity and role come from the session only; request bodies cannot claim a user or role.
- Findings are computed on the server on every save; the browser cannot submit its own findings.
"""
import base64
import hmac
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
from fastapi.responses import JSONResponse, Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from _lbc import accounts, audit, auth, brands, pdf, brandfit, brandkit, engine, memory, platforms, tone  # noqa: E402
from _lbc.brandapply import build_workspace  # noqa: E402
from _lbc.store import (BRAND_TYPES, current_brand, get_store, request_stats, seed_items, set_brand,  # noqa: E402
                        start_request_cache, storage_mode)  # noqa: E402

app = FastAPI(title="Live Brand Check API", docs_url=None, redoc_url=None, openapi_url=None)

SENIOR_ROLE = "Marketing head"
ADMIN_ROLES = {SENIOR_ROLE}
REVIEW_ROLES = {"Reviewer", SENIOR_ROLE}
CREATOR_ROLES = {"Creator"}
PUBLIC = {"/api/health", "/api/login", "/api/login/account", "/api/setup", "/api/invite/lookup", "/api/invite/accept"}
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
BRAND_COOKIE = "lbc_brand"  # which brand this browser is working in; checked against membership on every request
NO_BRAND = "__none__"  # people not assigned to any brand see an empty workspace

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
    start_request_cache()  # each record is fetched from the database at most once per request
    started = time.perf_counter()
    try:
        if path not in PUBLIC:
            session = auth.read_token(request.cookies.get(auth.COOKIE, ""))
            if session:
                get_store().prefetch(["user", "brand"])  # one database call for who is signed in and their brands
            if session and accounts.mode() == "accounts":
                session = account_session(session)
            if not session:
                return JSONResponse({"detail": "Sign in to continue."}, status_code=401)
            request.state.session = session
            # Multi-brand: work in the brand this browser chose, if this person belongs to it (else their first brand).
            brands.ensure()
            user = get_store().get("user", session["uid"]) if session.get("uid") else None
            request.state.brand = brands.pick(user, request.cookies.get(BRAND_COOKIE))
            set_brand(request.state.brand or NO_BRAND)
            get_store().prefetch(["meta", "guideline", "rule", "fact"])  # the open brand's kit, in one call
        response = await call_next(request)
    except RuntimeError as exc:  # missing server configuration, never a stack trace
        return JSONResponse({"detail": f"Server is not configured: {exc}."}, status_code=500)
    calls, db_ms = request_stats()
    response.headers["Server-Timing"] = f'db;dur={db_ms:.0f};desc="{calls} database calls", total;dur={(time.perf_counter() - started) * 1000:.0f}'
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def me(request: Request):
    return request.state.session


def account_session(session):
    """In accounts mode a session must belong to an active account, with the same session version.
    Name and role always come from the account, so a role change applies at once."""
    uid = session.get("uid")
    user = get_store().get("user", uid) if uid else None
    if not user or not user.get("active", True) or int(user.get("session_ver") or 0) != session.get("ver"):
        return None
    return session | {"name": user["name"], "role": user["role"], "email": user["email"]}


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
    """Append to the hash-linked audit log (see _lbc/audit.py): each entry carries the fingerprint of the one before."""
    s = get_store()
    with _LOG_LOCK:
        event, head = audit.link({"id": new_id(), "draft_id": draft_id, "actor": actor, "role": role,
                                  "action": action, "detail": detail[:600], "at": now()}, s.get("meta", audit.HEAD_ID))
        s.put("event", event)
        s.put("meta", head)
    return event


_LOG_LOCK = __import__("threading").Lock()


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


class AccountLoginIn(BaseModel):
    email: Annotated[str, Field(max_length=254)]
    password: Annotated[str, Field(max_length=128)]


def account_signed_in(request, user, note="Signed in"):
    """Issue the session cookie for an account."""
    accounts.record_success(user)
    get_store().put("user", user)
    log(None, user["name"], user["role"], note)
    response = JSONResponse({"name": user["name"], "role": user["role"]})
    secure = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
    response.set_cookie(auth.COOKIE, auth.make_token(user["role"], user=user), max_age=auth.SESSION_TTL,
                        httponly=True, secure=secure, samesite="lax", path="/")
    return response


def find_user(email):
    return get_store().get("user", accounts.user_id(email))


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    if accounts.mode() == "accounts":
        raise HTTPException(400, "Sign in with your email and password.")
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


@app.post("/api/login/account")
def login_account(body: AccountLoginIn, request: Request):
    """Personal-account sign-in. 3 wrong passwords pause sign-in for 15 minutes; 2 more block the account
    until a marketing head unblocks it. The count is kept on the account, so it holds on every server."""
    if accounts.mode() != "accounts":
        raise HTTPException(400, "Personal accounts are not switched on for this site.")
    ip = client_ip(request)
    if not auth.allow_attempt(ip):
        raise HTTPException(429, "Too many wrong attempts from this device. Wait 10 minutes and try again.")
    accounts.ensure_demo_accounts(get_store(), auth.hash_password)
    brands.ensure()
    brands.give_demo_accounts_all_brands()
    user = find_user(body.email)
    if user and (user.get("blocked") or accounts.is_locked(user)):
        raise HTTPException(423 if user.get("blocked") else 429, accounts.lock_message(user))
    if not user or not user.get("active", True) or not auth.verify_password(body.password, user.get("password_hash", "")):
        auth.record_failure(ip)
        message = "Wrong email or password."
        if user and user.get("active", True):
            message = accounts.record_fail(user)
            get_store().put("user", user)
            if user.get("blocked"):
                log(None, user["name"], user["role"], "Account blocked", f"{accounts.BLOCK_AFTER} wrong passwords")
        time.sleep(0.4)
        status = 423 if user and user.get("blocked") else 429 if user and accounts.is_locked(user) else 401
        raise HTTPException(status, message)
    auth.clear_failures(ip)
    return account_signed_in(request, user)


@app.get("/api/session")
def session(request: Request):
    s = me(request)
    out = {"role": s["role"], "name": s["name"], "expires": s["exp"], "mode": accounts.mode()}
    if s.get("uid"):
        user = get_store().get("user", s["uid"]) or {}
        out |= {"uid": s["uid"], "email": user.get("email")}
    rec = brands.get(getattr(request.state, "brand", None))
    out["brand"] = {"id": rec["id"], "name": brands.label(rec)} if rec else None
    return out


@app.post("/api/session/role")
def switch_role(body: RoleIn, request: Request):
    if accounts.mode() == "accounts" or me(request).get("uid"):
        raise HTTPException(403, "Roles belong to accounts. Ask the marketing head to change your role.")
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
    tone_parts = tone_texts(content, images, post)
    tone_issues, tone_status = tone.check(tone_parts, ws["guidelines"], meta.get("name") or "the brand")
    findings += tone_findings(tone_issues, tone_status)
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
    if tone_status["status"] == "done":
        applied += [("TONE", loc, "Tone matches the brand's tone guideline") for loc, _, _ in tone_parts]
    passed = passed_checks(applied, findings)
    if fit and fit["verdict"] == "weak":  # partly on brand: not counted as passed, and not a blocker either
        passed = [x for x in passed if x["check"] != "BRAND-FIT"]
    summary = {"blocker": counts["blocker"], "warning": counts["warning"], "suggestion": counts["suggestion"],
               "sensitive": any(f.get("sensitive") for f in findings),
               "checks_run": len(applied), "checks_passed": len(passed), "passed": passed,
               "layers": dict(Counter(f["layer"] for f in findings)), "brand_fit": fit, "tone": tone_status}
    return findings, verified, summary


def tone_texts(content, images, post=None):
    """The words a post says, part by part, for the tone check."""
    if post:
        parts = [(loc, platforms.field_label(post["platform"], fid), t)
                 for loc, fid, t in platforms.text_parts(post["platform"], post["format"], post["context"], post["fields"])]
    else:
        parts = [("caption", "Caption", content)]
    return parts + [(f"{i.kind} {n}", f"Text in {i.kind} {n}", i.text) for n, i in enumerate(images, 1)]


def tone_findings(issues, status):
    """Tone issues as findings: fixed rules (see _lbc/tone.py), always suggestions, always citing the tone guideline."""
    return [engine._finding(
        rule_id="TONE", name=i["name"], category="Tone", severity="suggestion",
        start=i["start"], end=i["end"], text=i["quote"], why=i["why"],
        sources=[f"Brand guideline ({i['guideline'].get('section') or 'Tone'}): “{i['guideline']['text'][:180]}”"],
        suggestion=i["suggestion"], location=i["location"], guideline_ids=[i["guideline"]["id"]],
        confidence="Medium") | {"layer": "brand"}
        for i in issues]


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
    accounts.ensure_demo_accounts(get_store(), auth.hash_password)
    brands.ensure()
    brands.give_demo_accounts_all_brands()
    return {"ok": True, "storage": storage_mode(), "today": date.today().isoformat(),
            "login_configured": bool(os.environ.get("LBC_PASSWORD_HASH")) or not auth.password_required(),
            "password_required": auth.password_required() and accounts.mode() == "password", "auth_mode": accounts.mode(),
            "setup_needed": accounts.mode() == "accounts" and not get_store().list("user"),
            "demo_accounts": accounts.demo_credentials(),
            "brand": (get_store().get("meta", "workspace") or {}).get("name", "")}


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
    reopened = reopen_stale_approvals((s_["name"], s_["role"]))
    return fact | {"reopened_posts": reopened}


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


def active_user(uid):
    u = get_store().get("user", uid) if uid else None
    return u if u and u.get("active", True) else None


def assigned_reviewers(d):
    """Active reviewers assigned to the post's creator ([] = nobody assigned, so any reviewer may review)."""
    creator = get_store().get("user", d.get("author_id") or "") if d.get("author_id") else None
    if not creator:
        return []
    return [u for u in (active_user(r) for r in creator.get("reviewer_ids") or [])
            if u and u["role"] == "Reviewer" and in_brand(u)]


def in_brand(user, brand=None):
    """Whether a person works on a brand (the current one by default). Marketing heads work on every brand."""
    ids = brands.member_ids(user)
    return ids is None or (brand or current_brand()) in ids


def can_review(s_, d, assigned=None):
    if not s_ or s_["role"] == SENIOR_ROLE or not s_.get("uid"):
        return True
    assigned = assigned_reviewers(d) if assigned is None else assigned
    return not assigned or s_["uid"] in {u["id"] for u in assigned}


def review_info(s_, d):
    assigned = assigned_reviewers(d)
    return {"assigned_reviewers": [u["name"] for u in assigned], "can_review": can_review(s_, d, assigned)}


def summary(d, s_=None):
    review = d.get("review") or {}
    return {k: d.get(k) for k in ("id", "title", "channel", "status", "author", "version", "updated_at",
                                  "requires_senior", "platform", "format", "context", "campaign_id", "reopened")} | {
        "preview": d["content"][:140] or (d.get("fields") or {}).get("headline", "")[:140] or " ".join(i.get("text", "") for i in d.get("images", []))[:140],
        "review": {k: review.get(k) for k in ("action", "comment", "by", "at", "version")} if review else None,
        "open_blockers": [b["name"] for b in open_blockers(d)], "evidence": len(d.get("evidence") or []),
        "archived": bool(d.get("archived"))} | (review_info(s_, d) if s_ and s_.get("uid") else {})


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


def reopen_stale_approvals(actor=("Live Brand Check", "System")):
    """An approval stands only while the facts it relied on are unchanged and still valid.
    If one changed, was removed or expired, the post goes back to review with the reasons."""
    store, ws = get_store(), workspace()
    today, n = date.today().isoformat(), 0
    for d in store.list("draft"):
        if d.get("status") != "approved" or d.get("archived") or not d.get("evidence"):
            continue
        reasons = audit.stale_reasons(d["evidence"], ws["facts"], today)
        if not reasons:
            continue
        try:
            images = [ImageMeta(**{k: v for k, v in i.items() if k in ImageMeta.model_fields}) for i in d.get("images", [])]
            findings, verified, summ = run_all(d.get("content", ""), d.get("channel", ""), images, stored_post(d))
            d.update(findings=findings, verified=verified, summary=summ,
                     requires_senior=any(f.get("sensitive") for f in findings))
        except Exception:
            pass  # keep the old findings; the reasons still send it back to review
        d.setdefault("past_approvals", []).append(d.get("review") or {})
        d.update(status="in_review", reopened={"at": now(), "reasons": reasons, "version": d.get("approved_version")},
                 updated_at=now())
        d.pop("approved_version", None)
        store.put("draft", d)
        log(d["id"], actor[0], actor[1], "Approval reopened", " ".join(reasons))
        n += 1
    return n


@app.get("/api/drafts")
def list_drafts(request: Request, status: Optional[Annotated[str, Field(max_length=80)]] = None):
    reopen_stale_approvals()
    ds = live_drafts()
    if status:
        wanted = set(status.split(","))
        ds = [d for d in ds if d["status"] in wanted]
    s_ = me(request)
    return [summary(d, s_) for d in sorted(ds, key=lambda d: d["updated_at"], reverse=True)]


@app.get("/api/drafts/{draft_id}")
def get_draft(draft_id: str, request: Request):
    if (get_store().get("draft", draft_id) or {}).get("status") == "approved":
        reopen_stale_approvals()
    d = get_or_404(draft_id)
    events = sorted([e for e in get_store().list("event") if e.get("draft_id") == draft_id], key=lambda e: e["at"])
    s_ = me(request)
    return d | {"events": events, "open_blockers": [b["name"] for b in open_blockers(d)]} | (review_info(s_, d) if s_.get("uid") else {})


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
         "status": "draft", "author": s_["name"], "author_id": s_.get("uid"), "version": 1,
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
             "findings": findings, "verified": verified, "summary": summ, "status": "draft", "author": s_["name"], "author_id": s_.get("uid"),
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
    d["submitted_by_id"] = s_.get("uid")
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
    if s_["name"] in (d.get("author"), d.get("submitted_by")) or (s_.get("uid") and s_["uid"] in (d.get("author_id"), d.get("submitted_by_id"))):
        raise HTTPException(403, "You can't review a post you wrote or submitted.")
    if not can_review(s_, d):
        names = ", ".join(u["name"] for u in assigned_reviewers(d))
        raise HTTPException(403, f"This post is reviewed by {d.get('author', 'the creator')}'s assigned reviewer ({names}) or the marketing head.")
    if body.action == "approve" and d.get("requires_senior") and s_["role"] != SENIOR_ROLE:
        raise HTTPException(403, "This post mentions a sensitive topic, so only the marketing head can approve it.")
    if body.action == "request_changes" and len(body.comment.strip()) < 5:
        raise HTTPException(400, "Tell the creator what to change.")
    d["status"] = "approved" if body.action == "approve" else "changes_requested"
    d["review"] = {"action": body.action, "comment": body.comment.strip(), "by": s_["name"], "role": s_["role"],
                   "at": now(), "version": d["version"]}
    if body.action == "approve":
        d["approved_version"] = d["version"]
        d["evidence"] = audit.evidence(d, workspace()["facts"])
        d.pop("reopened", None)
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


# ---------- trusted history ----------

@app.get("/api/audit/verify")
def verify_audit(request: Request):
    """Recompute every fingerprint in the audit log and report the first broken link, if any."""
    need(request, REVIEW_ROLES | CREATOR_ROLES, "check the audit log")
    store = get_store()
    return audit.verify(store.list("event"), store.get("meta", audit.HEAD_ID))


ACTION_WORD = {"accept": "Accepted the fix", "edit": "Edited the fix", "reject": "Kept the original (override)"}


@app.get("/api/drafts/{draft_id}/record.pdf")
def approval_record(draft_id: Annotated[str, Field(max_length=20)], request: Request):
    """A downloadable PDF of what was approved, by whom, on what evidence, with the post's audit trail
    and the state of the tamper-evident log at the moment of export."""
    s_ = me(request)
    d = get_or_404(draft_id)
    if s_["role"] not in REVIEW_ROLES and not (s_["name"] == d.get("author") or (s_.get("uid") and s_["uid"] == d.get("author_id"))):
        raise HTTPException(403, "Only the post's creator, reviewers or the marketing head can export its approval record.")
    if d.get("status") != "approved":
        raise HTTPException(409, "There is no approval record yet: this post is not approved.")
    store = get_store()
    ver = d.get("approved_version") or d["version"]
    v = next((x for x in d.get("versions", []) if x.get("version") == ver), d.get("versions", [{}])[-1])
    review = d.get("review") or {}
    summ = d.get("summary") or {}
    events = sorted([e for e in store.list("event") if e.get("draft_id") == draft_id], key=lambda e: (e.get("seq") or 0, e["at"]))
    chain = audit.verify(store.list("event"), store.get("meta", audit.HEAD_ID))
    L = [("title", "Approval record"), ("small", f"Live Brand Check. Exported {now()} by {s_['name']} ({s_['role']})."), ("gap", "")]
    L += [("h", "Post"), ("p", f"Title: {d.get('title') or 'Untitled'}"), ("p", f"Where: {d.get('channel') or '-'}"),
          ("p", f"Brand kit: {d.get('kit_name') or workspace()['meta'].get('name') or '-'}"),
          ("p", f"Created by: {d.get('author')}   Approved version: {ver} of {d['version']}"),
          ("b", f"Approved by {review.get('by', '-')} ({review.get('role', '-')}) on {review.get('at', '-')}"),
          ("p", f"Reviewer note: {review.get('comment')}") if review.get("comment") else ("gap", ""), ("gap", "")]
    L += [("h", "What was approved")]
    if v.get("content"):
        L.append(("p", v["content"]))
    for k, val in (v.get("fields") or {}).items():
        if val:
            L.append(("p", f"{platforms.field_label(d.get('platform'), k) if d.get('platform') else k}: {val}"))
    for n, img in enumerate(v.get("images") or d.get("images") or [], 1):
        if (img.get("text") or "").strip():
            L.append(("p", f"Text read from {img.get('kind', 'image')} {n}: {img['text'][:800]}"))
    L += [("gap", ""), ("h", "Evidence the approval relied on")]
    if d.get("evidence"):
        L.append(("small", "If any of these facts changes, is removed or expires, this approval reopens automatically."))
        for ev in d["evidence"]:
            L.append(("p", f"- {ev['label']} (valid until {ev.get('valid_until') or '-'}), fact fingerprint {ev['fingerprint']}"))
    else:
        L.append(("p", "No approved facts (fees, offers, results) were quoted in this post."))
    L += [("gap", ""), ("h", "Checks"),
          ("p", f"{summ.get('checks_passed', 0)} of {summ.get('checks_run', 0)} checks passed. "
                f"{summ.get('blocker', 0)} blocker(s), {summ.get('warning', 0)} warning(s), {summ.get('suggestion', 0)} suggestion(s) on the latest check.")]
    if (summ.get("tone") or {}).get("status"):
        L.append(("small", f"Tone: {summ['tone'].get('message', '')}"))
    if d.get("decisions"):
        L.append(("b", "Decisions on findings"))
        for x in d["decisions"]:
            L.append(("p", f"- {ACTION_WORD.get(x['action'], x['action'])}: {x['name']}" + (f' on "{x["quote"]}"' if x.get("quote") else "")
                      + (f". Reason: {x['reason']}" if x.get("reason") else "") + f" ({x['by']}, {x['at']})"))
    for past in d.get("past_approvals") or []:
        if past.get("by"):
            L.append(("small", f"Earlier approval by {past['by']} on {past.get('at')} was reopened because its evidence changed."))
    L += [("gap", ""), ("h", "Audit trail of this post")]
    for e in events:
        L.append(("p", f"#{e.get('seq', '-')}  {e['at']}  {e['actor']} ({e['role']}): {e['action']}" + (f". {e['detail']}" if e.get("detail") else "")))
        if e.get("hash"):
            L.append(("mono", f"fingerprint {e['hash']}  previous {e['prev']}"))
    L += [("gap", ""), ("h", "Log integrity")]
    if chain["ok"]:
        L.append(("p", f"Verified: all {chain['entries']} linked log entries recompute correctly and link to each other."))
    else:
        b = chain["broken_at"]
        L.append(("b", f"NOT verified: the log is broken at entry #{b.get('seq')}: {b['reason']}"))
    if chain.get("legacy"):
        L.append(("small", f"{chain['legacy']} older entries were written before fingerprints were added and are not covered."))
    L.append(("mono", f"Log head fingerprint at export: {chain.get('head')}"))
    record_id = audit._sha([d["id"], ver, review.get("at"), d.get("evidence"), chain.get("head")])[:24]
    L.append(("mono", f"Record id: {record_id}"))
    body = pdf.render(L, footer=f"Approval record {record_id} - {d.get('title') or 'Untitled'}")
    log(draft_id, s_["name"], s_["role"], "Exported approval record", f"Record {record_id}")
    return Response(body, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="approval-{pdf.safe_filename(d.get("title"))}.pdf"'})


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
    "TONE": ("Brand kit", "Brand guidelines: tone and voice"),
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
    return {"draft": draft, "live_kit": live_kit, "live": kit_is_live(meta),
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
    reopened = reopen_stale_approvals((s_["name"], s_["role"]))
    return {"changes": changes, "applied": True, "revision": revision, "rechecked": rechecked, "reopened": reopened, "meta": meta}


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


# ---------- personal accounts ----------

RoleName = Literal["Creator", "Reviewer", "Marketing head"]
Email = Annotated[str, Field(max_length=254)]
Password = Annotated[str, Field(max_length=128)]
PersonName = Annotated[str, Field(min_length=2, max_length=60)]


def need_accounts():
    if accounts.mode() != "accounts":
        raise HTTPException(400, "Personal accounts are not switched on for this site (set LBC_AUTH_MODE=accounts).")


def check_password(password, email, name):
    problem = accounts.password_problem(password, email, name)
    if problem:
        raise HTTPException(400, problem)


def new_user(name, email, role, password, by):
    return {"id": accounts.user_id(email), "name": name.strip(), "email": accounts.norm_email(email), "role": role,
            "password_hash": auth.hash_password(password), "active": True, "session_ver": 0, "created_at": now(),
            "created_by": by, "failed": 0, "locked_until": None, "last_login": None}


class SetupIn(BaseModel):
    name: PersonName
    email: Email
    password: Password
    setup_code: Annotated[str, Field(max_length=200)] = ""


@app.get("/api/setup")
def setup_status():
    need_accounts()
    return {"needed": not get_store().list("user"), "code_required": bool(os.environ.get("LBC_SETUP_CODE"))}


@app.post("/api/setup")
def setup(body: SetupIn, request: Request):
    """Create the first account, a marketing head. Only possible while no account exists. In production
    it also needs LBC_SETUP_CODE, so a stranger can't claim a freshly deployed site first."""
    need_accounts()
    if get_store().list("user"):
        raise HTTPException(409, "This site is already set up. Sign in instead.")
    code = os.environ.get("LBC_SETUP_CODE", "")
    if auth.is_production() and not code:
        raise HTTPException(503, "Set LBC_SETUP_CODE in the server settings before creating the first account.")
    if code and not hmac.compare_digest(body.setup_code.strip(), code):
        time.sleep(0.4)
        raise HTTPException(401, "Wrong setup code.")
    if not accounts.valid_email(body.email):
        raise HTTPException(400, "Enter a valid email address.")
    check_password(body.password, body.email, body.name)
    user = new_user(body.name, body.email, SENIOR_ROLE, body.password, "first-run setup")
    get_store().put("user", user)
    return account_signed_in(request, user, "Created the first account")


Ids = Annotated[list[Annotated[str, Field(max_length=40)]], Field(max_length=100)]


class InviteIn(BaseModel):
    name: PersonName
    email: Email
    role: RoleName
    assign: Ids = []  # a creator's reviewers, or a reviewer's creators
    brand_ids: Ids = []  # the brands a creator or reviewer works on


COUNTERPART = {"Creator": "Reviewer", "Reviewer": "Creator"}


def active_of(role):
    return [u for u in get_store().list("user") if u.get("active", True) and u["role"] == role]


def check_assign(role, ids, required=True, brand_ids=None):
    """The people a new or existing member is paired with: reviewers for a creator, creators for a reviewer.
    With brand_ids, only people who work on at least one of those brands can be picked (and must be, if any exist)."""
    other = COUNTERPART.get(role)
    if not other:
        if ids:
            raise HTTPException(400, "Only creators and reviewers are paired with each other.")
        return []
    valid = {u["id"]: u for u in active_of(other)
             if brand_ids is None or any(in_brand(u, b) for b in brand_ids)}
    ids = list(dict.fromkeys(ids))
    if any(i not in valid for i in ids):
        raise HTTPException(400, f"Pick active {other.lower()}s only.")
    if required and not ids and valid:
        raise HTTPException(400, f"Choose at least one {other.lower()} for this {role.lower()}." if role == "Reviewer"
                            else "Choose at least one reviewer for this creator.")
    return ids


def pairing(user, users=None):
    """For the Team page: who a creator is reviewed by, or who a reviewer looks after."""
    users = users if users is not None else get_store().list("user")
    if user["role"] == "Creator":
        return {"reviewer_ids": [r for r in user.get("reviewer_ids") or []]}
    if user["role"] == "Reviewer":
        return {"creator_ids": [u["id"] for u in users if u["role"] == "Creator" and user["id"] in (u.get("reviewer_ids") or [])]}
    return {}


def apply_pairing(user, ids):
    """Set a creator's reviewers, or the creators a reviewer looks after (updating each creator)."""
    if user["role"] == "Creator":
        user["reviewer_ids"] = ids
        get_store().put("user", user)
    elif user["role"] == "Reviewer":
        for c in active_of("Creator") + [u for u in get_store().list("user") if u["role"] == "Creator" and not u.get("active", True)]:
            current = list(c.get("reviewer_ids") or [])
            want = c["id"] in ids
            if want and user["id"] not in current:
                c["reviewer_ids"] = current + [user["id"]]
                get_store().put("user", c)
            elif not want and user["id"] in current:
                c["reviewer_ids"] = [r for r in current if r != user["id"]]
                get_store().put("user", c)


def names_of(ids):
    return [u["name"] for u in (get_store().get("user", i) for i in ids) if u]


def invite_view(inv):
    return {k: inv.get(k) for k in ("id", "name", "email", "role", "by", "created_at", "expires_at", "used_at", "revoked")} | \
        {"usable": accounts.invite_usable(inv), "assign": inv.get("assign") or [], "assign_names": names_of(inv.get("assign") or []),
         "brand_names": [brands.label(b) for b in (brands.get(i) for i in inv.get("brand_ids") or []) if b]}


@app.get("/api/team")
def team(request: Request):
    need_accounts()
    need(request, ADMIN_ROLES, "manage the team")
    users = sorted(get_store().list("user"), key=lambda u: (not u.get("active", True), u["role"], u["name"].lower()))
    invites = sorted(get_store().list("invite"), key=lambda i: i["created_at"], reverse=True)
    return {"users": [accounts.public(u) | pairing(u, users) | {"brand_ids": brands.member_ids(u)} for u in users],
            "invites": [invite_view(i) for i in invites if accounts.invite_usable(i)],
            "invite_days": accounts.INVITE_DAYS,
            "brands": [{"id": r["id"], "name": brands.label(r)} for r in brands.records()],
            "current": getattr(request.state, "brand", None)}


@app.post("/api/team/invites")
def create_invite(body: InviteIn, request: Request):
    """Create a one-time invitation link. The link is shown once; only a hash of it is stored."""
    need_accounts()
    s_ = need(request, ADMIN_ROLES, "invite people")
    if not accounts.valid_email(body.email):
        raise HTTPException(400, "Enter a valid email address.")
    if find_user(body.email):
        raise HTTPException(409, "Someone with this email already has an account.")
    for old in get_store().list("invite"):  # one open invitation per email
        if old["email"] == accounts.norm_email(body.email) and accounts.invite_usable(old):
            get_store().put("invite", old | {"revoked": True})
    brand_ids = check_brands(body.role, body.brand_ids)
    assign = check_assign(body.role, body.assign, brand_ids=brand_ids)
    inv, token = accounts.new_invite(body.name, body.email, body.role, s_["name"])
    inv["assign"] = assign
    inv["brand_ids"] = brand_ids
    get_store().put("invite", inv)
    paired = f", paired with {', '.join(names_of(assign))}" if assign else ""
    log(None, s_["name"], s_["role"], "Invited a team member", f"{inv['name']} ({inv['email']}) as {inv['role']}{paired}")
    return {"invite": invite_view(inv), "token": token}


@app.post("/api/team/invites/{invite_id}/revoke")
def revoke_invite(invite_id: Annotated[str, Field(max_length=20)], request: Request):
    need_accounts()
    s_ = need(request, ADMIN_ROLES, "cancel invitations")
    inv = get_store().get("invite", invite_id)
    if not inv:
        raise HTTPException(404, "Invitation not found.")
    get_store().put("invite", inv | {"revoked": True})
    log(None, s_["name"], s_["role"], "Cancelled an invitation", inv["email"])
    return {"ok": True}


class TokenIn(BaseModel):
    token: Annotated[str, Field(max_length=100)]


def usable_invite(token):
    h = accounts.token_hash(token)
    inv = next((i for i in get_store().list("invite") if hmac.compare_digest(i["token_hash"], h)), None)
    if not accounts.invite_usable(inv):
        raise HTTPException(404, "This invitation link is not valid. It may have been used, cancelled or expired; ask for a new one.")
    return inv


@app.post("/api/invite/lookup")
def invite_lookup(body: TokenIn):
    need_accounts()
    inv = usable_invite(body.token)
    brand = (get_store().get("meta", "workspace") or {}).get("name", "")
    return {"name": inv["name"], "email": inv["email"], "role": inv["role"], "by": inv["by"], "expires_at": inv["expires_at"], "brand": brand}


class AcceptIn(TokenIn):
    password: Password


@app.post("/api/invite/accept")
def invite_accept(body: AcceptIn, request: Request):
    need_accounts()
    if not auth.allow_attempt(client_ip(request)):
        raise HTTPException(429, "Too many attempts. Wait 10 minutes and try again.")
    inv = usable_invite(body.token)
    if find_user(inv["email"]):
        raise HTTPException(409, "This email already has an account. Sign in instead.")
    check_password(body.password, inv["email"], inv["name"])
    user = new_user(inv["name"], inv["email"], inv["role"], body.password, inv["by"])
    if inv.get("brand_ids") is not None and user["role"] != SENIOR_ROLE:
        user["brand_ids"] = [b for b in inv["brand_ids"] if brands.get(b)]
    get_store().put("user", user)
    other = COUNTERPART.get(user["role"])
    still_valid = [i for i in inv.get("assign") or [] if (u := active_user(i)) and u["role"] == other]
    apply_pairing(user, still_valid)
    get_store().put("invite", inv | {"used_at": now()})
    return account_signed_in(request, user, "Joined from an invitation")


class MemberIn(BaseModel):
    role: Optional[RoleName] = None
    active: Optional[bool] = None


def active_heads(exclude=None):
    return [u for u in get_store().list("user") if u.get("active", True) and u["role"] == SENIOR_ROLE and u["id"] != exclude]


@app.patch("/api/team/{uid}")
def update_member(uid: Annotated[str, Field(max_length=40)], body: MemberIn, request: Request):
    """Change someone's role, or deactivate / reactivate them. Their current sessions end straight away."""
    need_accounts()
    s_ = need(request, ADMIN_ROLES, "manage the team")
    user = get_store().get("user", uid)
    if not user:
        raise HTTPException(404, "Account not found.")
    if uid == s_.get("uid"):
        raise HTTPException(400, "You can't change your own role or deactivate yourself. Ask another marketing head.")
    if user.get("demo") and (body.role or body.active is not None):
        raise HTTPException(400, "Demo accounts can't be changed, so every visitor can sign in with the details on the sign-in page.")
    leaving_head = user["role"] == SENIOR_ROLE and ((body.role and body.role != SENIOR_ROLE) or body.active is False)
    if leaving_head and not active_heads(exclude=uid):
        raise HTTPException(400, "Keep at least one active marketing head.")
    changes = []
    if body.role and body.role != user["role"]:
        changes.append(f"role {user['role']} \u2192 {body.role}")
        if user["role"] in COUNTERPART:  # the old pairing no longer fits the new role
            apply_pairing(user, [])
            user = get_store().get("user", uid)
            user.pop("reviewer_ids", None)
        user["role"] = body.role
    if body.active is not None and body.active != user.get("active", True):
        user["active"] = body.active
        changes.append("reactivated" if body.active else "deactivated")
    if changes:
        user["session_ver"] = int(user.get("session_ver") or 0) + 1  # sign them out everywhere
        get_store().put("user", user)
        log(None, s_["name"], s_["role"], "Changed a team member", f"{user['name']}: " + ", ".join(changes))
    return accounts.public(user)


class AssignIn(BaseModel):
    ids: Ids


@app.put("/api/team/{uid}/assignments")
def set_assignments(uid: Annotated[str, Field(max_length=40)], body: AssignIn, request: Request):
    """A creator's reviewers, or the creators a reviewer looks after."""
    need_accounts()
    s_ = need(request, ADMIN_ROLES, "pair creators and reviewers")
    user = get_store().get("user", uid)
    if not user or user["role"] not in COUNTERPART:
        raise HTTPException(400, "Only creators and reviewers are paired with each other.")
    ids = check_assign(user["role"], body.ids, required=False)
    apply_pairing(user, ids)
    who = ", ".join(names_of(ids)) or "nobody"
    log(None, s_["name"], s_["role"], "Changed pairing", f"{user['name']} ({user['role']}): {who}")
    fresh = get_store().get("user", uid)
    return accounts.public(fresh) | pairing(fresh)


class BrandsIn(BaseModel):
    ids: Ids


@app.put("/api/team/{uid}/brands")
def set_member_brands(uid: Annotated[str, Field(max_length=40)], body: BrandsIn, request: Request):
    """The brands a creator or reviewer works on. Marketing heads always see every brand."""
    need_accounts()
    s_ = need(request, ADMIN_ROLES, "assign brands")
    user = get_store().get("user", uid)
    if not user:
        raise HTTPException(404, "No such team member.")
    if user["role"] == SENIOR_ROLE:
        raise HTTPException(400, "Marketing heads work on every brand.")
    user["brand_ids"] = check_brands(user["role"], body.ids, default=False)
    get_store().put("user", user)
    log(None, s_["name"], s_["role"], "Changed brands", f"{user['name']}: " + ", ".join(brands.label(brands.get(b)) for b in user["brand_ids"]))
    return accounts.public(user) | pairing(user) | {"brand_ids": user["brand_ids"]}


@app.post("/api/team/{uid}/unblock")
def unblock_member(uid: Annotated[str, Field(max_length=40)], request: Request):
    """Let someone sign in again after too many wrong passwords."""
    need_accounts()
    s_ = need(request, ADMIN_ROLES, "unblock accounts")
    user = get_store().get("user", uid)
    if not user:
        raise HTTPException(404, "Account not found.")
    get_store().put("user", accounts.unblock(user))
    log(None, s_["name"], s_["role"], "Unblocked an account", user["name"])
    return accounts.public(user)


@app.post("/api/team/{uid}/remove")
def remove_member(uid: Annotated[str, Field(max_length=40)], request: Request):
    """Delete someone's account for good. Only deactivated people can be removed (deactivate first, so nobody is
    removed by one click). Their posts, reviews and audit entries stay under their name; their email can be invited again."""
    need_accounts()
    s_ = need(request, ADMIN_ROLES, "remove people")
    store = get_store()
    user = store.get("user", uid)
    if not user:
        raise HTTPException(404, "Account not found.")
    if uid == s_.get("uid"):
        raise HTTPException(400, "You can't remove yourself.")
    if user.get("demo"):
        raise HTTPException(403, "Demo accounts are kept for the judges and can't be removed.")
    if user.get("active", True):
        raise HTTPException(409, "Deactivate this person first, then remove them.")
    store.replace_types(["user"], [("user", u) for u in store.list("user") if u["id"] != uid])
    for c in store.list("user"):  # nobody stays paired with a removed reviewer
        if uid in (c.get("reviewer_ids") or []):
            store.put("user", c | {"reviewer_ids": [r for r in c["reviewer_ids"] if r != uid]})
    log(None, s_["name"], s_["role"], "Removed team member", f"{user['name']} ({user['email']}, {user['role']})")
    return {"ok": True, "removed": user["name"]}


def my_account(request):
    s_ = me(request)
    user = get_store().get("user", s_.get("uid") or "")
    if not user:
        raise HTTPException(400, "This is a demo session. Personal account settings need a personal account.")
    return s_, user


def reissue(request, user, payload):
    """After a security change the session version goes up: other devices are signed out, this one stays in."""
    response = JSONResponse(payload)
    secure = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
    response.set_cookie(auth.COOKIE, auth.make_token(user["role"], user=user), max_age=auth.SESSION_TTL,
                        httponly=True, secure=secure, samesite="lax", path="/")
    return response


class PasswordChangeIn(BaseModel):
    current: Password
    new: Password


@app.post("/api/account/password")
def change_password(body: PasswordChangeIn, request: Request):
    s_, user = my_account(request)
    if user.get("demo"):
        raise HTTPException(403, "The demo account's password can't be changed, so every visitor can still sign in.")
    if not auth.verify_password(body.current, user.get("password_hash", "")):
        time.sleep(0.4)
        raise HTTPException(401, "Your current password is wrong.")
    check_password(body.new, user["email"], user["name"])
    user["password_hash"] = auth.hash_password(body.new)
    user["session_ver"] = int(user.get("session_ver") or 0) + 1
    get_store().put("user", user)
    log(None, user["name"], user["role"], "Changed password", "Other devices were signed out")
    return reissue(request, user, {"ok": True})


@app.post("/api/account/logout-all")
def logout_everywhere(request: Request):
    s_, user = my_account(request)
    user["session_ver"] = int(user.get("session_ver") or 0) + 1
    get_store().put("user", user)
    log(None, user["name"], user["role"], "Signed out other devices")
    return reissue(request, user, {"ok": True})


@app.post("/api/reset")
def reset(request: Request):
    """Start the demo over: restores the sample brand only. Other brands and everyone's accounts are kept."""
    s_ = need(request, ADMIN_ROLES, "reset the demo data")
    target = brands.sample_brand()
    if target:
        set_brand(target)
        get_store().replace_types(list(BRAND_TYPES), seed_items())  # this brand's data only
    else:  # the sample brand was removed: add it back as a new brand
        from _lbc import seed as seed_data
        target = brands.create(seed_data.WORKSPACE["name"], s_["name"], seed_items(), sample=True)["id"]
        set_brand(target)
    brands.ensure()
    brands.give_demo_accounts_all_brands()
    brands.add_to_demo_accounts(target)
    log(None, s_["name"], s_["role"], "Reset demo data")
    response = JSONResponse({"ok": True, "brand": target})
    response.set_cookie(BRAND_COOKIE, target, max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax", path="/")
    return response


# ---------- brands ----------

class BrandPick(BaseModel):
    id: Annotated[str, Field(max_length=40)]


class BrandNew(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=80)]


def me_user(request):
    s_ = me(request)
    return get_store().get("user", s_["uid"]) if s_.get("uid") else None


@app.get("/api/brands")
def list_brands(request: Request):
    """The brands this person can work on, and which one is open."""
    user = me_user(request)
    cur = getattr(request.state, "brand", None)
    return {"brands": [brands.summary(r, cur) for r in brands.allowed(user)], "current": cur,
            "can_add": me(request)["role"] in ADMIN_ROLES}


@app.post("/api/brand")
def switch_brand(body: BrandPick, request: Request):
    user = me_user(request)
    if body.id not in {r["id"] for r in brands.allowed(user)}:
        raise HTTPException(403, "You don't work on that brand.")
    response = JSONResponse({"ok": True, "current": body.id})
    response.set_cookie(BRAND_COOKIE, body.id, max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax", path="/")
    return response


@app.post("/api/brands")
def add_brand(body: BrandNew, request: Request):
    """A new brand starts with the Indian ad regulations only; the marketing head then uploads its brand kit."""
    s_ = need(request, ADMIN_ROLES, "add brands")
    name = body.name.strip()
    if any(brands.label(r).lower() == name.lower() for r in brands.records()):
        raise HTTPException(409, f"There is already a brand called {name}.")
    rec = brands.create(name, s_["name"])
    response = JSONResponse({"ok": True, "brand": brands.summary(rec, rec["id"])})
    response.set_cookie(BRAND_COOKIE, rec["id"], max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax", path="/")
    return response


class BrandRemove(BaseModel):
    confirm: Annotated[str, Field(max_length=120)]


@app.post("/api/brands/{brand_id}/remove")
def remove_brand(brand_id: Annotated[str, Field(max_length=40)], body: BrandRemove, request: Request):
    """Delete a brand and everything in it, for good. The brand name must be typed to confirm.
    People keep their accounts; anyone who only worked on this brand is left without a brand until reassigned."""
    s_ = need(request, ADMIN_ROLES, "remove brands")
    rec = brands.get(brand_id)
    if not rec:
        raise HTTPException(404, "No such brand.")
    name = brands.label(rec)
    if body.confirm.strip().lower() != name.strip().lower():
        raise HTTPException(400, f"Type the brand name exactly (“{name}”) to confirm.")
    try:
        brands.remove(brand_id)
    except ValueError:
        raise HTTPException(409, "This is the only brand. Add another brand before removing this one.")
    nxt = brands.records()[0]["id"]
    set_brand(nxt)
    log(None, s_["name"], s_["role"], "Removed brand", f"{name} and all its brand kit, posts, reviews and history were deleted")
    response = JSONResponse({"ok": True, "removed": name, "current": nxt})
    response.set_cookie(BRAND_COOKIE, nxt, max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax", path="/")
    return response


def check_brands(role, ids, default=True):
    """The brands a new or existing creator or reviewer works on (at least one; an invitation without a choice uses
    the brand the marketing head is working in). Marketing heads see every brand."""
    if role == SENIOR_ROLE:
        return None
    known = {r["id"] for r in brands.records()}
    ids = list(dict.fromkeys(i for i in ids if i in known)) or ([current_brand()] if current_brand() in known and default else [])
    if not ids:
        raise HTTPException(400, "Choose at least one brand for this person.")
    return ids


@app.get("/api/my-team")
def my_team(request: Request):
    """Read-only: who a creator or reviewer works with on the open brand."""
    need_accounts()
    s_ = me(request)
    users = [u for u in get_store().list("user") if u.get("active", True)]
    mine = get_store().get("user", s_.get("uid") or "") or {}
    heads = [u for u in users if u["role"] == SENIOR_ROLE]
    here = [u for u in users if u["role"] != SENIOR_ROLE and in_brand(u)]
    if s_["role"] == "Reviewer":
        title = "Creators you review"
        people = [u for u in here if u["role"] == "Creator" and mine.get("id") in (u.get("reviewer_ids") or [])]
        note = "" if people else "Nobody is paired with you on this brand yet, so you can review any of its creators."
        people = people or [u for u in here if u["role"] == "Creator"]
    elif s_["role"] == "Creator":
        title = "Your reviewers"
        people = [u for u in here if u["role"] == "Reviewer" and u["id"] in (mine.get("reviewer_ids") or [])]
        note = "" if people else "No reviewer is paired with you on this brand yet, so any of its reviewers can review your posts."
        people = people or [u for u in here if u["role"] == "Reviewer"]
    else:
        title, people, note = "Creators and reviewers", here, ""
    view = lambda u: {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]}  # noqa: E731
    rec = brands.get(getattr(request.state, "brand", None))
    return {"brand": brands.label(rec) if rec else None, "heads": [view(u) for u in heads],
            "title": title, "people": [view(u) for u in people], "note": note}
