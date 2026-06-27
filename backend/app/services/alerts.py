"""Price alerts: per-user rules + the data the scheduler needs to fire them."""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db


class Alert(BaseModel):
    id: int
    ticker: str
    market: str
    up_pct: float | None = None
    down_pct: float | None = None
    target_above: float | None = None
    target_below: float | None = None
    enabled: bool = True
    note: str = ""
    last_fired_at: str | None = None


def _row(r) -> Alert:
    return Alert(
        id=r["id"], ticker=r["ticker"], market=r["market"],
        up_pct=r["up_pct"], down_pct=r["down_pct"],
        target_above=r["target_above"], target_below=r["target_below"],
        enabled=bool(r["enabled"]), note=r["note"], last_fired_at=r["last_fired_at"],
    )


def list_alerts(user_id: int) -> list[Alert]:
    rows = db.query_all(
        "SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
    )
    return [_row(r) for r in rows]


def upsert_alert(user_id: int, ticker: str, market: str, *, up_pct, down_pct,
                 target_above, target_below, enabled: bool = True, note: str = "") -> Alert:
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO alerts (user_id, ticker, market, up_pct, down_pct, target_above,
               target_below, enabled, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, ticker, market) DO UPDATE SET
               up_pct=excluded.up_pct, down_pct=excluded.down_pct,
               target_above=excluded.target_above, target_below=excluded.target_below,
               enabled=excluded.enabled, note=excluded.note""",
        (user_id, ticker, market, up_pct, down_pct, target_above, target_below,
         1 if enabled else 0, note, now),
    )
    r = db.query_one(
        "SELECT * FROM alerts WHERE user_id = ? AND ticker = ? AND market = ?",
        (user_id, ticker, market),
    )
    return _row(r)


def delete_alert(user_id: int, ticker: str, market: str) -> bool:
    cur = db.execute(
        "DELETE FROM alerts WHERE user_id = ? AND ticker = ? AND market = ?",
        (user_id, ticker, market),
    )
    return cur.rowcount > 0


def mark_fired(alert_id: int) -> None:
    db.execute("UPDATE alerts SET last_fired_at = ? WHERE id = ?",
               (datetime.now(timezone.utc).isoformat(), alert_id))


# ---- push channel (stored on the users row) --------------------------------

def get_push(user_id: int) -> tuple[str | None, str | None]:
    r = db.query_one("SELECT push_provider, push_key FROM users WHERE id = ?", (user_id,))
    return (r["push_provider"], r["push_key"]) if r else (None, None)


def set_push(user_id: int, provider: str | None, key: str | None) -> None:
    db.execute("UPDATE users SET push_provider = ?, push_key = ? WHERE id = ?",
               (provider, key, user_id))


def active_alerts_with_push() -> list[dict]:
    """Enabled alerts joined with the owner's push channel — for the scheduler."""
    rows = db.query_all(
        """SELECT a.*, u.push_provider, u.push_key, u.email
           FROM alerts a JOIN users u ON u.id = a.user_id
           WHERE a.enabled = 1 AND u.push_provider IS NOT NULL AND u.push_key IS NOT NULL"""
    )
    return [dict(r) for r in rows]
