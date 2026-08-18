"""Non-blocking symbol search with an automatically refreshed A-share corpus.

The checked-in JSON remains a cold-start fallback.  A background worker pulls
the exchange corpus after boot and every six hours, swaps it into memory only
after validation, and atomically persists the last-good copy.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

MarketFilter = Literal["ALL", "US", "CN", "HK"]

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SEED_PATH = DATA_DIR / "symbols_seed.json"
CN_FULL_PATH = DATA_DIR / "symbols_cn_full.json"
HK_FULL_PATH = DATA_DIR / "symbols_hk_full.json"
REFRESH_SECONDS = int(os.getenv("SYMBOL_REFRESH_SECONDS", str(6 * 60 * 60)))
RETRY_SECONDS = int(os.getenv("SYMBOL_REFRESH_RETRY_SECONDS", str(30 * 60)))
MIN_CN_SYMBOLS = int(os.getenv("SYMBOL_REFRESH_MIN_CN", "4000"))

log = logging.getLogger(__name__)
_LOCK = threading.RLock()
_SYMBOLS: list["SymbolSuggestion"] | None = None
_STARTED = False
_STATUS: dict[str, object] = {
    "refreshing": False,
    "last_attempt": None,
    "last_success": None,
    "last_error": None,
    "last_persist_error": None,
    "cn_count": 0,
}


class SymbolSuggestion(BaseModel):
    ticker: str
    market: Literal["US", "CN", "HK"]
    name: str
    aliases: list[str] = Field(default_factory=list)


def _read_json(path: Path) -> list[dict]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (OSError, ValueError):
        log.exception("cannot read symbol corpus %s", path)
        return []


def _load_disk() -> list[SymbolSuggestion]:
    raw: list[dict] = []
    if SEED_PATH.exists():
        raw.extend(_read_json(SEED_PATH))
    if CN_FULL_PATH.exists():
        raw.extend(_read_json(CN_FULL_PATH))
    if HK_FULL_PATH.exists():
        raw.extend(_read_json(HK_FULL_PATH))
    return _validate_and_dedupe(raw)


def _validate_and_dedupe(raw: list[dict]) -> list[SymbolSuggestion]:
    """Curated seed wins, so its richer aliases survive corpus refreshes."""
    seen: set[tuple[str, str]] = set()
    out: list[SymbolSuggestion] = []
    for item in raw:
        try:
            symbol = SymbolSuggestion.model_validate(item)
        except Exception:
            continue
        key = (symbol.market, symbol.ticker)
        if key in seen:
            continue
        seen.add(key)
        out.append(symbol)
    return out


def load_symbols() -> list[SymbolSuggestion]:
    global _SYMBOLS
    with _LOCK:
        if _SYMBOLS is None:
            _SYMBOLS = _load_disk()
            _STATUS["cn_count"] = sum(item.market == "CN" for item in _SYMBOLS)
        return list(_SYMBOLS)


def _market_board(code: str) -> str:
    if code.startswith(("300", "301")):
        return "创业板"
    if code.startswith(("688", "689")):
        return "科创板"
    if code.startswith(("8", "4", "9")):
        return "北交所"
    if code.startswith("6"):
        return "沪市主板"
    if code.startswith(("000", "001", "002", "003")):
        return "深市主板"
    return "A股"


def _aliases(code: str, name: str) -> list[str]:
    clean = name.replace(" ", "")
    values = [_market_board(code)]
    if clean != name:
        values.insert(0, clean)
    for prefix in ("*ST", "ST", "N", "C"):
        if clean.startswith(prefix) and len(clean) > len(prefix):
            values.append(clean[len(prefix):])
    return list(dict.fromkeys(value for value in values if value and value != name))


def _fetch_cn() -> list[dict]:
    import akshare as ak

    frame = ak.stock_info_a_code_name()
    rows = []
    for _, row in frame.iterrows():
        code = str(row.get("code") or "").strip().zfill(6)
        name = str(row.get("name") or "").strip()
        if len(code) != 6 or not code.isdigit() or not name:
            continue
        rows.append({
            "ticker": code,
            "market": "CN",
            "name": name,
            "aliases": _aliases(code, name),
        })
    rows.sort(key=lambda item: item["ticker"])
    if len(rows) < MIN_CN_SYMBOLS:
        raise ValueError(f"A-share corpus unexpectedly small: {len(rows)}")
    return rows


def refresh_cn_symbols() -> bool:
    """Refresh once. Failure never replaces the last-good in-memory/disk copy."""
    global _SYMBOLS
    now = datetime.now(timezone.utc).isoformat()
    with _LOCK:
        _STATUS.update(refreshing=True, last_attempt=now)
    try:
        cn_rows = _fetch_cn()
        seed_rows = _read_json(SEED_PATH)
        hk_rows = _read_json(HK_FULL_PATH)
        symbols = _validate_and_dedupe([*seed_rows, *cn_rows, *hk_rows])
        payload = json.dumps(cn_rows, ensure_ascii=False, indent=2) + "\n"
        persist_error = None
        try:
            temporary = CN_FULL_PATH.with_suffix(".json.tmp")
            temporary.write_text(payload, encoding="utf-8")
            os.replace(temporary, CN_FULL_PATH)
        except OSError as exc:
            # A read-only application directory must not prevent the live
            # in-memory corpus from updating. It will retry persistence later.
            persist_error = str(exc)
            log.warning("A-share corpus refreshed in memory but not persisted: %s", exc)
        with _LOCK:
            _SYMBOLS = symbols
            _STATUS.update(
                refreshing=False,
                last_success=now,
                last_error=None,
                last_persist_error=persist_error,
                cn_count=len(cn_rows),
            )
        log.info("A-share symbol corpus refreshed: %d symbols", len(cn_rows))
        return True
    except Exception as exc:
        with _LOCK:
            _STATUS.update(refreshing=False, last_error=str(exc))
        log.warning("A-share symbol refresh failed; keeping last-good corpus: %s", exc)
        return False


def symbol_refresh_status() -> dict[str, object]:
    load_symbols()
    with _LOCK:
        return dict(_STATUS)


def _refresh_loop() -> None:
    while True:
        succeeded = refresh_cn_symbols()
        time.sleep(REFRESH_SECONDS if succeeded else RETRY_SECONDS)


def start_symbol_refresh() -> None:
    global _STARTED
    with _LOCK:
        if _STARTED:
            return
        _STARTED = True
    load_symbols()
    threading.Thread(
        target=_refresh_loop,
        daemon=True,
        name="symbol-refresh",
    ).start()


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

        plain_ticker = ticker.lstrip("0") or ticker
        if ticker == query:
            return 1000
        if s.market == "HK" and plain_ticker == query:
            return 940
        if ticker.startswith(query):
            return 900
        if plain_ticker == query:
            return 880
        if s.market == "HK" and plain_ticker.startswith(query):
            return 860
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
