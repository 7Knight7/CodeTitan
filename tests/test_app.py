import os
import sys
from datetime import date

os.environ["LBC_DATA_PATH"] = "/tmp/lbc-test.json"
os.environ["LBC_SESSION_SECRET"] = "test-secret-not-for-production"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from _lbc import auth, engine, seed  # noqa: E402
TEST_PW = "test-only-password"  # not the real one; the real password lives only as a hash in Vercel
os.environ["LBC_PASSWORD_HASH"] = auth.hash_password(TEST_PW)
os.environ["LBC_REQUIRE_PASSWORD"] = "1"  # the password tests run with sign-in protection on

from fastapi.testclient import TestClient  # noqa: E402
from _lbc.store import get_store  # noqa: E402
import index  # noqa: E402

TODAY = date(2026, 11, 9)
WS = {"rules": [r | {"enabled": True} for r in seed.RULES], "facts": seed.FACTS}
H = {"X-LBC": "1"}


def client(role="Creator"):
    c = TestClient(index.app, headers=H)
    r = c.post("/api/login", json={"password": TEST_PW, "role": role})
    assert r.status_code == 200, r.text
    return c


def as_role(c, role):
    assert c.post("/api/session/role", json={"role": role}).status_code == 200
    return c


def ids(findings):
    return {f["rule_id"] for f in findings}


# ---------- engine ----------

def test_walkthrough_caption_finds_all_issues():
    findings, _ = engine.run_checks(seed.SAMPLE_DRAFT["content"], "Instagram post", WS, today=TODAY)
    assert {"R1", "R2", "R3", "R4", "R5", "FACT-EXPIRED", "FACT-RESULT-COHORT"} <= ids(findings)
    cohort = next(f for f in findings if f["rule_id"] == "FACT-RESULT-COHORT")
    assert "32" in cohort["suggestion"] and "18" in cohort["suggestion"]
    assert next(f for f in findings if f["rule_id"] == "FACT-EXPIRED")["suggestion"] == "Rs 48,000"
    for f in findings:
        assert f["why"] and f["sources"]
        if f["quote"]:
            assert seed.SAMPLE_DRAFT["content"][f["start"]:f["end"]] == f["quote"]


def test_clean_caption_has_no_blockers_and_verifies_facts():
    text = ("32 students from our paid full course and 18 from our free interview-guidance programme qualified "
            "in UPSC CSE 2025. Foundation course fee for the 2026-27 batch: Rs 48,000. Early-bird 10% off until 30 November.")
    findings, verified = engine.run_checks(text, "Instagram post", WS, today=TODAY)
    assert not [f for f in findings if f["severity"] == "blocker"]
    assert {v["fact_id"] for v in verified} >= {"F1", "F4"}


def test_unknown_fee_result_expired_offer_disclosure_sensitive_banner():
    f, _ = engine.run_checks("Fees only Rs 39,999. 75 students selected!", "Instagram post", WS, today=TODAY)
    assert {"FACT-UNKNOWN-FEE", "FACT-RESULT-UNKNOWN"} <= ids(f)
    f, _ = engine.run_checks("Get 10% off today", "Instagram post", WS, today=date(2026, 12, 15))
    assert "FACT-OFFER" in ids(f)
    assert "R8" in ids(engine.run_checks("Loved it", "Influencer post", WS, today=TODAY)[0])
    assert "R8" not in ids(engine.run_checks("Loved it #ad", "Influencer post", WS, today=TODAY)[0])
    assert any(x["sensitive"] for x in engine.run_checks("Happy Diwali", "Instagram post", WS, today=TODAY)[0])
    f, _ = engine.run_checks("Soon", "Instagram post", WS, banner_text="Fees Rs 45,000", today=TODAY)
    assert any(x["location"] == "banner" and x["rule_id"] == "FACT-EXPIRED" for x in f)


# ---------- security ----------

def test_password_hashing():
    h = auth.hash_password(TEST_PW)
    assert TEST_PW not in h and auth.verify_password(TEST_PW, h) and not auth.verify_password(TEST_PW.upper(), h)
    assert auth.hash_password(TEST_PW) != h  # salted


def test_api_requires_session():
    c = TestClient(index.app, headers=H)
    assert c.get("/api/health").status_code == 200
    for path in ("/api/workspace", "/api/drafts", "/api/insights", "/api/session"):
        assert c.get(path).status_code == 401
    assert c.post("/api/check", json={"content": "x"}).status_code == 401


def test_forged_or_tampered_cookie_rejected():
    c = TestClient(index.app, headers=H)
    token = auth.make_token("Creator")
    payload, sig = token.split(".")
    forged = auth._b64(b'{"role": "Marketing head", "name": "x", "iat": 0, "exp": 9999999999}')
    c.cookies.set(auth.COOKIE, f"{forged}.{sig}")
    assert c.get("/api/session").status_code == 401
    c.cookies.set(auth.COOKIE, auth.make_token("Creator", now=1))  # expired long ago
    assert c.get("/api/session").status_code == 401


def test_wrong_password_and_rate_limit():
    auth.clear_all_attempts()
    c = TestClient(index.app, headers=H)
    for _ in range(auth.MAX_ATTEMPTS):
        assert c.post("/api/login", json={"password": "nope"}).status_code == 401
    assert c.post("/api/login", json={"password": TEST_PW}).status_code == 429
    auth.clear_all_attempts()


def test_csrf_header_required():
    c = client()
    r = c.post("/api/check", json={"content": "x"}, headers={"X-LBC": ""})
    assert r.status_code == 403


def test_roles_enforced_on_server():
    get_store().reset()
    c = client("Creator")
    assert c.put("/api/facts/F1", json={"amount": 1}).status_code == 403
    assert c.post("/api/reset").status_code == 403
    as_role(c, "Reviewer")
    assert c.post("/api/drafts", json={"content": "hello"}).status_code == 403
    as_role(c, "Marketing head")
    assert c.put("/api/facts/F1", json={"amount": 49000}).json()["amount"] == 49000


def test_input_limits():
    c = client()
    assert c.post("/api/check", json={"content": "x" * 5001}).status_code == 422
    assert c.post("/api/drafts", json={"content": "ok", "title": "t" * 151}).status_code == 422


# ---------- workflow ----------

def test_end_to_end_workflow_server_computes_findings():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"title": "t", "content": seed.SAMPLE_DRAFT["content"]}).json()
    assert d["author"] == "Priya (social media)" and d["summary"]["blocker"] >= 3
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 400
    blocker = next(f for f in d["findings"] if f["severity"] == "blocker")
    assert c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": blocker["id"], "action": "reject"}).status_code == 400
    assert c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": "fake", "action": "accept"}).status_code == 404
    fixed = ("Northstar Civils Academy for UPSC. 32 students from our paid full course and 18 from our free "
             "interview-guidance programme qualified this year. Structured mentoring and weekly mock tests. "
             "Foundation course fee for the 2026-27 batch: Rs 48,000.")
    d2 = c.put(f"/api/drafts/{d['id']}", json={"title": "t", "content": fixed}).json()
    assert d2["summary"]["blocker"] == 0 and d2["version"] == 2
    assert c.post(f"/api/drafts/{d['id']}/submit").json()["status"] == "in_review"
    assert c.put(f"/api/drafts/{d['id']}", json={"content": "sneaky edit"}).status_code == 409
    as_role(c, "Reviewer")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "request_changes", "comment": ""}).status_code == 400
    ok = c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).json()
    assert ok["status"] == "approved" and ok["approved_version"] == 2 and ok["review"]["by"] == "Arjun (brand reviewer)"
    actions = [e["action"] for e in c.get(f"/api/drafts/{d['id']}").json()["events"]]
    assert actions[0] == "Created draft" and "Approved" in actions


def test_no_self_approval_and_sensitive_needs_marketing_head():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"content": "Happy Diwali from Northstar Civils Academy"}).json()
    c.post(f"/api/drafts/{d['id']}/submit")
    as_role(c, "Reviewer")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).status_code == 403
    as_role(c, "Marketing head")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).status_code == 200


def test_override_feeds_insights():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"content": "50 of our students cracked it"}).json()
    slang = next(f for f in d["findings"] if f["rule_id"] == "R5")
    c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": slang["id"], "action": "reject", "reason": "Our audience uses this word"})
    assert c.get("/api/insights").status_code == 403  # creators don't see insights
    as_role(c, "Reviewer")
    row = next(r for r in c.get("/api/insights").json()["rules"] if r["rule_id"] == "R5")
    assert row["overridden"] >= 1 and row["needs_review"]


def test_image_findings():
    c = client()
    chk = c.post("/api/check", json={"content": "", "images": [{
        "file_name": "b.png", "text": "100% selection guaranteed. Fees Rs 45,000", "alt_text": "", "contrast_min": 1.6, "contrast_text": "FEES",
        "brand_share": 0.1, "palette": [{"hex": "#00FF00", "share": 0.4}, {"hex": "#1F3A68", "share": 0.3}, {"hex": "javascript:", "share": 0.9}]}]}).json()
    got = ids(chk["findings"])
    assert {"IMG-CONTRAST", "IMG-ALT", "IMG-COLOUR", "IMG-BRAND-COLOUR", "R1", "FACT-EXPIRED"} <= got
    assert all(f["location"] == "image 1" for f in chk["findings"] if f["rule_id"] != "BRAND-FIT")
    assert chk["findings"][0]["rule_id"] == "BRAND-FIT"  # no name, no brand colours: not a post for this brand
    assert c.post("/api/check", json={"content": "", "images": []}).status_code == 400


def test_brand_not_visible_is_blocker_and_preview_saved():
    get_store().reset()
    c = client()
    img = {"file_name": "a.jpg", "text": "Admissions open", "alt_text": "Poster", "preview": "data:image/jpeg;base64,/9j/AAAA"}
    d = c.post("/api/drafts", json={"title": "p", "images": [img]}).json()
    brand = next(f for f in d["findings"] if f["rule_id"] == "IMG-BRAND")
    assert brand["severity"] == "blocker"
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 400
    assert c.get(f"/api/drafts/{d['id']}").json()["images"][0]["preview"] == img["preview"]
    bad = img | {"preview": "data:text/html;base64,PHNjcmlwdD4="}
    assert c.post("/api/drafts", json={"title": "p", "images": [bad]}).status_code == 422
    assert d["summary"]["checks_run"] > d["summary"]["checks_passed"] > 0
    assert d["versions"][0]["images"][0]["preview"] == img["preview"]  # each version keeps its images
    listed = next(x for x in c.get("/api/drafts").json() if x["id"] == d["id"])
    assert listed["open_blockers"] == ["Brand not visible"]
    # Acknowledging the blocker ("I will fix the image") lets it be sent.
    c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": brand["id"], "action": "accept"})
    assert c.get(f"/api/drafts/{d['id']}").json()["open_blockers"] == []
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200


def test_change_request_visible_to_creator_and_analytics():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"title": "Fee post", "content": "Foundation course fee for the 2026-27 batch: Rs 48,000."}).json()
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200
    as_role(c, "Reviewer")
    c.post(f"/api/drafts/{d['id']}/review", json={"action": "request_changes", "comment": "Add the logo please"})
    as_role(c, "Creator")
    back = c.get("/api/drafts?status=changes_requested").json()
    mine = next(x for x in back if x["id"] == d["id"])
    assert mine["review"]["comment"] == "Add the logo please" and mine["review"]["by"] == "Arjun (brand reviewer)"
    assert c.get("/api/analytics").status_code == 403  # creators don't see analytics
    # Resubmitting with a changed caption saves a new version and clears the change request.
    d2 = c.put(f"/api/drafts/{d['id']}", json={"title": "Fee post", "content": "Foundation course fee for the 2026-27 batch: Rs 48,000. Enrol now."}).json()
    assert d2["version"] == 2
    assert c.post(f"/api/drafts/{d['id']}/submit").json()["status"] == "in_review"
    assert all(x["id"] != d["id"] for x in c.get("/api/drafts?status=changes_requested").json())
    as_role(c, "Reviewer")
    a = c.get("/api/analytics").json()
    t = a["totals"]
    assert t["checks_run"] >= t["checks_passed"] > 0 and t["verified"] >= 1
    assert sum(p["blocker"] for p in a["posts"]) == t["blocker"]
    assert any(p["id"] == d["id"] for p in a["posts"])


def test_brand_kit_pdf_parse_and_activate():
    import base64
    get_store().reset()
    pdf = open(os.path.join(os.path.dirname(__file__), "fixtures", "sunrise_brand_book.pdf"), "rb").read()
    c = client("Creator")
    body = {"file_name": "sunrise.pdf", "data_b64": base64.b64encode(pdf).decode()}
    assert c.post("/api/brandkit/parse", json=body).status_code == 403
    as_role(c, "Marketing head")
    assert c.post("/api/brandkit/parse", json={"file_name": "x.pdf", "data_b64": base64.b64encode(b"not a pdf").decode()}).status_code == 400
    draft = c.post("/api/brandkit/parse", json=body).json()
    kit = draft["kit"]
    assert kit["brand_name"]["text"] == "Sunrise Tutorials"
    assert {x["hex"] for x in kit["colours"]} == {"#F26B21", "#0E5E6F", "#FFFFFF"}
    assert any(f.get("amount") == 120000 for f in kit["facts"])
    assert c.post("/api/brandkit/activate", json={"kit": kit}).status_code == 409  # demo posts exist: must confirm
    r = c.post("/api/brandkit/activate", json={"kit": kit, "confirm_reset": True}).json()
    assert r["meta"]["name"] == "Sunrise Tutorials" and r["meta"]["logo_required"]
    as_role(c, "Creator")
    chk = c.post("/api/check", json={"images": [{"file_name": "p.png", "text": "Guaranteed rank at Sunrise Academy. Fee Rs 1,20,000", "alt_text": "poster"}]}).json()
    names = {f["name"] for f in chk["findings"]}
    assert "Required text missing" in names and any("Sunrise Academy" in n for n in names)
    assert any(v["fact_id"] for v in chk["verified"])


def test_brand_kit_lifecycle_activate_update_reset():
    import base64
    get_store().reset()
    c = client("Reviewer")
    assert any(r["rule_id"] == "R5" for r in c.get("/api/insights").json()["rules"])  # demo coaching rule
    as_role(c, "Marketing head")
    pdf = open(os.path.join(os.path.dirname(__file__), "fixtures", "sunrise_brand_book.pdf"), "rb").read()
    kit = c.post("/api/brandkit/parse", json={"file_name": "sunrise.pdf", "data_b64": base64.b64encode(pdf).decode()}).json()["kit"]
    c.post("/api/brandkit/activate", json={"kit": kit, "confirm_reset": True})
    ws = c.get("/api/workspace").json()
    assert ws["live"] and ws["post_count"] == 0 and ws["archived_count"] >= 5  # new brand starts from zero; demo posts kept as history
    assert c.post("/api/brandkit/activate", json={"kit": kit, "confirm_reset": True}).status_code == 409  # must reset first

    as_role(c, "Creator")
    d = c.post("/api/drafts", json={"title": "Kit post", "content": "100% selection guaranteed. Classes on Diwali"}).json()
    as_role(c, "Reviewer")
    ins = c.get("/api/insights").json()
    assert ins["drafts"] == 1 and all(r["rule_id"] != "R5" for r in ins["rules"])
    r1 = next(r for r in ins["rules"] if r["rule_id"] == "R1")
    assert r1["group"] == "Regulation" and "CCPA" in r1["source"]

    # A kit activated before the confirmed kit was stored is rebuilt from what is live: unedited, nothing changes.
    as_role(c, "Marketing head")
    meta = get_store().get("meta", "workspace")
    stored = meta.pop("kit")
    get_store().put("meta", meta)
    rebuilt = c.get("/api/brandkit").json()["live_kit"]
    assert c.post("/api/brandkit/update", json={"kit": rebuilt}).json()["changes"] == []
    get_store().put("meta", meta | {"kit": stored})

    # Update: add a banned phrase, change a colour. Posts stay, unchanged rules keep their ids, open posts re-checked.
    as_role(c, "Marketing head")
    old_rules = {r["name"]: r["id"] for r in c.get("/api/workspace").json()["rules"]}
    live = c.get("/api/brandkit").json()["live_kit"]
    new_kit = live | {"banned_phrases": live.get("banned_phrases", []) + [{"text": "Classes"}],
                      "colours": live["colours"][:-1] + [{"name": "Gold", "hex": "#F4C430"}]}
    preview = c.post("/api/brandkit/update", json={"kit": new_kit}).json()
    areas = {x["area"]: x for x in preview["changes"]}
    assert preview["applied"] is False and "Colours" in areas and any("Classes" in a for a in areas["Banned words and wrong names"]["added"])
    done = c.post("/api/brandkit/update", json={"kit": new_kit, "apply": True}).json()
    assert done["applied"] and done["revision"] == 2 and done["rechecked"] == 1
    rules_after = {r["name"]: r["id"] for r in c.get("/api/workspace").json()["rules"]}
    assert all(rules_after[n] == i for n, i in old_rules.items() if n in rules_after)
    rechecked = c.get(f"/api/drafts/{d['id']}").json()
    assert any("Classes" in f["name"] for f in rechecked["findings"])
    assert c.get("/api/workspace").json()["post_count"] == 1
    assert c.post("/api/brandkit/update", json={"kit": new_kit, "apply": True}).status_code == 400  # nothing changed

    # Reset: wrong confirmation refused; right one wipes everything; no posts until a new kit is live.
    as_role(c, "Creator")
    assert c.post("/api/brandkit/reset", json={"confirm": "Sunrise Tutorials"}).status_code == 403
    as_role(c, "Marketing head")
    assert c.post("/api/brandkit/reset", json={"confirm": "wrong"}).status_code == 400
    assert c.post("/api/brandkit/reset", json={"confirm": "sunrise tutorials"}).status_code == 200
    ws = c.get("/api/workspace").json()
    assert ws["empty"] and not ws["live"] and ws["post_count"] == 0 and not ws["facts"]
    assert {r["id"] for r in ws["rules"]} >= {"R1", "R2", "R6"}  # regulations stay on
    as_role(c, "Creator")
    assert c.post("/api/drafts", json={"content": "hello"}).status_code == 409
    as_role(c, "Reviewer")
    assert c.get("/api/insights").json()["drafts"] == 0
    # ...but nothing is deleted: the old brand's posts stay in All history, read-only and out of Write and Review
    hist = c.get("/api/analytics?scope=all").json()
    sun = next(b for b in hist["kit"]["brands"] if b["name"] == "Sunrise Tutorials")
    assert sun["posts"] == 1 and any(p["id"] == d["id"] for p in hist["posts"])
    assert c.get(f"/api/insights?scope=all&brand={sun['id'].replace('+', '%2B')}").json()["drafts"] == 1
    assert all(x["id"] != d["id"] for x in c.get("/api/drafts").json())
    assert c.get(f"/api/drafts/{d['id']}").json()["archived"] is True  # history page still opens
    as_role(c, "Creator")
    assert c.put(f"/api/drafts/{d['id']}", json={"title": "x", "content": "y"}).status_code == 409
    assert any(e["action"] == "Archived posts" for e in get_store().list("event"))


# ---------- Platform Intelligence Engine: the specification's test scenarios ----------

IMG = {"kind": "image", "file_name": "p.jpg", "text": "Northstar Civils Academy admissions", "alt_text": "Poster", "width": 1080, "height": 1080}


def post(c, platform, fmt, context="organic", content="", fields=None, images=None, title="t"):
    return c.post("/api/drafts", json={"title": title, "platform": platform, "format": fmt, "context": context,
                                       "content": content, "fields": fields or {}, "images": images or []})


def schema_ids(c, platform, fmt, context="organic"):
    return [f["id"] for f in c.get(f"/api/input-schema?platform={platform}&format={fmt}&context={context}").json()["fields"]]


def test_platform_config_and_schemas():
    get_store().reset()
    c = client("Creator")
    cfg = c.get("/api/platforms").json()
    assert [p["id"] for p in cfg["platforms"]] == ["instagram", "linkedin", "facebook", "whatsapp", "website"]
    assert [f["label"] for f in c.get("/api/platforms/instagram/formats").json()] == ["Feed post", "Carousel", "Reel", "Story"]
    assert len(cfg["contexts"]) == 5 and len(cfg["layers"]) == 5
    assert schema_ids(c, "linkedin", "text") == ["main_text", "url", "hashtags"]  # text-first, no media box
    assert schema_ids(c, "instagram", "feed")[0] == "media"  # visual-first
    assert "sponsor" not in schema_ids(c, "linkedin", "text") and "sponsor" in schema_ids(c, "linkedin", "text", "sponsored")
    pp = schema_ids(c, "instagram", "reel", "paid_partnership")
    assert {"partner_brand", "product", "relationship", "connection_details", "disclosure", "creator_script"} <= set(pp)
    assert "offer_valid_until" in schema_ids(c, "whatsapp", "text", "promo_offer")
    assert "offer_valid_until" not in schema_ids(c, "whatsapp", "text")  # no irrelevant fields
    assert c.get("/api/input-schema?platform=myspace&format=x").status_code == 400
    prof = c.get("/api/validation-profile?platform=instagram&format=feed&context=paid_partnership").json()
    layer = {L["id"]: [x["id"] for x in L["checks"]] for L in prof["layers"]}
    assert "PLAT-LENGTH" in layer["platform"] and "CTX-DISCLOSURE" in layer["regulation"] and "IMG-ALT" in layer["visual"]
    assert "R1" in layer["regulation"] and "R3" in layer["brand"]  # a brand preference is not shown as law


def test_linkedin_text_and_text_image():
    get_store().reset()
    c = client("Creator")
    d = post(c, "linkedin", "text", content="Northstar Civils Academy: weekly mock tests start Monday.").json()
    assert d["channel"] == "LinkedIn · Text-only post" and d["input_errors"] == []
    long = post(c, "linkedin", "text", content="x" * 3001).json()
    f = next(x for x in long["findings"] if x["rule_id"] == "PLAT-LENGTH")
    assert f["severity"] == "warning" and f["layer"] == "platform" and "3,000" in f["sources"][0]
    assert all(x["layer"] in {"platform", "regulation", "brand", "facts", "visual"} and x["confidence"] for x in long["findings"])
    missing = post(c, "linkedin", "text_image", content="See the poster").json()
    assert any(e["field"] == "media" for e in missing["input_errors"])
    ok = post(c, "linkedin", "text_image", content="See the poster", images=[IMG]).json()
    assert ok["input_errors"] == []


def test_instagram_image_and_carousel():
    get_store().reset()
    c = client("Creator")
    tall = IMG | {"width": 1080, "height": 1920}
    d = post(c, "instagram", "feed", content="Admissions open", images=[tall]).json()
    asp = next(x for x in d["findings"] if x["rule_id"] == "PLAT-ASPECT")
    assert asp["severity"] == "suggestion"  # a formatting difference is not a violation
    assert post(c, "instagram", "feed", images=[IMG]).json()["input_errors"][0]["field"] == "main_text"  # caption required
    one = post(c, "instagram", "carousel", content="Swipe", images=[IMG]).json()
    assert any("at least 2" in e["message"] for e in one["input_errors"])
    tags = " ".join(f"#t{i}" for i in range(31))
    three = post(c, "instagram", "carousel", content="Swipe", fields={"hashtags": tags}, images=[IMG, IMG, IMG]).json()
    assert three["input_errors"] == [] and any(x["rule_id"] == "PLAT-HASHTAGS" for x in three["findings"])


def test_whatsapp_text_and_website_promotional_banner():
    get_store().reset()
    c = client("Creator")
    w = post(c, "whatsapp", "text", content="Northstar Civils Academy: classes resume on Monday.").json()
    assert w["input_errors"] == [] and w["channel"] == "WhatsApp broadcast · Text-only message"
    bad = post(c, "website", "promo", context="promo_offer", images=[IMG],
               fields={"headline": "Free demo class", "cta": "Book", "url": "not a link", "offer_details": "Free demo class",
                       "offer_valid_until": "2020-01-01"}).json()
    assert any(e["field"] == "url" for e in bad["input_errors"])
    assert {"CTX-OFFER-ENDED", "CTX-OFFER-TERMS"} <= ids(bad["findings"])
    ended = next(x for x in bad["findings"] if x["rule_id"] == "CTX-OFFER-ENDED")
    assert ended["severity"] == "blocker" and ended["location_label"] == "Offer valid until"


def test_instagram_paid_partnership_disclosure():
    get_store().reset()
    c = client("Creator")
    pp = {"partner_brand": "Northstar", "product": "Mock tests", "relationship": "Paid", "connection_details": "Paid Rs 10,000",
          "disclosure": "#ad"}
    none = post(c, "instagram", "feed", "paid_partnership", content="Loved these mock tests!", fields=pp, images=[IMG]).json()
    f = next(x for x in none["findings"] if x["rule_id"] == "CTX-DISCLOSURE")
    assert f["severity"] == "blocker" and f["layer"] == "regulation" and any("ASCI" in s_ for s_ in f["sources"])
    assert not any(x["location"] == "field:connection_details" for x in none["findings"])  # internal detail, not ad copy
    upfront = post(c, "instagram", "feed", "paid_partnership", content="#ad Loved these mock tests!", fields=pp, images=[IMG]).json()
    assert not any(x["rule_id"].startswith("CTX-DISCLOSURE") for x in upfront["findings"])
    buried = post(c, "instagram", "feed", "paid_partnership", content="Loved these mock tests from the academy! #upsc #exam #ad #study",
                  fields=pp, images=[IMG]).json()
    assert any(x["rule_id"] == "CTX-DISCLOSURE-BURIED" for x in buried["findings"])
    reel = post(c, "instagram", "reel", "paid_partnership", content="#ad mock tests", fields=pp,
                images=[IMG | {"kind": "video", "width": 1080, "height": 1920, "duration": 20}]).json()
    v = next(x for x in reel["findings"] if x["rule_id"] == "CTX-DISCLOSURE-VIDEO")
    assert v["confidence"] == "Unverified" and v["outcome"] == "Couldn't verify"  # not invented
    no_fields = post(c, "instagram", "feed", "paid_partnership", content="#ad x", images=[IMG]).json()
    assert any(e["field"] == "relationship" for e in no_fields["input_errors"])


def test_linkedin_sponsored_and_review_workflow():
    get_store().reset()
    c = client("Creator")
    no_sponsor = post(c, "linkedin", "text", "sponsored", content="Northstar Civils Academy mock tests").json()
    assert any(e["field"] == "sponsor" for e in no_sponsor["input_errors"])
    assert c.post(f"/api/drafts/{no_sponsor['id']}/submit").status_code == 400  # fields missing
    d = c.put(f"/api/drafts/{no_sponsor['id']}", json={"title": "t", "platform": "linkedin", "format": "text", "context": "sponsored",
                                                       "content": "Northstar Civils Academy mock tests", "fields": {"sponsor": "Northstar"}}).json()
    assert d["input_errors"] == [] and d["version"] == 2 and d["versions"][-1]["fields"] == {"sponsor": "Northstar"}
    assert not any(x["rule_id"].startswith("CTX-DISCLOSURE") for x in d["findings"])  # own sponsored post: the platform labels it
    assert c.post(f"/api/drafts/{d['id']}/submit").json()["status"] == "in_review"
    as_role(c, "Reviewer")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).json()["status"] == "approved"
    res = c.get(f"/api/drafts/{d['id']}/results").json()
    assert [L["id"] for L in res["layers"]] == ["platform", "regulation", "brand", "facts", "visual"] and res["profile"]


def test_adapt_campaign_to_multiple_platforms():
    get_store().reset()
    c = client("Creator")
    src = post(c, "instagram", "feed", content="Northstar Civils Academy: weekly mock tests start Monday. Join us!",
               fields={"hashtags": "#upsc #mocktests", "url": "https://northstar.example"}, images=[IMG]).json()
    r = c.post(f"/api/drafts/{src['id']}/adapt", json={"targets": [
        {"platform": "linkedin", "format": "text_image"}, {"platform": "whatsapp", "format": "text"},
        {"platform": "website", "format": "promo"}]}).json()
    assert len(r["created"]) == 3
    li, wa, web = (c.get(f"/api/drafts/{x['id']}").json() for x in r["created"])
    assert li["platform"] == "linkedin" and li["images"] and li["fields"]["hashtags"] == "#upsc #mocktests"
    assert wa["images"] == [] and "#upsc" not in wa["content"] and "mock tests" in wa["content"]
    assert web["fields"]["headline"].startswith("Northstar Civils Academy") and web["fields"]["cta"] == "Learn more"
    assert all(x["status"] == "draft" and x["campaign_id"] == src["id"] for x in (li, wa, web))  # each needs its own review
    assert all(any(e["action"] == "Adapted from another post" for e in x["events"]) for x in (li, wa, web))


def test_missing_fields_and_invalid_uploads():
    import base64
    get_store().reset()
    c = client("Creator")
    video_in_feed = post(c, "instagram", "feed", content="hi", images=[IMG | {"kind": "video"}]).json()
    assert any("accepts image only" in e["message"] for e in video_in_feed["input_errors"])
    assert post(c, "instagram", "nope", content="hi").status_code == 400
    assert post(c, "instagram", "feed", content="hi", images=[IMG] * 11).status_code == 422
    assert c.post("/api/extract-text", json={"file_name": "x.pdf", "data_b64": "bm90IGEgcGRm"}).status_code == 400
    pdf = open(os.path.join(os.path.dirname(__file__), "fixtures", "sunrise_brand_book.pdf"), "rb").read()
    out = c.post("/api/extract-text", json={"file_name": "s.pdf", "data_b64": base64.b64encode(pdf).decode()}).json()
    assert out["pages"] >= 1 and "Sunrise" in out["text"]
    doc = post(c, "linkedin", "document", content="Our brochure", fields={"doc_title": "Brochure"},
               images=[{"kind": "document", "file_name": "s.pdf", "text": "100% selection guaranteed"}]).json()
    assert doc["input_errors"] == [] and any(x["rule_id"] == "R1" and x["location"] == "document 1" for x in doc["findings"])


def test_all_history_is_grouped_by_brand():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"title": "Old brand post", "content": "Classes resume on Monday"}).json()
    old = get_store().get("draft", d["id"]) | {"kit_id": "2025-01-01T00:00:00+00:00", "kit_name": "Sunrise Tutorials"}
    get_store().put("draft", old)
    as_role(c, "Reviewer")
    a = c.get("/api/analytics?scope=all").json()
    names = [b["name"] for b in a["kit"]["brands"]]
    assert "Northstar Civils Academy (demo)" in names and "Sunrise Tutorials" in names
    assert {b["name"]: b["posts"] for b in a["by_brand"]}["Sunrise Tutorials"] == 1
    only = c.get("/api/analytics?scope=all&brand=2025-01-01T00:00:00%2B00:00").json()
    assert [p["title"] for p in only["posts"]] == ["Old brand post"] and only["kit"]["brand"]
    ins = c.get("/api/insights?scope=all&brand=2025-01-01T00:00:00%2B00:00").json()
    assert ins["drafts"] == 1 and ins["quiet"] == []


def test_demo_sign_in_without_password():
    os.environ.pop("LBC_REQUIRE_PASSWORD")
    try:
        c = TestClient(index.app, headers=H)
        assert c.get("/api/health").json()["password_required"] is False
        r = c.post("/api/login", json={"role": "Reviewer"})
        assert r.status_code == 200 and r.json()["name"] == "Arjun (brand reviewer)"
        assert c.get("/api/session").json()["role"] == "Reviewer"
        assert TestClient(index.app).post("/api/login", json={"role": "Reviewer"}).status_code == 403  # X-LBC still required
        assert TestClient(index.app, headers=H).get("/api/drafts").status_code == 401  # still needs a session
    finally:
        os.environ["LBC_REQUIRE_PASSWORD"] = "1"


def test_brand_fit_says_no_to_a_post_for_another_brand():
    get_store().reset()
    c = client("Creator")
    on = {"kind": "image", "file_name": "on.jpg", "text": "Northstar Civils Academy UPSC prelims test series",
          "alt_text": "Poster", "brand_share": 0.6, "width": 1080, "height": 1080}
    good = post(c, "instagram", "feed", content="Join our UPSC prelims test series and mentoring for the new batch of aspirants.",
                fields={"hashtags": "#upsc #prelims"}, images=[on]).json()
    assert good["summary"]["brand_fit"]["verdict"] == "yes" and "BRAND-FIT" not in ids(good["findings"])
    assert any(p_["check"] == "BRAND-FIT" for p_ in good["summary"]["passed"])

    off = {"kind": "image", "file_name": "pizza.jpg", "text": "Pizza Palace large pizza 50% off", "alt_text": "Pizza",
           "brand_share": 0.05, "width": 1080, "height": 1080}
    bad = post(c, "instagram", "feed", content="Craving cheese? Grab a large pepperoni pizza tonight, delivered hot to your door.",
               fields={"hashtags": "#pizza #foodie"}, images=[off]).json()
    fit = bad["summary"]["brand_fit"]
    assert fit["verdict"] == "no"
    assert {s_["id"] for s_ in fit["signals"] if s_["status"] == "fail"} >= {"name", "colours", "topics", "offers"}
    f = bad["findings"][0]
    assert f["rule_id"] == "BRAND-FIT" and f["severity"] == "blocker" and f["sources"] and f["location_label"] == "Post"
    assert f["name"] == "Not a post for Northstar Civils Academy"
    assert c.post(f"/api/drafts/{bad['id']}/submit").status_code == 400
    c.post(f"/api/drafts/{bad['id']}/decisions", json={"finding_id": f["id"], "action": "accept"})
    assert "Not a post for Northstar Civils Academy" in c.post(f"/api/drafts/{bad['id']}/submit").json()["detail"]["blockers"]

    # partly on brand: the name is there but the colours are off -> weak, no blocker
    meh = post(c, "instagram", "feed", content="Northstar Civils Academy UPSC mains mentoring starts Monday for all aspirants.",
               images=[on | {"brand_share": 0.05}]).json()
    assert meh["summary"]["brand_fit"]["verdict"] == "weak" and "BRAND-FIT" not in ids(meh["findings"])
    assert not any(p_["check"] == "BRAND-FIT" for p_ in meh["summary"]["passed"])

    # a brand that had its own kit here before is "another brand"
    old = get_store().get("draft", good["id"]) | {"archived": True, "kit_name": "Sunrise Tutorials"}
    get_store().put("draft", old)
    other = post(c, "instagram", "feed", content="Northstar Civils Academy and Sunrise Tutorials UPSC prelims batch for aspirants.",
                 images=[on]).json()
    assert other["summary"]["brand_fit"]["verdict"] == "no"


def test_brand_kit_topics_from_pdf():
    from _lbc import brandkit
    kit = brandkit.pattern_read(["Sunrise Tutorials\nWe teach maths and science tuition. #SunriseLearning\n"
                                 "Maths tuition for class 10. Science tuition for class 12. Maths and science doubt classes."])
    words = [k["text"] for k in kit["keywords"]]
    assert "#SunriseLearning" in words and "tuition" in words and "maths" in words
    assert all(k["quote"] and k["page"] == 1 for k in kit["keywords"])
    from _lbc.brandapply import build_workspace
    meta = build_workspace({"brand_name": {"text": "Sunrise"}, "keywords": [{"text": " Maths "}, {"text": "maths"}, {"text": "#Tuition"}]})[0]
    assert meta["keywords"] == ["maths", "#tuition"]


def test_brand_memory_learns_from_posts_and_never_changes_the_kit():
    get_store().reset()
    c = client("Creator")
    kit_before = {k: get_store().list(k) for k in ("rule", "fact", "guideline")}
    meta_before = get_store().get("meta", "workspace")
    on = {"kind": "image", "file_name": "on.jpg", "text": "Northstar Civils Academy UPSC prelims", "alt_text": "Poster",
          "brand_share": 0.6, "width": 1080, "height": 1080}
    texts = ["Northstar Civils Academy weekend essay workshop for UPSC aspirants. Seats limited.",
             "Northstar Civils Academy essay workshop returns this weekend for UPSC aspirants.",
             "Join the Northstar Civils Academy essay workshop: practise answers with mentors."]
    reviewer = TestClient(index.app, headers=H)
    reviewer.post("/api/login", json={"password": TEST_PW, "role": "Reviewer"})
    for i, t in enumerate(texts):
        d = post(c, "instagram", "feed", content=t, images=[on], title=f"Workshop {i}").json()
        assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200, d["findings"]
        if i == 0:
            assert reviewer.post(f"/api/drafts/{d['id']}/review", json={"action": "request_changes",
                                 "comment": "Mention the batch start date"}).status_code == 200
            assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200
        assert reviewer.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).status_code == 200
    m = reviewer.get("/api/memory").json()["memory"]
    assert m["approved_posts"] == 3 and m["style"] is not None
    assert "workshop" in [t["text"] for t in m["topics"]] and "essay" in [t["text"] for t in m["topics"]]
    assert m["feedback"][0]["text"] == "Mention the batch start date"
    # the brand kit itself is untouched
    assert {k: get_store().list(k) for k in ("rule", "fact", "guideline")} == kit_before
    assert get_store().get("meta", "workspace") == meta_before

    # house style: far more '!' than any approved post -> a suggestion with a memory source, never a blocker
    loud = c.post("/api/check", json={"platform": "instagram", "format": "feed", "content":
                  "Northstar Civils Academy essay workshop!!! Join now!!!", "images": [on]}).json()
    st = [f for f in loud["findings"] if f["rule_id"] == "MEM-STYLE"]
    assert st and all(f["severity"] == "suggestion" and "Brand memory" in f["sources"][0] for f in st)

    # mistakes fixed before are remembered
    for _ in range(2):
        d = post(c, "instagram", "feed", content="Northstar Civils Academy essay workshop, slang: cracked it", images=[on]).json()
        f = next(x for x in d["findings"] if x["rule_id"] == "R5")
        c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": f["id"], "action": "accept"})
    again = c.post("/api/check", json={"content": "Our students cracked it"}).json()
    assert next(x for x in again["findings"] if x["rule_id"] == "R5")["seen_before"] == 2

    # only the marketing head can make it forget a topic
    assert reviewer.post("/api/memory/forget", json={"topic": "workshop"}).status_code == 403
    as_role(reviewer, "Marketing head")
    left = reviewer.post("/api/memory/forget", json={"topic": "workshop"}).json()
    assert "workshop" not in [t["text"] for t in left["topics"]] and "workshop" in left["forgotten"]


def test_pdf_reader_finds_tone_positioning_and_banned_words():
    from _lbc import brandkit
    page = ("BRAND TOOLKIT\nACME PAYMENTS \u2013 India Region Guidelines\n5. Words We Don't Use:\n"
            "\"Instant transfer\" (Instead use: \"In minutes\")\n\"Cheap\" (Instead use: \"Transparent fees\")\n"
            "6. Fees and Offers\nUse only approved metrics.\n"
            "Overall Tone: Trusted, global and secure. We connect families and enable global opportunities.\n"
            "Sensitive Topic \u2014 Security & Fraud: Never make light of scams.\n")
    kit = brandkit.pattern_read([page])
    assert kit["brand_name"]["text"] == "Acme Payments"
    assert [b["text"] for b in kit["banned_phrases"]] == ["Instant transfer", "Cheap"]
    assert kit["tone_rules"][0]["text"] == "Trusted, global and secure."
    assert any(g["section"] == "Positioning" and g["text"].startswith("We connect families") for g in kit["guidelines"])
    assert {"security", "fraud"} <= {t["text"] for t in kit["sensitive_topics"]}


# ---------- personal accounts, invitations and the wrong-password lock ----------

def _accounts_client():
    """Accounts mode with no accounts yet (accounts survive a demo reset, so clear them here)."""
    import json
    os.environ["LBC_AUTH_MODE"] = "accounts"
    os.environ["LBC_DEMO_ACCOUNTS"] = "0"  # tests that need them switch them on
    from _lbc.store import base_store
    get_store().reset()
    st = base_store()
    db = json.loads(st.path.read_text())
    db["user"], db["invite"] = {}, {}
    st.path.write_text(json.dumps(db))
    auth.clear_all_attempts()
    return TestClient(index.app, headers=H)


def _login(email, password):
    auth.clear_all_attempts()  # the per-device limit is tested separately; here we test the per-account rule
    return TestClient(index.app, headers=H).post("/api/login/account", json={"email": email, "password": password})


def test_accounts_setup_invites_and_roles():
    from _lbc import accounts
    try:
        c = _accounts_client()
        h = c.get("/api/health").json()
        assert h["auth_mode"] == "accounts" and h["setup_needed"] is True
        assert c.post("/api/login", json={"role": "Marketing head"}).status_code == 400  # no role picking
        # first account: a marketing head, with a strong password
        assert c.post("/api/setup", json={"name": "Meera Rao", "email": "meera@example.com", "password": "short"}).status_code == 400
        r = c.post("/api/setup", json={"name": "Meera Rao", "email": "Meera@Example.com", "password": "orange teal sunrise 42"})
        assert r.status_code == 200 and r.json()["role"] == "Marketing head"
        assert c.post("/api/setup", json={"name": "X Y", "email": "x@example.com", "password": "another long pass 9"}).status_code == 409
        assert c.get("/api/drafts").status_code == 200
        assert c.post("/api/session/role", json={"role": "Creator"}).status_code == 403  # roles belong to accounts

        # invitations are one-time links; only a hash of the token is stored
        token = c.post("/api/team/invites", json={"name": "Priya S", "email": "priya@example.com", "role": "Creator"}).json()["token"]
        rev_token = c.post("/api/team/invites", json={"name": "Arjun K", "email": "arjun@example.com", "role": "Reviewer"}).json()["token"]
        assert all(token not in str(i) for i in get_store().list("invite"))
        p = TestClient(index.app, headers=H)
        assert p.post("/api/invite/lookup", json={"token": token}).json()["role"] == "Creator"
        assert p.post("/api/invite/accept", json={"token": token, "password": "priya@example"}).status_code == 400
        assert p.post("/api/invite/accept", json={"token": token, "password": "mangoes are tasty 7"}).status_code == 200
        assert p.post("/api/invite/accept", json={"token": token, "password": "mangoes are tasty 7"}).status_code == 404
        assert p.get("/api/session").json()["name"] == "Priya S"
        assert p.get("/api/team").status_code == 403  # creators can't manage the team
        a = TestClient(index.app, headers=H)
        a.post("/api/invite/accept", json={"token": rev_token, "password": "reviewing all day 3"})

        # a post written by Priya is approved by Arjun, by name and by account
        d = p.post("/api/drafts", json={"title": "t", "content": "Northstar Civils Academy classes resume Monday."}).json()
        assert d["author"] == "Priya S" and d["author_id"] == accounts.user_id("priya@example.com")
        assert p.post(f"/api/drafts/{d['id']}/submit").status_code == 200
        assert a.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).json()["review"]["by"] == "Arjun K"

        # role change and deactivation take effect at once
        priya_id = accounts.user_id("priya@example.com")
        assert c.patch(f"/api/team/{priya_id}", json={"role": "Reviewer"}).json()["role"] == "Reviewer"
        assert p.get("/api/session").status_code == 401  # old session ended
        assert c.patch(f"/api/team/{accounts.user_id('meera@example.com')}", json={"active": False}).status_code == 400  # not yourself
        c.patch(f"/api/team/{priya_id}", json={"active": False})
        assert _login("priya@example.com", "mangoes are tasty 7").status_code == 401

        # changing the password signs out other devices; accounts survive a demo reset
        m = TestClient(index.app, headers=H)
        assert m.post("/api/login/account", json={"email": "meera@example.com", "password": "orange teal sunrise 42"}).status_code == 200
        assert c.post("/api/account/password", json={"current": "orange teal sunrise 42", "new": "new strong phrase 88"}).status_code == 200
        assert m.get("/api/session").status_code == 401
        c.post("/api/reset")
        assert get_store().get("user", accounts.user_id("meera@example.com"))
    finally:
        os.environ.pop("LBC_AUTH_MODE", None)
        os.environ.pop("LBC_DEMO_ACCOUNTS", None)
        auth.clear_all_attempts()


def test_three_wrong_passwords_pause_and_five_block():
    from datetime import timedelta
    from _lbc import accounts
    try:
        c = _accounts_client()
        c.post("/api/setup", json={"name": "Meera Rao", "email": "meera@example.com", "password": "orange teal sunrise 42"})
        tok = c.post("/api/team/invites", json={"name": "Arjun K", "email": "arjun@example.com", "role": "Reviewer"}).json()["token"]
        TestClient(index.app, headers=H).post("/api/invite/accept", json={"token": tok, "password": "reviewing all day 3"})
        uid = accounts.user_id("arjun@example.com")

        r1, r2 = _login("arjun@example.com", "wrong guess one"), _login("arjun@example.com", "wrong guess two")
        assert r1.status_code == 401 and "2 more wrong attempts" in r1.json()["detail"]
        assert "1 more wrong attempt" in r2.json()["detail"]
        r3 = _login("arjun@example.com", "wrong guess three")
        assert r3.status_code == 429 and "Try again in 15 minutes" in r3.json()["detail"]
        # during the 15 minutes even the right password is refused, and the attempt isn't counted
        assert _login("arjun@example.com", "reviewing all day 3").status_code == 429
        assert get_store().get("user", uid)["failed"] == 3

        # time passes: the timer ends, then 2 more wrong passwords block the account
        u = get_store().get("user", uid)
        get_store().put("user", u | {"locked_until": accounts.iso(accounts.now_dt() - timedelta(minutes=1))})
        assert "1 more wrong attempt" in _login("arjun@example.com", "wrong guess four").json()["detail"]
        r5 = _login("arjun@example.com", "wrong guess five")
        assert r5.status_code == 423 and "blocked" in r5.json()["detail"]
        assert _login("arjun@example.com", "reviewing all day 3").status_code == 423  # blocked even with the right password
        row = next(x for x in c.get("/api/team").json()["users"] if x["id"] == uid)
        assert row["blocked"] is True

        # only a marketing head can unblock; then the right password works and the count starts again
        a = TestClient(index.app, headers=H)
        assert a.post(f"/api/team/{uid}/unblock").status_code == 401
        assert c.post(f"/api/team/{uid}/unblock").json()["blocked"] is False
        assert _login("arjun@example.com", "reviewing all day 3").status_code == 200
        assert get_store().get("user", uid)["failed"] == 0

        # a correct password before the limit resets the count
        _login("arjun@example.com", "one wrong guess")
        assert _login("arjun@example.com", "reviewing all day 3").status_code == 200
        assert get_store().get("user", uid)["failed"] == 0
        # unknown emails get the same plain message
        assert _login("nobody@example.com", "whatever pass 1").json()["detail"] == "Wrong email or password."
    finally:
        os.environ.pop("LBC_AUTH_MODE", None)
        os.environ.pop("LBC_DEMO_ACCOUNTS", None)
        auth.clear_all_attempts()


def test_demo_accounts_shown_paused_but_never_blocked():
    from _lbc import accounts
    try:
        c = _accounts_client()
        os.environ["LBC_DEMO_ACCOUNTS"] = "1"
        h = c.get("/api/health").json()
        assert [a["email"] for a in h["demo_accounts"]] == ["meera@xyz.com", "priya@xyz.com", "arjun@xyz.com"]
        assert h["setup_needed"] is False
        assert _login("meera@xyz.com", "Meera@_1").json()["role"] == "Marketing head"
        p = TestClient(index.app, headers=H)
        assert p.post("/api/login/account", json={"email": "priya@xyz.com", "password": "Priya@_1"}).json()["role"] == "Creator"
        assert p.post("/api/account/password", json={"current": "Priya@_1", "new": "something else long 1"}).status_code == 403
        m = TestClient(index.app, headers=H)
        m.post("/api/login/account", json={"email": "meera@xyz.com", "password": "Meera@_1"})
        assert m.patch(f"/api/team/{accounts.user_id('priya@xyz.com')}", json={"active": False}).status_code == 400
        # 3 wrong = 15-minute pause, but the count restarts, so 5 wrong never blocks a demo account
        for i in range(3):
            r = _login("arjun@xyz.com", f"wrong guess {i}")
        assert r.status_code == 429 and "blocked" not in r.json()["detail"]
        u = get_store().get("user", accounts.user_id("arjun@xyz.com"))
        assert u["failed"] == 0 and not u.get("blocked")
        get_store().put("user", u | {"locked_until": None})
        for i in range(2):
            _login("arjun@xyz.com", f"more wrong {i}")
        assert not get_store().get("user", accounts.user_id("arjun@xyz.com")).get("blocked")
        assert _login("arjun@xyz.com", "Arjun@_1").status_code == 200
        os.environ["LBC_DEMO_ACCOUNTS"] = "0"
        assert c.get("/api/health").json()["demo_accounts"] == []  # can be switched off for real use
    finally:
        os.environ.pop("LBC_AUTH_MODE", None)
        os.environ.pop("LBC_DEMO_ACCOUNTS", None)
        auth.clear_all_attempts()


def test_creators_are_reviewed_only_by_their_paired_reviewers():
    from _lbc import accounts
    try:
        c = _accounts_client()
        c.post("/api/setup", json={"name": "Meera Rao", "email": "meera@example.com", "password": "orange teal sunrise 42"})

        def join(name, email, role, assign=()):
            r = c.post("/api/team/invites", json={"name": name, "email": email, "role": role, "assign": list(assign)})
            assert r.status_code == 200, r.text
            t = TestClient(index.app, headers=H)
            assert t.post("/api/invite/accept", json={"token": r.json()["token"], "password": f"{role.lower()} strong pass 9"}).status_code == 200
            return t, accounts.user_id(email)

        # the first reviewer has no creator to pick yet, so the pairing is optional
        arjun, arjun_id = join("Arjun K", "arjun@example.com", "Reviewer")
        # a creator must now be paired with a reviewer
        assert c.post("/api/team/invites", json={"name": "Priya S", "email": "priya@example.com", "role": "Creator"}).status_code == 400
        assert c.post("/api/team/invites", json={"name": "Priya S", "email": "priya@example.com", "role": "Creator",
                                                 "assign": [accounts.user_id("meera@example.com")]}).status_code == 400  # not a reviewer
        priya, priya_id = join("Priya S", "priya@example.com", "Creator", [arjun_id])
        # a second reviewer is invited for a creator; several each way are allowed
        neha, neha_id = join("Neha R", "neha@example.com", "Reviewer", [priya_id])
        ravi, ravi_id = join("Ravi T", "ravi@example.com", "Reviewer", [priya_id])
        team = {u["id"]: u for u in c.get("/api/team").json()["users"]}
        assert set(team[priya_id]["reviewer_ids"]) == {arjun_id, neha_id, ravi_id}
        assert team[arjun_id]["creator_ids"] == [priya_id]

        # take Ravi off Priya: now only Arjun and Neha (or the marketing head) may review her posts
        r = c.put(f"/api/team/{ravi_id}/assignments", json={"ids": []}).json()
        assert r["creator_ids"] == []
        d = priya.post("/api/drafts", json={"title": "t", "content": "Northstar Civils Academy classes resume Monday."}).json()
        assert priya.post(f"/api/drafts/{d['id']}/submit").status_code == 200
        seen = ravi.get(f"/api/drafts/{d['id']}").json()
        assert seen["can_review"] is False and set(seen["assigned_reviewers"]) == {"Arjun K", "Neha R"}
        assert ravi.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).status_code == 403
        listed = next(x for x in arjun.get("/api/drafts?status=in_review").json() if x["id"] == d["id"])
        assert listed["can_review"] is True
        assert neha.post(f"/api/drafts/{d['id']}/review", json={"action": "request_changes", "comment": "Add the batch date"}).status_code == 200

        # the marketing head can always review; a creator whose reviewers all left can be reviewed by anyone
        assert priya.post(f"/api/drafts/{d['id']}/submit").status_code == 200
        c.patch(f"/api/team/{arjun_id}", json={"active": False})
        c.patch(f"/api/team/{neha_id}", json={"active": False})
        assert ravi.get(f"/api/drafts/{d['id']}").json()["can_review"] is True
        # changing Priya's role drops her pairing
        c.patch(f"/api/team/{priya_id}", json={"role": "Reviewer"})
        assert "reviewer_ids" not in get_store().get("user", priya_id)
    finally:
        os.environ.pop("LBC_AUTH_MODE", None)
        os.environ.pop("LBC_DEMO_ACCOUNTS", None)
        auth.clear_all_attempts()


# ---------- Round 3: trusted history and AI tone ----------

FIXED_POST = ("Northstar Civils Academy for UPSC. 32 students from our paid full course and 18 from our free "
              "interview-guidance programme qualified this year. Structured mentoring and weekly mock tests. "
              "Foundation course fee for the 2026-27 batch: Rs 48,000.")


def _approved_post(c):
    d = c.post("/api/drafts", json={"title": "Fee post", "content": FIXED_POST}).json()
    assert c.post(f"/api/drafts/{d['id']}/submit").json()["status"] == "in_review"
    as_role(c, "Reviewer")
    ok = c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).json()
    assert ok["status"] == "approved"
    return ok


def test_approval_reopens_when_a_relied_on_fact_changes():
    get_store().reset()
    c = client("Creator")
    d = _approved_post(c)
    assert "F1" in {e["fact_id"] for e in d["evidence"]}
    as_role(c, "Marketing head")
    r = c.put("/api/facts/F2", json={"amount": 46000}).json()  # a fact this post did not rely on
    assert r["reopened_posts"] == 0 and c.get(f"/api/drafts/{d['id']}").json()["status"] == "approved"
    r = c.put("/api/facts/F1", json={"amount": 52000}).json()
    assert r["reopened_posts"] == 1
    back = c.get(f"/api/drafts/{d['id']}").json()
    assert back["status"] == "in_review" and "changed after this post was approved" in back["reopened"]["reasons"][0]
    assert any(f["rule_id"].startswith("FACT-") for f in back["findings"])  # re-checked against the new fee
    assert "Approval reopened" in [e["action"] for e in back["events"]]
    assert c.get("/api/drafts?status=in_review").json()[0]["reopened"]


def test_audit_log_is_hash_linked_and_detects_tampering():
    get_store().reset()
    c = client("Creator")
    _approved_post(c)
    v = c.get("/api/audit/verify").json()
    assert v["ok"] and v["entries"] >= 4 and v["legacy"] == 0
    store = get_store()
    events = sorted(store.list("event"), key=lambda e: e["seq"])
    victim = dict(events[2], detail="rewritten later")
    store.put("event", victim)
    bad = c.get("/api/audit/verify").json()
    assert not bad["ok"] and bad["broken_at"]["seq"] == victim["seq"] and "changed" in bad["broken_at"]["reason"]


def test_approval_record_pdf():
    get_store().reset()
    c = client("Creator")
    d = _approved_post(c)
    r = c.get(f"/api/drafts/{d['id']}/record.pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-1.4") and r.content.rstrip().endswith(b"%%EOF")
    assert b"Approval record" in r.content and b"Arjun" in r.content and b"fingerprint" in r.content
    other = c.post("/api/drafts", json={"content": "Weekly mock tests at Northstar Civils Academy"})
    as_role(c, "Creator")
    other = c.post("/api/drafts", json={"content": "Weekly mock tests at Northstar Civils Academy"}).json()
    assert c.get(f"/api/drafts/{other['id']}/record.pdf").status_code == 409


def test_tone_check_is_rule_based_and_cites_the_tone_guideline():
    from _lbc import tone
    get_store().reset()
    c = client("Creator")
    text = "Hurry, last chance to join!!! Northstar Civils Academy weekly mock tests are amazing. JOIN US TODAY. UPSC and IAS aspirants welcome."
    d = c.post("/api/check", json={"content": text}).json()
    t = [f for f in d["findings"] if f["rule_id"] == "TONE"]
    names = {f["name"] for f in t}
    assert {"Word the tone guideline avoids", "Shouting in capitals", "Too many exclamation marks", "Hype or pressure word"} <= names
    for f in t:
        assert f["severity"] == "suggestion" and f["engine"] == "Rule-based"
        assert f["sources"][0].startswith("Brand guideline (Voice)")
        assert text[f["start"]:f["end"]] == f["quote"]
    assert not any(f["quote"] in ("UPSC", "IAS") for f in t)  # short acronyms are not shouting
    assert d["summary"]["tone"]["status"] == "done" and "no AI" in d["summary"]["tone"]["message"]
    calm = c.post("/api/check", json={"content": "Weekly mock tests and mentoring at Northstar Civils Academy."}).json()
    assert not [f for f in calm["findings"] if f["rule_id"] == "TONE"]
    assert any(p["check"] == "TONE" for p in calm["summary"]["passed"])
    # no tone guideline in the kit: nothing is flagged and the status says why
    issues, status = tone.check([("caption", "Caption", "HURRY NOW!!!")], [{"id": "G1", "section": "Name", "text": "Use the full name."}])
    assert issues == [] and status["status"] == "skipped"


def test_multi_brand_workspaces_keep_data_separate_and_follow_membership():
    from _lbc import accounts
    try:
        c = _accounts_client()
        os.environ["LBC_DEMO_ACCOUNTS"] = "1"
        c.get("/api/health")
        head, priya, arjun = _login("meera@xyz.com", "Meera@_1"), _login("priya@xyz.com", "Priya@_1"), _login("arjun@xyz.com", "Arjun@_1")
        hc = TestClient(index.app, headers=H, cookies=head.cookies)
        pc = TestClient(index.app, headers=H, cookies=priya.cookies)
        ac = TestClient(index.app, headers=H, cookies=arjun.cookies)
        b = hc.get("/api/brands").json()
        assert [x["name"] for x in b["brands"]] == ["Northstar Civils Academy", "Sunrise Tutorials"] and b["can_add"]
        assert {x["id"] for x in pc.get("/api/brands").json()["brands"]} == {"main", "sunrise"}  # demo Priya: both brands
        # posts belong to the brand they were written in
        d = pc.post("/api/drafts", json={"title": "Northstar post", "content": "Weekly mock tests at Northstar Civils Academy."}).json()
        assert pc.post("/api/brand", json={"id": "sunrise"}).status_code == 200
        pc.cookies.set("lbc_brand", "sunrise")
        assert d["id"] not in {x["id"] for x in pc.get("/api/drafts").json()}
        assert pc.get("/api/workspace").json()["meta"]["name"] == "Sunrise Tutorials"
        assert pc.get("/api/session").json()["brand"]["name"] == "Sunrise Tutorials"
        # a new brand starts with only the Indian ad regulations and no kit
        r = hc.post("/api/brands", json={"name": "Acme Foods"})
        assert r.status_code == 200 and r.json()["brand"]["empty"]
        acme = r.json()["brand"]["id"]
        hc.cookies.set("lbc_brand", acme)
        w = hc.get("/api/workspace").json()
        assert w["empty"] and w["facts"] == [] and all(x.get("source_type") == "regulatory" or x["name"] == "Sensitive topic" for x in w["rules"])
        assert hc.post("/api/brands", json={"name": "acme foods"}).status_code == 409
        # a reviewer who works only on Acme can't open the other brands, even with a forged cookie
        hc.cookies.set("lbc_brand", "main")
        inv = hc.post("/api/team/invites", json={"name": "Ravi", "email": "ravi@example.test", "role": "Reviewer", "brand_ids": [acme]}).json()
        assert inv["invite"]["brand_names"] == ["Acme Foods"]
        rv = TestClient(index.app, headers=H)
        assert rv.post("/api/invite/accept", json={"token": inv["token"], "password": "Blue-harbour-7741"}).status_code == 200
        assert [x["id"] for x in rv.get("/api/brands").json()["brands"]] == [acme]
        assert rv.post("/api/brand", json={"id": "main"}).status_code == 403
        rv.cookies.set("lbc_brand", "main")
        assert rv.get("/api/workspace").json()["meta"]["name"] == "Acme Foods"
        # the marketing head changes someone's brands on Team; heads always see every brand
        ravi = next(u for u in hc.get("/api/team").json()["users"] if u["email"] == "ravi@example.test")
        assert hc.put(f"/api/team/{ravi['id']}/brands", json={"ids": []}).status_code == 400
        assert hc.put(f"/api/team/{ravi['id']}/brands", json={"ids": [acme, "sunrise"]}).json()["brand_ids"] == [acme, "sunrise"]
        # My team (read-only): a reviewer sees the head and the creators they review on the open brand
        ac.cookies.set("lbc_brand", "main")
        t = ac.get("/api/my-team").json()
        assert t["brand"] == "Northstar Civils Academy" and [h["name"] for h in t["heads"]] == ["Meera (marketing head)"]
        assert [p["name"] for p in t["people"]] == ["Priya (social media)"]
        # starting the demo over restores only the sample brand; other brands are kept
        hc.cookies.set("lbc_brand", acme)
        assert hc.post("/api/reset").json()["brand"] == "main"
        assert {x["name"] for x in hc.get("/api/brands").json()["brands"]} >= {"Northstar Civils Academy", "Acme Foods"}
    finally:
        os.environ.pop("LBC_AUTH_MODE", None)
        os.environ.pop("LBC_DEMO_ACCOUNTS", None)


def test_marketing_head_can_remove_a_brand_completely():
    from _lbc.store import ScopedStore, base_store
    try:
        c = _accounts_client()
        os.environ["LBC_DEMO_ACCOUNTS"] = "1"
        c.get("/api/health")
        hc = TestClient(index.app, headers=H, cookies=_login("meera@xyz.com", "Meera@_1").cookies)
        acme = hc.post("/api/brands", json={"name": "Acme Foods"}).json()["brand"]["id"]
        inv = hc.post("/api/team/invites", json={"name": "Neha", "email": "neha@example.test", "role": "Creator", "brand_ids": [acme]}).json()
        TestClient(index.app, headers=H).post("/api/invite/accept", json={"token": inv["token"], "password": "Blue-harbour-7741"})
        pc = TestClient(index.app, headers=H, cookies=_login("priya@xyz.com", "Priya@_1").cookies)
        assert pc.get("/api/session").status_code == 200
        # only the marketing head, and only with the brand name typed
        pc.cookies.set("lbc_brand", "main")
        assert pc.post(f"/api/brands/{acme}/remove", json={"confirm": "Acme Foods"}).status_code == 403
        assert hc.post(f"/api/brands/{acme}/remove", json={"confirm": "Acme"}).status_code == 400
        r = hc.post(f"/api/brands/{acme}/remove", json={"confirm": "acme foods"})
        assert r.status_code == 200 and r.json()["removed"] == "Acme Foods"
        assert acme not in {b["id"] for b in hc.get("/api/brands").json()["brands"]}
        assert ScopedStore(base_store(), acme).list("rule") == [] and ScopedStore(base_store(), acme).get("meta", "workspace") is None
        neha = next(u for u in hc.get("/api/team").json()["users"] if u["email"] == "neha@example.test")
        assert neha["brand_ids"] == []  # keeps the account, needs a new brand
        # the other brands are untouched, and the last brand can't be removed
        assert hc.post("/api/brands/sunrise/remove", json={"confirm": "Sunrise Tutorials"}).status_code == 200
        assert hc.post("/api/brands/main/remove", json={"confirm": "Northstar Civils Academy"}).status_code == 409
        # starting the demo over brings a removed sample brand back
        assert hc.post("/api/reset").status_code == 200
    finally:
        os.environ.pop("LBC_AUTH_MODE", None)
        os.environ.pop("LBC_DEMO_ACCOUNTS", None)


def test_marketing_head_can_remove_a_deactivated_member():
    try:
        c = _accounts_client()
        os.environ["LBC_DEMO_ACCOUNTS"] = "1"
        c.get("/api/health")
        hc = TestClient(index.app, headers=H, cookies=_login("meera@xyz.com", "Meera@_1").cookies)
        team = hc.get("/api/team").json()
        priya = next(u for u in team["users"] if u["email"] == "priya@xyz.com")
        inv = hc.post("/api/team/invites", json={"name": "Kiran", "email": "kiran@example.test", "role": "Reviewer",
                                                 "brand_ids": ["main"], "assign": [priya["id"]]}).json()
        TestClient(index.app, headers=H).post("/api/invite/accept", json={"token": inv["token"], "password": "Blue-harbour-7741"})
        kiran = next(u for u in hc.get("/api/team").json()["users"] if u["email"] == "kiran@example.test")
        assert hc.post(f"/api/team/{kiran['id']}/remove").status_code == 409  # deactivate first
        assert hc.patch(f"/api/team/{kiran['id']}", json={"active": False}).status_code == 200
        r = hc.post(f"/api/team/{kiran['id']}/remove")
        assert r.status_code == 200 and r.json()["removed"] == "Kiran"
        users = hc.get("/api/team").json()["users"]
        assert "kiran@example.test" not in {u["email"] for u in users}
        assert kiran["id"] not in next(u for u in users if u["email"] == "priya@xyz.com")["reviewer_ids"]
        assert _login("kiran@example.test", "Blue-harbour-7741").status_code == 401  # can't sign in any more
        assert hc.post("/api/team/invites", json={"name": "Kiran", "email": "kiran@example.test", "role": "Reviewer",
                                                  "brand_ids": ["main"], "assign": [priya["id"]]}).status_code == 200  # can be invited again
        assert hc.post(f"/api/team/{priya['id']}/remove").status_code in (403, 409)  # demo accounts stay
        me = next(u for u in users if u["email"] == "meera@xyz.com")
        assert hc.post(f"/api/team/{me['id']}/remove").status_code == 400
    finally:
        os.environ.pop("LBC_AUTH_MODE", None)
        os.environ.pop("LBC_DEMO_ACCOUNTS", None)


def test_safety_shared_signin_limit_pdf_checks_and_backup():
    from _lbc import brandkit
    from _lbc.store import base_store
    # the sign-in limit is kept in the database (shared by every server copy), and IP addresses aren't stored
    get_store().reset()
    auth.clear_all_attempts()
    c = TestClient(index.app, headers=H)
    for _ in range(5):
        assert c.post("/api/login", json={"password": "wrong", "role": "Creator"}).status_code == 401
    assert c.post("/api/login", json={"password": TEST_PW, "role": "Creator"}).status_code == 429
    recs = base_store().list("ratelimit")
    assert recs and recs[0]["count"] == 5 and "testclient" not in str(recs)
    auth.clear_all_attempts()
    # brand PDFs with scripts or attachments are refused; only text is ever read
    bad = b"%PDF-1.4\n1 0 obj << /Type /Action /S /JavaScript /JS (app.alert(1)) >> endobj\n%%EOF"
    try:
        brandkit.read_pdf(bad)
        assert False, "a PDF with a script must be refused"
    except ValueError as e:
        assert "scripts" in str(e)
    # the marketing head can download a backup of every brand, without password hashes
    hc = client("Marketing head")
    r = hc.get("/api/backup")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["brands"] and data["brands"][0]["draft"] and "password_hash" not in r.text
    assert client("Creator").get("/api/backup").status_code == 403
