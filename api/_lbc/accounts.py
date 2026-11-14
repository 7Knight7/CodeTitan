"""Personal accounts and invitations, built in (no paid service).

- Each person has their own account: email, name, role, and a password stored only as a salted
  scrypt hash (see auth.hash_password).
- New people join through a one-time invitation link that the marketing head creates and sends
  (WhatsApp, email). Only a SHA-256 hash of the link's token is stored; links expire after 7 days.
- Wrong passwords: after 3 in a row the account is locked for 15 minutes; after 2 more it is
  blocked until a marketing head unblocks it on the Team page. The counter lives on the account in
  the database, so it applies across every server instance. A correct password resets it.
- If the only marketing head is blocked, unblock from the server:
      python api/_lbc/accounts.py unblock <email>
"""
import hashlib
import os
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone

INVITE_DAYS = 7
LOCK_AFTER, LOCK_MINUTES = 3, 15  # wrong passwords before the 15-minute timer
BLOCK_AFTER = 5                    # wrong passwords in total before the account is blocked
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")
COMMON = {"password", "password1", "password123", "12345678", "123456789", "1234567890", "qwertyuiop", "iloveyou",
          "admin123", "welcome1", "letmein123", "brandcheck", "livebrandcheck"}


# Demo accounts for the judges (on in accounts mode unless LBC_DEMO_ACCOUNTS=0). Their passwords are shown on the sign-in
# page on purpose, so they are not secrets. They get the 15-minute pause but are never blocked, and their
# password, role and access can't be changed, so one visitor can't lock the others out.
DEMO_ACCOUNTS = [
    {"name": "Meera (marketing head)", "email": "meera@xyz.com", "password": "Meera@_1", "role": "Marketing head"},
    {"name": "Priya (social media)", "email": "priya@xyz.com", "password": "Priya@_1", "role": "Creator"},
    {"name": "Arjun (brand reviewer)", "email": "arjun@xyz.com", "password": "Arjun@_1", "role": "Reviewer"},
]


def demo_enabled():
    """On by default in accounts mode, for the judges. Set LBC_DEMO_ACCOUNTS=0 for real use."""
    return mode() == "accounts" and os.environ.get("LBC_DEMO_ACCOUNTS") != "0"


def ensure_demo_accounts(store, hash_password):
    """Create the demo accounts if they are missing (never overwrites an existing account)."""
    if not demo_enabled():
        return
    for a in DEMO_ACCOUNTS:
        uid = user_id(a["email"])
        if not store.get("user", uid):
            store.put("user", {"id": uid, "name": a["name"], "email": a["email"], "role": a["role"], "demo": True,
                               "password_hash": hash_password(a["password"]), "active": True, "session_ver": 0,
                               "created_at": iso(now_dt()), "created_by": "demo accounts", "failed": 0,
                               "locked_until": None, "last_login": None})
    # Priya's posts are reviewed by Arjun (set once; the marketing head can change it on Team)
    priya, arjun = store.get("user", user_id("priya@xyz.com")), store.get("user", user_id("arjun@xyz.com"))
    if priya and arjun and "reviewer_ids" not in priya:
        store.put("user", priya | {"reviewer_ids": [arjun["id"]]})


def demo_credentials():
    return [{k: a[k] for k in ("name", "email", "password", "role")} for a in DEMO_ACCOUNTS] if demo_enabled() else []


def mode():
    """demo: pick a role, no password (judges' demo) | password: one shared password | accounts: personal accounts."""
    if os.environ.get("LBC_AUTH_MODE") == "accounts":
        return "accounts"
    return "password" if os.environ.get("LBC_REQUIRE_PASSWORD") == "1" else "demo"


def now_dt():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat(timespec="seconds")


def norm_email(email):
    return (email or "").strip().lower()


def valid_email(email):
    return bool(EMAIL_RE.match(norm_email(email)))


def password_problem(password, email="", name=""):
    """A plain-language reason the password is too weak, or None."""
    p = password or ""
    if len(p) < 10:
        return "Use at least 10 characters."
    if len(p) > 128:
        return "Use at most 128 characters."
    low = p.lower()
    if low in COMMON or len(set(p)) < 4:
        return "This password is too easy to guess. Try a short sentence."
    local = norm_email(email).split("@")[0]
    if (local and len(local) >= 4 and local in low) or (name and len(name.strip()) >= 4 and name.strip().lower() in low):
        return "Don't use your name or email in the password."
    return None


def user_id(email):
    """One account per email address; the id is derived from the email."""
    return "u" + hashlib.sha256(norm_email(email).encode()).hexdigest()[:16]


def public(user):
    """What other screens may see about an account (never the password hash)."""
    return {k: user.get(k) for k in ("id", "name", "email", "role", "active", "created_at", "last_login")} | \
        {"locked_until": user.get("locked_until") if is_locked(user) else None, "blocked": bool(user.get("blocked")),
         "failed": int(user.get("failed") or 0), "demo": bool(user.get("demo"))}


# ---------- invitations ----------

def token_hash(token):
    return hashlib.sha256((token or "").encode()).hexdigest()


def new_invite(name, email, role, by):
    token = secrets.token_urlsafe(32)
    inv = {"id": secrets.token_hex(6), "token_hash": token_hash(token), "name": name.strip(), "email": norm_email(email),
           "role": role, "by": by, "created_at": iso(now_dt()), "expires_at": iso(now_dt() + timedelta(days=INVITE_DAYS)),
           "used_at": None, "revoked": False}
    return inv, token


def invite_usable(inv):
    return bool(inv) and not inv.get("revoked") and not inv.get("used_at") and inv["expires_at"] > iso(now_dt())


# ---------- wrong passwords: 3 = 15-minute timer, 5 = blocked ----------

def is_locked(user):
    until = user.get("locked_until")
    return bool(until) and until > iso(now_dt())


def lock_message(user):
    if user.get("blocked"):
        return "This account is blocked after too many wrong passwords. Ask your marketing head to unblock it."
    if is_locked(user):
        mins = max(1, int((datetime.fromisoformat(user["locked_until"]) - now_dt()).total_seconds() // 60) + 1)
        if user.get("demo"):
            return f"Too many wrong passwords. Try again in {mins} minute{'s' if mins != 1 else ''}."
        left = BLOCK_AFTER - int(user.get("failed") or 0)
        return (f"Too many wrong passwords. Try again in {mins} minute{'s' if mins != 1 else ''}. "
                f"After {left} more wrong attempt{'s' if left != 1 else ''} the account will be blocked.")
    return None


def record_fail(user):
    """Count a wrong password. Returns the message to show (lock, block, or how many tries are left)."""
    user["failed"] = int(user.get("failed") or 0) + 1
    n = user["failed"]
    if user.get("demo") and n >= LOCK_AFTER:  # demo accounts: pause, never block
        user.update(locked_until=iso(now_dt() + timedelta(minutes=LOCK_MINUTES)), failed=0)
        return lock_message(user)
    if n >= BLOCK_AFTER:
        user.update(blocked=True, blocked_at=iso(now_dt()), locked_until=None)
        return lock_message(user)
    if n == LOCK_AFTER:
        user["locked_until"] = iso(now_dt() + timedelta(minutes=LOCK_MINUTES))
        return lock_message(user)
    if n < LOCK_AFTER:
        left = LOCK_AFTER - n
        return f"Wrong email or password. {left} more wrong attempt{'s' if left != 1 else ''} and sign-in is paused for {LOCK_MINUTES} minutes."
    left = BLOCK_AFTER - n
    return f"Wrong email or password. {left} more wrong attempt{'s' if left != 1 else ''} and the account will be blocked."


def record_success(user):
    user.update(failed=0, locked_until=None, last_login=iso(now_dt()))
    return user


def unblock(user):
    user.update(blocked=False, blocked_at=None, failed=0, locked_until=None)
    return user


if __name__ == "__main__":
    # Emergency unblock from the server, for when no marketing head can sign in.
    if len(sys.argv) != 3 or sys.argv[1] != "unblock":
        sys.exit("Usage: python api/_lbc/accounts.py unblock <email>")
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from _lbc.store import get_store
    u = get_store().get("user", user_id(sys.argv[2]))
    if not u:
        sys.exit("No account with that email.")
    get_store().put("user", unblock(u))
    print(f"Unblocked {u['name']} ({u['email']}).")
