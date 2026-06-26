"""GET /api/fund — fund info, NAV history, holdings, performance."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.services.funds import Fund, get_fund

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/fund", response_model=Fund)
async def fund(code: str) -> Fund:
    if not code or not code.strip():
        raise HTTPException(status_code=400, detail="code is required")
    try:
        return await asyncio.to_thread(get_fund, code.strip())
    except Exception as e:
        log.exception("fund fetch failed for %s", code)
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e
