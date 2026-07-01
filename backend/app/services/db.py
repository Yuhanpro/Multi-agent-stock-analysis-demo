"""SQLite store for users, saved reports, and the per-user watchlist.

Stdlib `sqlite3` only — no new dependency, so deploys stay rsync + restart
(the Aliyun box struggles with `uv sync`). A single uvicorn worker plus a
module-level reentrant lock keeps access safe; WAL mode keeps reads from
blocking the occasional write. All callers go through the small helpers below.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from app.config import get_settings

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invite_codes (
    code       TEXT PRIMARY KEY,
    note       TEXT NOT NULL DEFAULT '',
    max_uses   INTEGER NOT NULL DEFAULT 1,
    uses       INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    anon_id    TEXT NOT NULL,
    user_id    INTEGER,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_anon ON events(anon_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    ticker     TEXT NOT NULL,
    market     TEXT NOT NULL,
    mode       TEXT NOT NULL,
    language   TEXT NOT NULL,
    title      TEXT NOT NULL,
    decision   TEXT,
    content    TEXT NOT NULL,
    cost_usd   REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    is_public  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS watchlist (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ticker  TEXT NOT NULL,
    market  TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    modes   TEXT NOT NULL DEFAULT '["snapshot","quick"]',
    note    TEXT NOT NULL DEFAULT '',
    UNIQUE (user_id, ticker, market),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    anon_id    TEXT,
    user_id    INTEGER,
    email      TEXT,
    contact    TEXT,
    category   TEXT NOT NULL DEFAULT 'suggestion',
    content    TEXT NOT NULL,
    path       TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    ticker         TEXT NOT NULL,
    market         TEXT NOT NULL,
    up_pct         REAL,            -- fire when intraday change >= +up_pct (%)
    down_pct       REAL,            -- fire when intraday change <= -down_pct (%)
    target_above   REAL,            -- fire when price >= target_above
    target_below   REAL,            -- fire when price <= target_below
    enabled        INTEGER NOT NULL DEFAULT 1,
    last_fired_at  TEXT,            -- cooldown bookkeeping
    note           TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    UNIQUE (user_id, ticker, market),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON alerts(enabled);

CREATE TABLE IF NOT EXISTS paper_account (
    user_id    INTEGER PRIMARY KEY,
    cash       REAL NOT NULL,
    start_cash REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_trades (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ticker  TEXT NOT NULL,
    market  TEXT NOT NULL,
    side    TEXT NOT NULL,          -- 'buy' / 'sell'
    shares  REAL NOT NULL,
    price   REAL NOT NULL,
    ts      TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paper_trades_user ON paper_trades(user_id, ts);

-- Every analysis run (anonymous + signed-in), for accurate all-user usage/cost.
CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    anon_id    TEXT,
    user_id    INTEGER,
    mode       TEXT NOT NULL,
    ticker     TEXT,
    market     TEXT,
    cost_usd   REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);

-- Admin-editable key/value settings (rate limits, etc.).
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    path = Path(get_settings().db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create tables if missing. Called once at app startup."""
    global _conn
    with _lock:
        if _conn is None:
            _conn = _connect()
        had_runs = _conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='runs'"
        ).fetchone() is not None
        _conn.executescript(SCHEMA)
        # One-time backfill: seed the new runs table from historical reports so
        # existing signed-in runs/costs aren't lost when we switch metrics over.
        if not had_runs:
            _conn.execute(
                "INSERT INTO runs (user_id, mode, ticker, market, cost_usd, created_at) "
                "SELECT user_id, mode, ticker, market, cost_usd, created_at FROM reports"
            )
        # Lightweight migration: add columns introduced after first deploy.
        cols = {r["name"] for r in _conn.execute("PRAGMA table_info(reports)").fetchall()}
        if "is_public" not in cols:
            _conn.execute("ALTER TABLE reports ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        ucols = {r["name"] for r in _conn.execute("PRAGMA table_info(users)").fetchall()}
        if "is_admin" not in ucols:
            _conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        if "push_provider" not in ucols:
            _conn.execute("ALTER TABLE users ADD COLUMN push_provider TEXT")
        if "push_key" not in ucols:
            _conn.execute("ALTER TABLE users ADD COLUMN push_key TEXT")
        _conn.commit()


def _get() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            init_db()
        assert _conn is not None
        return _conn


def execute(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    with _lock:
        conn = _get()
        cur = conn.execute(sql, params)
        conn.commit()
        return cur


def query_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    with _lock:
        return _get().execute(sql, params).fetchone()


def query_all(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        return _get().execute(sql, params).fetchall()
