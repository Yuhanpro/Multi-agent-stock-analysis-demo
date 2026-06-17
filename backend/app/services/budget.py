"""Daily-budget gate.

Tracks total LLM cost (USD) spent today across all users. Once the daily cap
is hit, /api/quick and /api/debate return HTTP 429. Reset boundary is UTC
midnight (key embeds YYYY-MM-DD).

Backed by Redis when REDIS_URL is set; falls back to a process-local dict for
local dev (good enough for one uvicorn process). The fallback is INTENTIONALLY
NOT shared across workers — a deployed multi-worker setup MUST use Redis.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime
from typing import Protocol

log = logging.getLogger(__name__)


class _Backend(Protocol):
    def get_today(self, key: str) -> float: ...
    def add_today(self, key: str, delta: float, ttl_sec: int) -> float: ...


class _MemoryBackend:
    """In-process fallback. Lost on restart."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict[str, float] = {}

    def get_today(self, key: str) -> float:
        with self._lock:
            return self._data.get(key, 0.0)

    def add_today(self, key: str, delta: float, ttl_sec: int) -> float:
        with self._lock:
            self._data[key] = self._data.get(key, 0.0) + delta
            return self._data[key]


class _RedisBackend:
    """Redis backend; key TTL means we never accumulate stale day-counters."""

    def __init__(self, url: str) -> None:
        import redis
        self._r = redis.Redis.from_url(url, decode_responses=True)
        # touch the connection so we surface bad URLs at startup, not on first req
        self._r.ping()

    def get_today(self, key: str) -> float:
        v = self._r.get(key)
        return float(v) if v is not None else 0.0

    def add_today(self, key: str, delta: float, ttl_sec: int) -> float:
        # INCRBYFLOAT is atomic; avoid EXPIRE NX for Redis 6.2 compatibility
        # on Alibaba Cloud Linux. Refreshing a daily key's TTL to 36h on each
        # spend is harmless.
        pipe = self._r.pipeline()
        pipe.incrbyfloat(key, delta)
        pipe.expire(key, ttl_sec)
        new_total, _ = pipe.execute()
        return float(new_total)


_backend: _Backend | None = None


def _get_backend() -> _Backend:
    """Lazy backend init so settings are read on first use, not import."""
    global _backend
    if _backend is not None:
        return _backend
    from app.config import get_settings
    settings = get_settings()
    if settings.has_redis:
        try:
            _backend = _RedisBackend(settings.redis_url)
            log.info("budget: using Redis backend at %s", settings.redis_url)
        except Exception as e:
            log.warning("budget: Redis unreachable (%s) — falling back to in-memory", e)
            _backend = _MemoryBackend()
    else:
        _backend = _MemoryBackend()
        log.info("budget: using in-memory backend (no REDIS_URL set)")
    return _backend


def _today_key() -> str:
    # UTC date avoids timezone weirdness across deployments
    return f"budget:{datetime.utcnow():%Y-%m-%d}"


def get_today_usd() -> float:
    return _get_backend().get_today(_today_key())


def add_cost(amount_usd: float) -> float:
    """Record spend. Returns new daily total. TTL = 36h (covers a UTC day + slack)."""
    if amount_usd <= 0:
        return get_today_usd()
    return _get_backend().add_today(_today_key(), float(amount_usd), ttl_sec=36 * 3600)


def assert_within_budget() -> None:
    """Raise HTTPException(429) when today's cap is hit. Call BEFORE starting
    work that could spend money."""
    from fastapi import HTTPException
    from app.config import get_settings

    cap = get_settings().daily_budget_usd
    today = get_today_usd()
    if today >= cap:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Daily LLM budget exhausted (${today:.2f} / ${cap:.2f}). "
                "Try again after UTC midnight."
            ),
        )


def remaining_usd() -> float:
    from app.config import get_settings
    return max(0.0, get_settings().daily_budget_usd - get_today_usd())
