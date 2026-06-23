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
    created_at    TEXT NOT NULL
);

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
        _conn.executescript(SCHEMA)
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
