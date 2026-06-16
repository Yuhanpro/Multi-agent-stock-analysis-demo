"""GET /api/snapshot — non-streaming OHLCV + fundamentals.

Used by the frontend as visual context alongside Quick / Debate analysis.
No LLM cost.
"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.services.market_data import Snapshot, get_snapshot

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/snapshot", response_model=Snapshot)
def snapshot(
    ticker: str = Query(..., min_length=1, max_length=16, description="e.g. AAPL or 600519"),
    market: Literal["US", "CN"] = Query("US"),
) -> Snapshot:
    try:
        return get_snapshot(ticker, market)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("snapshot failed for %s/%s", ticker, market)
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e
