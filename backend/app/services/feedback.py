"""User suggestions / feature requests — left by anyone, read by admins."""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db


class Feedback(BaseModel):
    id: int
    category: str = "suggestion"
    content: str
    contact: str | None = None
    email: str | None = None       # signed-in user's email, if any
    user_id: int | None = None
    path: str | None = None
    created_at: str


def _row(r) -> Feedback:
    return Feedback(
        id=r["id"], category=r["category"], content=r["content"],
        contact=r["contact"], email=r["email"], user_id=r["user_id"],
        path=r["path"], created_at=r["created_at"],
    )


def create_feedback(
    *,
    content: str,
    category: str = "suggestion",
    contact: str | None = None,
    email: str | None = None,
    user_id: int | None = None,
    anon_id: str | None = None,
    path: str | None = None,
) -> Feedback:
    now = datetime.now(timezone.utc).isoformat()
    cur = db.execute(
        "INSERT INTO feedback (anon_id, user_id, email, contact, category, content, path, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (anon_id, user_id, email, contact, category, content.strip(), path, now),
    )
    return Feedback(
        id=int(cur.lastrowid), category=category, content=content.strip(),
        contact=contact, email=email, user_id=user_id, path=path, created_at=now,
    )


def list_feedback(limit: int = 300) -> list[Feedback]:
    rows = db.query_all(
        "SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?", (max(1, min(limit, 1000)),)
    )
    return [_row(r) for r in rows]


def count() -> int:
    r = db.query_one("SELECT COUNT(*) AS n FROM feedback")
    return int(r["n"]) if r else 0
