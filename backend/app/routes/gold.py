"""Gold: prices (domestic + international) and an AI daily review."""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import budget, gold as gold_svc
from app.services.rate_limit import check_and_count
from app.services.skill_runner import sse_event, stream_gold_chat, stream_gold_review

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
    period: Literal["day", "week", "month"] = "day"


@router.post("/gold-review")
async def gold_review(request: Request, req: GoldReviewRequest) -> EventSourceResponse:
    settings = get_settings()
    check_and_count(request, scope="quick", limit=settings.rate_limit_quick)
    budget.assert_within_budget()

    gold = await asyncio.to_thread(gold_svc.get_gold)

    async def event_gen():
        try:
            async for name, payload in stream_gold_review(gold=gold, period=req.period, language=req.language,
                                                          model=settings.quick_think_llm):
                if name == "done":
                    cost = float(payload.get("cost_usd", 0) or 0)
                    payload["budget_today_usd"] = round(budget.add_cost(cost), 6)
                yield sse_event(name, payload)
        except Exception as e:
            log.exception("gold review stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())


class GoldChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=8000)


class GoldChatRequest(BaseModel):
    report: str | None = Field(None, max_length=20000)
    history: list[GoldChatTurn] = Field(default_factory=list)
    question: str = Field(..., min_length=1, max_length=2000)
    language: Literal["en", "zh"] = "zh"


@router.post("/gold-chat")
async def gold_chat(request: Request, req: GoldChatRequest) -> EventSourceResponse:
    settings = get_settings()
    check_and_count(request, scope="quick", limit=settings.rate_limit_quick)
    budget.assert_within_budget()
    gold = await asyncio.to_thread(gold_svc.get_gold)

    async def event_gen():
        try:
            async for name, payload in stream_gold_chat(
                gold=gold, report=req.report,
                history=[t.model_dump() for t in req.history],
                question=req.question, language=req.language, model=settings.quick_think_llm,
            ):
                if name == "done":
                    payload["budget_today_usd"] = round(budget.add_cost(float(payload.get("cost_usd", 0) or 0)), 6)
                yield sse_event(name, payload)
        except Exception as e:
            log.exception("gold chat stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
