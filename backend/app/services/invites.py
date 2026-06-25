"""Invite codes — gate registration to a small invited group."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db

# Unambiguous alphabet (no 0/O/1/I) for codes people type by hand.
_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class InviteCode(BaseModel):
    code: str
    note: str = ""
    max_uses: int = 1
    uses: int = 0
    active: bool = True
    created_at: str


def _row(r) -> InviteCode:
    return InviteCode(
        code=r["code"], note=r["note"], max_uses=r["max_uses"],
        uses=r["uses"], active=bool(r["active"]), created_at=r["created_at"],
    )


def _gen() -> str:
    return "".join(secrets.choice(_ALPHA) for _ in range(8))


def create_codes(count: int = 1, note: str = "", max_uses: int = 1) -> list[InviteCode]:
    now = datetime.now(timezone.utc).isoformat()
    out: list[InviteCode] = []
    for _ in range(max(1, min(count, 100))):
        code = _gen()
        while db.query_one("SELECT code FROM invite_codes WHERE code = ?", (code,)):
            code = _gen()
        db.execute(
            "INSERT INTO invite_codes (code, note, max_uses, uses, active, created_at) VALUES (?, ?, ?, 0, 1, ?)",
            (code, note, max(1, max_uses), now),
        )
        out.append(InviteCode(code=code, note=note, max_uses=max(1, max_uses), uses=0, active=True, created_at=now))
    return out


def list_codes() -> list[InviteCode]:
    return [_row(r) for r in db.query_all("SELECT * FROM invite_codes ORDER BY created_at DESC")]


def revoke(code: str) -> bool:
    cur = db.execute("UPDATE invite_codes SET active = 0 WHERE code = ?", (code.strip().upper(),))
    return cur.rowcount > 0


def consume(code: str) -> bool:
    """Validate and consume one use. Single worker + the db lock serialize this."""
    code = (code or "").strip().upper()
    row = db.query_one("SELECT * FROM invite_codes WHERE code = ?", (code,))
    if row is None or not row["active"] or row["uses"] >= row["max_uses"]:
        return False
    db.execute("UPDATE invite_codes SET uses = uses + 1 WHERE code = ?", (code,))
    return True
