"""Authentication: shared-password login, signed session cookie, login rate limiting.

- The password is never stored: only a salted scrypt hash in the LBC_PASSWORD_HASH
  environment variable. Generate one with:  python api/_lbc/auth.py <password>
- Sessions are an HMAC-SHA256 signed token in an HttpOnly cookie, signed with
  LBC_SESSION_SECRET, valid for 12 hours.
- The server decides who you are from the session, never from the request body.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time

COOKIE = "lbc_session"
SESSION_TTL = 12 * 3600
ROLES = {
    "Creator": "Priya (social media)",
    "Reviewer": "Arjun (brand reviewer)",
    "Marketing head": "Meera (marketing head)",
}
_N, _R, _P = 2 ** 14, 8, 1
_dev_secret = secrets.token_hex(32)  # only used when no secret is configured outside production
_attempts = {}  # ip -> [count, window_start]; used when no shared store is set (tests, scripts)
_shared = None  # (load, save, clear_all): set by the API so every server copy shares the same counts
MAX_ATTEMPTS, WINDOW = 5, 600


def use_shared(load, save, clear_all):
    """Keep sign-in attempt counts in the database, so the limit holds across all of Vercel's server copies."""
    global _shared
    _shared = (load, save, clear_all)


def _key(ip):
    return hashlib.sha256(("lbc-ip:" + (ip or "")).encode()).hexdigest()[:32]  # IP addresses are never stored


def _get(ip):
    if _shared:
        rec = _shared[0](_key(ip))
        return [int(rec.get("count", 0)), float(rec.get("start", 0))] if rec else None
    return _attempts.get(ip)


def _set(ip, value):
    if _shared:
        _shared[1](_key(ip), value)
    else:
        _attempts[ip] = value


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        algo, n, r, p, salt_hex, digest_hex = stored.split("$")
        if algo != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


def password_required():
    """Sign-in asks for the shared password only when LBC_REQUIRE_PASSWORD=1.
    It is off for the judges' demo (anyone with the link picks a role); turn it back on before real use."""
    return os.environ.get("LBC_REQUIRE_PASSWORD") == "1"


def is_production():
    return bool(os.environ.get("VERCEL")) or os.environ.get("LBC_ENV") == "production"


def secret():
    s = os.environ.get("LBC_SESSION_SECRET")
    if s:
        return s.encode()
    if is_production():
        raise RuntimeError("LBC_SESSION_SECRET is not set")
    return _dev_secret.encode()


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(data):
    payload = _b64(json.dumps(data).encode())
    sig = _b64(hmac.new(secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def _unsign(token):
    payload, sig = token.split(".")
    expected = _b64(hmac.new(secret(), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    return json.loads(_unb64(payload))


def make_token(role, now=None, user=None):
    """A demo session names a role. A personal-account session also carries the account id and its
    session version, so changing the password, the role or deactivating the account ends old sessions."""
    now = int(now or time.time())
    data = {"role": role, "name": ROLES[role], "iat": now, "exp": now + SESSION_TTL}
    if user:
        data |= {"uid": user["id"], "name": user["name"], "ver": int(user.get("session_ver") or 0)}
    return _sign(data)


def read_token(token, now=None):
    """Return the session dict, or None if missing, tampered or expired."""
    try:
        data = _unsign(token)
        if not data or data.get("role") not in ROLES or data.get("exp", 0) < (now or time.time()):
            return None
        return data
    except Exception:
        return None


def allow_attempt(ip):
    now = time.time()
    count, start = _get(ip) or [0, now]
    return now - start > WINDOW or count < MAX_ATTEMPTS


def record_failure(ip):
    now = time.time()
    count, start = _get(ip) or [0, now]
    if now - start > WINDOW:
        count, start = 0, now
    _set(ip, [count + 1, start])


def clear_failures(ip):
    if _shared:
        _set(ip, [0, time.time()])
    else:
        _attempts.pop(ip, None)


def clear_all_attempts():
    _attempts.clear()
    if _shared:
        _shared[2]()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python api/_lbc/auth.py <password>")
    print(hash_password(sys.argv[1]))
