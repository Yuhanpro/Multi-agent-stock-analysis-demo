"""Fund routes — detail, search, and LLM review."""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import auth, budget, events, reports
from app.services.funds import Fund, get_fund, search_funds
from app.services.rate_limit import enforce_scope
from app.services.skill_runner import sse_event, stream_fund_review

log = logging.getLogger(__name__)

router = APIRouter()


class FundSuggestion(BaseModel):
    code: str
    name: str
    type: str | None = None


@router.get("/fund", response_model=Fund)
async def fund(code: str) -> Fund:
    if not code or not code.strip():
        raise HTTPException(status_code=400, detail="code is required")
    try:
        return await asyncio.to_thread(get_fund, code.strip())
    except Exception as e:
        log.exception("fund fetch failed for %s", code)
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e


@router.get("/fund-search", response_model=list[FundSuggestion])
async def fund_search(q: str, limit: int = 12) -> list[FundSuggestion]:
    if not q or not q.strip():
        return []
    rows = await asyncio.to_thread(search_funds, q.strip(), min(max(1, limit), 30))
    return [FundSuggestion(**r) for r in rows]


class FundAnalyzeRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=16)
    language: Literal["en", "zh"] = "en"


@router.post("/fund-analyze")
async def fund_analyze(request: Request, req: FundAnalyzeRequest) -> EventSourceResponse:
    settings = get_settings()
    try:
        fund_obj = await asyncio.to_thread(get_fund, req.code.strip())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e
    if not fund_obj.nav and not fund_obj.holdings:
        raise HTTPException(status_code=400, detail="基金数据为空,无法分析")

    user = auth.user_from_request(request)
    enforce_scope(request, "quick", user)  # signed-in unlimited; anon capped
    budget.assert_within_budget()

    async def event_gen():
        chunks: list[str] = []
        try:
            async for event_name, payload in stream_fund_review(
                fund=fund_obj, language=req.language, model=settings.quick_think_llm,
            ):
                if event_name == "token":
                    chunks.append(payload.get("text", ""))
                if event_name == "done":
                    cost = float(payload.get("cost_usd", 0) or 0)
                    new_total = budget.add_cost(cost)
                    payload["budget_today_usd"] = round(new_total, 6)
                    events.record_run(request, mode="fund", ticker=fund_obj.code,
                                      market="CN", cost_usd=cost)
                    if user and chunks:
                        try:
                            meta = reports.save_report(
                                user.id, ticker=fund_obj.code, market="CN", mode="fund",
                                language=req.language, content="".join(chunks), cost_usd=cost,
                            )
                            payload["saved_report_id"] = meta.id
                        except Exception:
                            log.exception("save fund report failed")
                yield sse_event(event_name, payload)
        except Exception as e:
            log.exception("fund analyze stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
