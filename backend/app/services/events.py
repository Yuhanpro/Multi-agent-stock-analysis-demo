"""Lightweight page-view tracking + admin analytics aggregations."""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db


class PathHit(BaseModel):
    path: str
    count: int


class DailyPoint(BaseModel):
    date: str
    views: int
    visitors: int


class Stats(BaseModel):
    total_views: int = 0
    today_views: int = 0
    total_visitors: int = 0
    today_visitors: int = 0
    total_users: int = 0
    top_paths: list[PathHit] = []
    daily: list[DailyPoint] = []


class SessionPath(BaseModel):
    anon_id: str
    last_seen: str
    user_email: str | None = None
    paths: list[str] = []


def log_event(anon_id: str, path: str, user_id: int | None = None) -> None:
    if not anon_id or not path:
        return
    db.execute(
        "INSERT INTO events (anon_id, user_id, path, created_at) VALUES (?, ?, ?, ?)",
        (str(anon_id)[:64], user_id, str(path)[:200], datetime.now(timezone.utc).isoformat()),
    )


def _scalar(sql: str, params: tuple = ()) -> int:
    row = db.query_one(sql, params)
    if not row:
        return 0
    return int(list(row)[0] or 0)


def get_stats() -> Stats:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s = Stats(
        total_views=_scalar("SELECT COUNT(*) FROM events"),
        today_views=_scalar("SELECT COUNT(*) FROM events WHERE substr(created_at,1,10)=?", (today,)),
        total_visitors=_scalar("SELECT COUNT(DISTINCT anon_id) FROM events"),
        today_visitors=_scalar("SELECT COUNT(DISTINCT anon_id) FROM events WHERE substr(created_at,1,10)=?", (today,)),
        total_users=_scalar("SELECT COUNT(*) FROM users"),
    )
    s.top_paths = [
        PathHit(path=r["path"], count=r["c"])
        for r in db.query_all("SELECT path, COUNT(*) AS c FROM events GROUP BY path ORDER BY c DESC LIMIT 12")
    ]
    s.daily = [
        DailyPoint(date=r["d"], views=r["v"], visitors=r["u"])
        for r in db.query_all(
            "SELECT substr(created_at,1,10) AS d, COUNT(*) AS v, COUNT(DISTINCT anon_id) AS u "
            "FROM events GROUP BY d ORDER BY d DESC LIMIT 14"
        )
    ]
    return s


def recent_paths(sessions: int = 25, per: int = 25) -> list[SessionPath]:
    rows = db.query_all(
        "SELECT anon_id, MAX(created_at) AS last_seen FROM events GROUP BY anon_id "
        "ORDER BY last_seen DESC LIMIT ?",
        (sessions,),
    )
    out: list[SessionPath] = []
    for r in rows:
        anon = r["anon_id"]
        ev = db.query_all(
            "SELECT path, user_id FROM events WHERE anon_id = ? ORDER BY created_at ASC LIMIT ?",
            (anon, per),
        )
        email = None
        uid = next((e["user_id"] for e in ev if e["user_id"]), None)
        if uid:
            u = db.query_one("SELECT email FROM users WHERE id = ?", (uid,))
            email = u["email"] if u else None
        out.append(SessionPath(
            anon_id=anon[:8],
            last_seen=r["last_seen"],
            user_email=email,
            paths=[e["path"] for e in ev],
        ))
    return out
