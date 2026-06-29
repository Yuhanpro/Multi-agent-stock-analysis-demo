"""Lightweight page-view tracking + admin analytics aggregations."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.services import db


class PathHit(BaseModel):
    path: str
    count: int


class DailyPoint(BaseModel):
    date: str
    views: int = 0
    visitors: int = 0
    runs: int = 0
    signups: int = 0
    cost: float = 0.0


class ModeCount(BaseModel):
    mode: str
    count: int


class TickerHit(BaseModel):
    ticker: str
    market: str
    count: int


class SignupPoint(BaseModel):
    date: str
    count: int


class HourPoint(BaseModel):
    hour: int
    count: int


class UserActivity(BaseModel):
    email: str
    runs: int
    last_seen: str | None = None


class Stats(BaseModel):
    total_views: int = 0
    today_views: int = 0
    total_visitors: int = 0
    today_visitors: int = 0
    total_users: int = 0
    top_paths: list[PathHit] = []
    daily: list[DailyPoint] = []
    # usage
    runs_total: int = 0
    cost_total: float = 0.0
    runs_by_mode: list[ModeCount] = []
    top_tickers: list[TickerHit] = []
    clicks_by_mode: list[ModeCount] = []
    # invite funnel
    invites_total: int = 0
    invites_used: int = 0
    invites_active: int = 0
    # audience
    new_today: int = 0
    returning_today: int = 0
    signups_daily: list[SignupPoint] = []
    hourly: list[HourPoint] = []
    top_users: list[UserActivity] = []


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
        total_users=_scalar("SELECT COUNT(*) FROM users WHERE email NOT LIKE 'anon:%'"),
    )
    s.top_paths = [
        PathHit(path=r["path"], count=r["c"])
        for r in db.query_all("SELECT path, COUNT(*) AS c FROM events GROUP BY path ORDER BY c DESC LIMIT 12")
    ]
    # 30-day daily series with every metric (events + reports + users), zero-filled
    # so the chart/period table have a continuous history, newest first.
    now = datetime.now(timezone.utc)
    day_list = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(30)]
    ev = {r["d"]: (r["v"], r["u"]) for r in db.query_all(
        "SELECT substr(created_at,1,10) AS d, COUNT(*) AS v, COUNT(DISTINCT anon_id) AS u FROM events GROUP BY d")}
    rp = {r["d"]: (r["c"], r["cost"]) for r in db.query_all(
        "SELECT substr(created_at,1,10) AS d, COUNT(*) AS c, COALESCE(SUM(cost_usd),0) AS cost FROM reports GROUP BY d")}
    su = {r["d"]: r["c"] for r in db.query_all(
        "SELECT substr(created_at,1,10) AS d, COUNT(*) AS c FROM users WHERE email NOT LIKE 'anon:%' GROUP BY d")}
    s.daily = [
        DailyPoint(
            date=d,
            views=ev.get(d, (0, 0))[0], visitors=ev.get(d, (0, 0))[1],
            runs=rp.get(d, (0, 0))[0], cost=round(float(rp.get(d, (0, 0))[1] or 0), 4),
            signups=su.get(d, 0),
        )
        for d in day_list
    ]
    # Usage from saved reports (analysis runs + LLM spend).
    s.runs_total = _scalar("SELECT COUNT(*) FROM reports")
    cost_row = db.query_one("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM reports")
    s.cost_total = round(float(cost_row["c"] or 0), 4) if cost_row else 0.0
    s.runs_by_mode = [
        ModeCount(mode=r["mode"], count=r["c"])
        for r in db.query_all("SELECT mode, COUNT(*) AS c FROM reports GROUP BY mode ORDER BY c DESC")
    ]
    s.top_tickers = [
        TickerHit(ticker=r["ticker"], market=r["market"], count=r["c"])
        for r in db.query_all(
            "SELECT ticker, market, COUNT(*) AS c FROM reports GROUP BY ticker, market ORDER BY c DESC LIMIT 10"
        )
    ]
    # Analysis-trigger clicks (events logged as run:<mode>, incl. snapshot;
    # counts every click regardless of login, unlike saved-report runs).
    s.clicks_by_mode = [
        ModeCount(mode=r["m"], count=r["c"])
        for r in db.query_all(
            "SELECT replace(path, 'run:', '') AS m, COUNT(*) AS c FROM events "
            "WHERE path LIKE 'run:%' GROUP BY path ORDER BY c DESC"
        )
    ]

    # Invite funnel.
    s.invites_total = _scalar("SELECT COUNT(*) FROM invite_codes")
    s.invites_used = _scalar("SELECT COALESCE(SUM(uses), 0) FROM invite_codes")
    s.invites_active = _scalar("SELECT COUNT(*) FROM invite_codes WHERE active = 1 AND uses < max_uses")

    # Audience: new vs returning (by first-seen date), signups, hour-of-day (CN
    # time, UTC+8), and per-user activity.
    s.new_today = _scalar(
        "SELECT COUNT(*) FROM (SELECT anon_id, MIN(created_at) AS m FROM events GROUP BY anon_id) "
        "WHERE substr(m,1,10) = ?", (today,),
    )
    s.returning_today = max(0, s.today_visitors - s.new_today)
    s.signups_daily = [
        SignupPoint(date=r["d"], count=r["c"])
        for r in db.query_all("SELECT substr(created_at,1,10) AS d, COUNT(*) AS c FROM users WHERE email NOT LIKE 'anon:%' GROUP BY d ORDER BY d DESC LIMIT 14")
    ]
    hours = {int(r["h"]): r["c"] for r in db.query_all(
        "SELECT (CAST(substr(created_at,12,2) AS INTEGER)+8)%24 AS h, COUNT(*) AS c FROM events GROUP BY h"
    )}
    s.hourly = [HourPoint(hour=h, count=hours.get(h, 0)) for h in range(24)]
    s.top_users = [
        UserActivity(email=r["email"], runs=r["runs"], last_seen=r["last"])
        for r in db.query_all(
            "SELECT u.email, "
            "(SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) AS runs, "
            "(SELECT MAX(created_at) FROM events e WHERE e.user_id = u.id) AS last "
            "FROM users u WHERE u.email NOT LIKE 'anon:%' ORDER BY runs DESC, u.id LIMIT 10"
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
