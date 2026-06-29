"""FastAPI app entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes import (
    admin,
    alerts,
    auth,
    chat,
    debate,
    feedback,
    financials,
    funds,
    market_overview,
    paper,
    quick,
    reports,
    snapshot,
    symbol_search,
    track,
    watchlist,
)
from app.services import budget, db

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
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

db.init_db()

# Preload the fund-search corpus in the background. Building it pulls ~27k rows
# (~8s) the first time; warming at boot means no user search ever hits that cold
# stall, even right after a deploy restart.
import threading as _threading  # noqa: E402

from app.services.funds import warm_caches as _warm_funds  # noqa: E402

_threading.Thread(target=_warm_funds, daemon=True).start()

# Background price-alert engine (polls A-share spot during CN trading hours).
from app.services import alert_scheduler as _alert_scheduler  # noqa: E402

_alert_scheduler.start()

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(snapshot.router, prefix="/api", tags=["snapshot"])
app.include_router(financials.router, prefix="/api", tags=["financials"])
app.include_router(funds.router, prefix="/api", tags=["funds"])
app.include_router(market_overview.router, prefix="/api", tags=["market-overview"])
app.include_router(quick.router, prefix="/api", tags=["quick"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(feedback.router, prefix="/api", tags=["feedback"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(paper.router, prefix="/api", tags=["paper"])
app.include_router(debate.router, prefix="/api", tags=["debate"])
app.include_router(watchlist.router, prefix="/api", tags=["watchlist"])
app.include_router(reports.router, prefix="/api", tags=["reports"])
app.include_router(symbol_search.router, prefix="/api", tags=["symbol-search"])
app.include_router(track.router, prefix="/api", tags=["track"])
app.include_router(admin.router, prefix="/api", tags=["admin"])


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
