"""Gold: prices (domestic + international) and an AI daily review."""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import budget, gold as gold_svc
from app.services.rate_limit import check_and_count
from app.services.skill_runner import sse_event, stream_gold_review

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/gold", response_model=gold_svc.GoldData)
async def get_gold() -> gold_svc.GoldData:
    try:
        return await asyncio.to_thread(gold_svc.get_gold)
    except Exception as e:
        log.exception("gold data failed")
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e


class GoldReviewRequest(BaseModel):
    language: Literal["en", "zh"] = "zh"


@router.post("/gold-review")
async def gold_review(request: Request, req: GoldReviewRequest) -> EventSourceResponse:
    settings = get_settings()
    check_and_count(request, scope="quick", limit=settings.rate_limit_quick)
    budget.assert_within_budget()

    gold = await asyncio.to_thread(gold_svc.get_gold)

    async def event_gen():
        try:
            async for name, payload in stream_gold_review(gold=gold, language=req.language,
                                                          model=settings.quick_think_llm):
                if name == "done":
                    cost = float(payload.get("cost_usd", 0) or 0)
                    payload["budget_today_usd"] = round(budget.add_cost(cost), 6)
                yield sse_event(name, payload)
        except Exception as e:
            log.exception("gold review stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
