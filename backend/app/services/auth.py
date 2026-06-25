"""Email + password auth, stdlib only.

No new dependency (the VPS dislikes `uv sync`): passwords use PBKDF2-HMAC-SHA256,
sessions use an HMAC-signed token (the HS256 half of a JWT, minus the unused alg
negotiation — verification is hard-pinned so there is no `alg:none` foot-gun).

Tokens travel as `Authorization: Bearer <token>`. Over Stage A's plain HTTP they
are sniffable on the wire — acceptable for a demo, surfaced to users in the UI.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from pydantic import BaseModel

from app.config import get_settings
from app.services import db

_PBKDF2_ITERATIONS = 200_000
_TOKEN_TTL_SECONDS = 30 * 24 * 3600  # 30 days
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class User(BaseModel):
    id: int
    email: str
    created_at: str
    is_admin: bool = False


# ---------- password hashing ------------------------------------------------


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


# ---------- signed tokens ---------------------------------------------------


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def make_token(user_id: int, email: str) -> str:
    payload = {"uid": user_id, "email": email, "iat": _now(), "exp": _now() + _TOKEN_TTL_SECONDS}
    body = _b64u(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(get_settings().jwt_secret.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64u(sig)}"


def verify_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".")
        expected = hmac.new(get_settings().jwt_secret.encode(), body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64u(expected), sig):
            return None
        payload = json.loads(_b64u_decode(body))
        if int(payload.get("exp", 0)) < _now():
            return None
        return payload
    except (ValueError, AttributeError, json.JSONDecodeError):
        return None


# ---------- user table ------------------------------------------------------


def _row_to_user(row) -> User:
    is_admin = bool(row["is_admin"]) or (str(row["email"]).lower() in get_settings().admin_emails)
    return User(id=row["id"], email=row["email"], created_at=row["created_at"], is_admin=is_admin)


def user_count() -> int:
    row = db.query_one("SELECT COUNT(*) AS c FROM users")
    return int(row["c"]) if row else 0


def normalize_email(email: str) -> str:
    return email.strip().lower()


def create_user(email: str, password: str, is_admin: bool = False) -> User:
    email = normalize_email(email)
    if not _EMAIL_RE.match(email):
        raise ValueError("邮箱格式不正确")
    if len(password) < 8:
        raise ValueError("密码至少 8 位")
    if db.query_one("SELECT id FROM users WHERE email = ?", (email,)) is not None:
        raise ValueError("该邮箱已注册")
    cur = db.execute(
        "INSERT INTO users (email, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?)",
        (email, hash_password(password), datetime.now(timezone.utc).isoformat(), 1 if is_admin else 0),
    )
    row = db.query_one("SELECT * FROM users WHERE id = ?", (cur.lastrowid,))
    return _row_to_user(row)


def authenticate(email: str, password: str) -> User | None:
    row = db.query_one("SELECT * FROM users WHERE email = ?", (normalize_email(email),))
    if row is None or not verify_password(password, row["password_hash"]):
        return None
    return _row_to_user(row)


def get_user_by_id(user_id: int) -> User | None:
    row = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    return _row_to_user(row) if row else None


# ---------- FastAPI dependencies / request helpers --------------------------


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def user_from_request(request: Request) -> User | None:
    """Optional user — None when no/invalid token. Safe for public endpoints."""
    token = _bearer(request)
    if not token:
        return None
    payload = verify_token(token)
    if not payload:
        return None
    return get_user_by_id(int(payload["uid"]))


def get_optional_user(request: Request) -> User | None:
    return user_from_request(request)


def get_current_user(request: Request) -> User:
    user = user_from_request(request)
    if user is None:
        raise HTTPException(status_code=401, detail="需要登录")
    return user


def get_current_admin(request: Request) -> User:
    user = get_current_user(request)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user
