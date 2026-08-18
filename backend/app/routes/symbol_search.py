"""GET /api/symbol-search — ticker/name autocomplete."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.services.symbol_search import (
    MarketFilter,
    SymbolSuggestion,
    search_symbols,
    symbol_refresh_status,
)

router = APIRouter()


@router.get("/symbol-search", response_model=list[SymbolSuggestion])
def symbol_search(
    q: str = Query(..., min_length=1, max_length=40),
    market: MarketFilter = Query("ALL"),
    limit: int = Query(8, ge=1, le=20),
) -> list[SymbolSuggestion]:
    return search_symbols(q=q, market=market, limit=limit)


@router.get("/symbol-search/status")
def symbol_search_status() -> dict[str, object]:
    """Operational visibility for the non-blocking corpus refresh."""
    return symbol_refresh_status()
