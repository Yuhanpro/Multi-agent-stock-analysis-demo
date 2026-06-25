"""Configuration loaded from environment variables.

Read once at startup; treat as immutable.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend/ if present (no-op when running on Railway with real env)
load_dotenv()

# backend/data — shared by the SQLite DB, the (legacy) watchlist JSON, and the
# persisted JWT secret.
DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# The Aliyun light server used for Stage A has OpenClaw's proxy variables in
# /etc/profile.d/proxy.sh (HTTP_PROXY=http://127.0.0.1:7890,
# ALL_PROXY=socks5h://127.0.0.1:1080). That proxy returns HTTP 503 and also
# makes httpx require socksio. The public demo should never inherit those
# machine-level proxies, so clear them as early as possible on import.
for _proxy_key in (
    "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
    "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
):
    os.environ.pop(_proxy_key, None)


def _split_csv(raw: str | None, default: list[str]) -> list[str]:
    if not raw:
        return default
    return [s.strip() for s in raw.split(",") if s.strip()]


def _resolve_jwt_secret() -> str:
    """JWT signing secret. Prefer env; otherwise persist a generated one to
    data/.jwt_secret so tokens survive restarts (a fresh random per boot would
    invalidate every session on every deploy)."""
    env = os.getenv("JWT_SECRET")
    if env:
        return env
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    secret_file = DATA_DIR / ".jwt_secret"
    if secret_file.exists():
        val = secret_file.read_text(encoding="utf-8").strip()
        if val:
            return val
    val = secrets.token_hex(32)
    secret_file.write_text(val, encoding="utf-8")
    try:
        secret_file.chmod(0o600)
    except OSError:
        pass
    return val


@dataclass(frozen=True)
class Settings:
    deepseek_api_key: str
    deepseek_base_url: str
    daily_budget_usd: float
    rate_limit_quick: str
    rate_limit_debate: str
    redis_url: str
    cors_origins: list[str]
    deep_think_llm: str
    quick_think_llm: str
    db_path: str
    jwt_secret: str
    admin_emails: list[str]

    @property
    def has_redis(self) -> bool:
        # Locally we may not run Redis; the budget gate degrades to "always allow"
        # and slowapi falls back to in-memory storage. See app.services.budget.
        return bool(self.redis_url) and self.redis_url != "memory"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        deepseek_api_key=os.getenv("DEEPSEEK_API_KEY", ""),
        deepseek_base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        daily_budget_usd=float(os.getenv("DAILY_BUDGET_USD", "10")),
        rate_limit_quick=os.getenv("RATE_LIMIT_QUICK", "5/hour"),
        rate_limit_debate=os.getenv("RATE_LIMIT_DEBATE", "1/hour"),
        redis_url=os.getenv("REDIS_URL", "memory"),
        cors_origins=_split_csv(
            os.getenv("CORS_ORIGINS"),
            default=["http://localhost:3000"],
        ),
        deep_think_llm=os.getenv("DEEP_THINK_LLM", "deepseek-v4-pro"),
        quick_think_llm=os.getenv("QUICK_THINK_LLM", "deepseek-v4-flash"),
        db_path=os.getenv("DB_PATH", str(DATA_DIR / "stock-web.db")),
        jwt_secret=_resolve_jwt_secret(),
        admin_emails=[e.strip().lower() for e in _split_csv(os.getenv("ADMIN_EMAILS"), []) if e.strip()],
    )
