"""GET /api/market-overview — today's hot industries / companies / on-site top."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.services.market_data import Market
from app.services.market_overview import MarketOverview, get_overview

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/market-overview", response_model=MarketOverview)
async def market_overview(market: Market = "CN") -> MarketOverview:
    try:
        return await asyncio.to_thread(get_overview, market)
    except Exception as e:
        log.exception("market overview failed")
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e
