"""GET /api/hotspot — A股 热点雷达(涨停强度 / 资金方向 / 放量异动 / 领涨行业)。"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.services.hotspot import Hotspot, get_hotspot

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/hotspot", response_model=Hotspot)
async def hotspot() -> Hotspot:
    try:
        return await asyncio.to_thread(get_hotspot)
    except Exception as e:
        log.exception("hotspot failed")
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e
