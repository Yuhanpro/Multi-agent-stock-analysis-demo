"""Local symbol search / autocomplete.

Small curated symbol directory for the first version. This intentionally avoids
calling yfinance/akshare on every keystroke. It supports ticker, English name,
Chinese name, and aliases.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

MarketFilter = Literal["ALL", "US", "CN"]

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "symbols_seed.json"


class SymbolSuggestion(BaseModel):
    ticker: str
    market: Literal["US", "CN"]
    name: str
    aliases: list[str] = []


@lru_cache(maxsize=1)
def load_symbols() -> list[SymbolSuggestion]:
    raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return [SymbolSuggestion.model_validate(x) for x in raw]


def search_symbols(q: str, market: MarketFilter = "ALL", limit: int = 8) -> list[SymbolSuggestion]:
    query = (q or "").strip().lower()
    if not query:
        return []
    limit = max(1, min(int(limit or 8), 20))

    candidates = [s for s in load_symbols() if market == "ALL" or s.market == market]

    def score(s: SymbolSuggestion) -> int:
        ticker = s.ticker.lower()
        name = s.name.lower()
        aliases = [a.lower() for a in s.aliases]
        hay = [ticker, name, *aliases]

        if ticker == query:
            return 1000
        if ticker.startswith(query):
            return 900
        if name == query:
            return 850
        if any(a == query for a in aliases):
            return 820
        if name.startswith(query):
            return 760
        if any(a.startswith(query) for a in aliases):
            return 720
        if query in ticker:
            return 650
        if query in name:
            return 620
        if any(query in a for a in aliases):
            return 600
        return 0

    ranked = [(score(s), s) for s in candidates]
    ranked = [(sc, s) for sc, s in ranked if sc > 0]
    ranked.sort(key=lambda x: (-x[0], x[1].market, x[1].ticker))
    return [s for _, s in ranked[:limit]]
