"""Per-IP rate limiter — simple sliding-window implementation.

Why not slowapi? slowapi's decorator runs BEFORE the request handler body, so
a 400 (e.g. bad ticker) still consumes a quota slot. For a demo where users
fat-finger ticker codes, that's a poor experience. We instead expose a
function `check_and_count(request, scope)` that the handler calls AFTER cheap
validation (snapshot pre-fetch) succeeds — only "real" requests count.

Storage:
  - Redis when settings.has_redis: per-(scope, ip) key with 1-hour TTL,
    INCR + EXPIRE NX is atomic.
  - In-memory dict (with lock) otherwise; keyed identically. Single-process only.

Limit string format: "<N>/<period>" where period is one of
  "second", "minute", "hour", "day".
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Tuple

from fastapi import HTTPException, Request

log = logging.getLogger(__name__)

_PERIOD_SECONDS = {
    "second": 1,
    "minute": 60,
    "hour":   3600,
    "day":    86400,
}


@dataclass(frozen=True)
class _ParsedLimit:
    count: int
    period_sec: int


def _parse(limit: str) -> _ParsedLimit:
    """'5/hour' -> _ParsedLimit(5, 3600)."""
    try:
        n_str, period = limit.split("/")
        n = int(n_str.strip())
        sec = _PERIOD_SECONDS[period.strip().lower()]
        if n <= 0:
            raise ValueError(f"limit count must be positive: {limit}")
        return _ParsedLimit(n, sec)
    except (ValueError, KeyError) as e:
        raise ValueError(f"bad rate-limit spec {limit!r}: expected '<N>/<period>'") from e


class _MemoryBackend:
    """Per-(scope,ip) rolling window. Tracks request timestamps and prunes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict[str, list[float]] = {}

    def hit(self, key: str, count: int, period_sec: int) -> Tuple[bool, int]:
        """Returns (allowed, remaining_in_window)."""
        now = time.monotonic()
        cutoff = now - period_sec
        with self._lock:
            entries = self._data.get(key, [])
            # prune expired
            entries = [t for t in entries if t >= cutoff]
            if len(entries) >= count:
                self._data[key] = entries
                return False, 0
            entries.append(now)
            self._data[key] = entries
            return True, count - len(entries)


class _RedisBackend:
    """Fixed-window counter. Coarser than sliding window but atomic and cheap."""

    def __init__(self, url: str) -> None:
        import redis
        self._r = redis.Redis.from_url(url, decode_responses=True)
        self._r.ping()

    def hit(self, key: str, count: int, period_sec: int) -> Tuple[bool, int]:
        # Bucket key by current period; expires automatically
        bucket = int(time.time() // period_sec)
        rkey = f"rl:{key}:{bucket}"
        pipe = self._r.pipeline()
        pipe.incr(rkey, 1)
        pipe.expire(rkey, period_sec, nx=True)
        new_count, _ = pipe.execute()
        if new_count > count:
            return False, 0
        return True, count - int(new_count)


_backend: _MemoryBackend | _RedisBackend | None = None


def _get_backend():
    global _backend
    if _backend is not None:
        return _backend
    from app.config import get_settings
    settings = get_settings()
    if settings.has_redis:
        try:
            _backend = _RedisBackend(settings.redis_url)
            log.info("rate_limit: using Redis backend")
        except Exception as e:
            log.warning("rate_limit: Redis unreachable (%s) — falling back to memory", e)
            _backend = _MemoryBackend()
    else:
        _backend = _MemoryBackend()
        log.info("rate_limit: using in-memory backend")
    return _backend


def _client_ip(request: Request) -> str:
    # Trust X-Forwarded-For when present (Railway / Vercel set it). Take the
    # leftmost entry — the originating client IP — as is convention.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client is None:
        return "unknown"
    return request.client.host


def check_and_count(request: Request, scope: str, limit: str) -> None:
    """Raise HTTP 429 when the (scope, IP) bucket is full. Otherwise count
    this request as one hit."""
    parsed = _parse(limit)
    ip = _client_ip(request)
    key = f"{scope}:{ip}"
    allowed, remaining = _get_backend().hit(key, parsed.count, parsed.period_sec)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=(
                f"rate limit exceeded for {scope}: {limit} (per IP). "
                "Try again later."
            ),
        )
    log.debug("rate_limit ok: %s ip=%s remaining=%d", scope, ip, remaining)
