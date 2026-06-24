"""GET /api/financials — curated multi-period statements for a ticker."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.services.financials import Financials, get_financials
from app.services.market_data import Market

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/financials", response_model=Financials)
async def financials(ticker: str, market: Market = "US") -> Financials:
    if not ticker or not ticker.strip():
        raise HTTPException(status_code=400, detail="ticker is required")
    try:
        return await asyncio.to_thread(get_financials, ticker.strip(), market)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("financials fetch failed for %s/%s", ticker, market)
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e
