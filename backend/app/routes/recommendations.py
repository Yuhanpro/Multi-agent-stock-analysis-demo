"""GET /api/recommendations — transparent research candidates."""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.services.recommendations import RecommendationResponse, get_recommendations
from app.services.recommendation_backtest import BacktestResponse, get_price_backtest

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/recommendations", response_model=RecommendationResponse)
async def recommendations(
    profile: Literal["conservative", "balanced", "aggressive"] = "balanced",
    limit: int = Query(default=10, ge=3, le=20),
    industry: str | None = Query(default=None, min_length=1, max_length=40),
) -> RecommendationResponse:
    try:
        return await asyncio.to_thread(get_recommendations, profile, limit, industry)
    except Exception as exc:
        log.exception("recommendation screening failed")
        raise HTTPException(status_code=502, detail=f"行情筛选暂不可用: {exc}") from exc


@router.get("/recommendations/backtest", response_model=BacktestResponse)
async def recommendation_backtest(
    profile: Literal["conservative", "balanced", "aggressive"] = "balanced",
    years: int = Query(default=3, ge=1, le=5),
    limit: int = Query(default=10, ge=3, le=10),
    tickers: str | None = Query(default=None, max_length=80),
    industry: str | None = Query(default=None, min_length=1, max_length=40),
) -> BacktestResponse:
    try:
        selected = [value.strip() for value in tickers.split(",") if value.strip()] if tickers else None
        if selected and (len(selected) > 10 or any(not value.isdigit() or len(value) > 6 for value in selected)):
            raise ValueError("股票代码格式错误，最多选择 10 只 A 股")
        return await asyncio.to_thread(get_price_backtest, profile, years, limit, selected, industry)
    except Exception as exc:
        log.exception("recommendation backtest failed")
        raise HTTPException(status_code=502, detail=f"历史价格回测暂不可用: {exc}") from exc
