"""GET /api/hotspot — A股 热点雷达;POST /api/hotspot-review — AI 当日热点复盘。"""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import auth, budget, events
from app.services.global_flow import GlobalFlow, get_global_flow
from app.services.hotspot import Hotspot, get_hotspot
from app.services.rate_limit import enforce_scope
from app.services.skill_runner import sse_event, stream_hotspot_review

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/hotspot", response_model=Hotspot)
async def hotspot() -> Hotspot:
    try:
        return await asyncio.to_thread(get_hotspot)
    except Exception as e:
        log.exception("hotspot failed")
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e


@router.get("/global-flow", response_model=GlobalFlow)
async def global_flow() -> GlobalFlow:
    try:
        return await asyncio.to_thread(get_global_flow)
    except Exception as e:
        log.exception("global flow failed")
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e


class HotspotReviewRequest(BaseModel):
    language: Literal["en", "zh"] = "zh"


@router.post("/hotspot-review")
async def hotspot_review(request: Request, req: HotspotReviewRequest) -> EventSourceResponse:
    settings = get_settings()
    enforce_scope(request, "quick", auth.user_from_request(request))
    budget.assert_within_budget()
    hs = await asyncio.to_thread(get_hotspot)

    async def event_gen():
        try:
            async for name, payload in stream_hotspot_review(hotspot=hs, language=req.language,
                                                             model=settings.quick_think_llm):
                if name == "done":
                    cost = float(payload.get("cost_usd", 0) or 0)
                    payload["budget_today_usd"] = round(budget.add_cost(cost), 6)
                    events.record_run(request, mode="hotspot-review", market="CN", cost_usd=cost)
                yield sse_event(name, payload)
        except Exception as e:
            log.exception("hotspot review stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
