"""FastAPI app entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes import debate, quick, snapshot
from app.services import budget

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(
    title="stock-web backend",
    description="Wraps TradingAgents and the buffett skill into a public demo.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(snapshot.router, prefix="/api", tags=["snapshot"])
app.include_router(quick.router, prefix="/api", tags=["quick"])
app.include_router(debate.router, prefix="/api", tags=["debate"])


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "has_deepseek_key": bool(settings.deepseek_api_key),
        "deepseek_base_url": settings.deepseek_base_url,
        "has_redis": settings.has_redis,
        "cors_origins": settings.cors_origins,
        "budget": {
            "daily_cap_usd": settings.daily_budget_usd,
            "spent_today_usd": round(budget.get_today_usd(), 6),
            "remaining_usd": round(budget.remaining_usd(), 6),
        },
        "rate_limits": {
            "quick": settings.rate_limit_quick,
            "debate": settings.rate_limit_debate,
        },
    }


@app.get("/")
def root() -> dict:
    return {"name": "stock-web backend", "version": app.version, "docs": "/docs"}


log.info(
    "stock-web backend ready: deepseek_key=%s, redis=%s, cors=%s, daily_cap=$%.2f",
    "set" if settings.deepseek_api_key else "MISSING",
    "set" if settings.has_redis else "memory",
    settings.cors_origins,
    settings.daily_budget_usd,
)
