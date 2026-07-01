"""Gold data: domestic (上海黄金 Au99.99, 元/克) + international (COMEX GC, USD/oz)
+ global gold-ETF holdings. All sources reachable from the mainland VPS.
"""
from __future__ import annotations

import logging
import time

from pydantic import BaseModel

from app.services.market_data import _safe_float

log = logging.getLogger(__name__)

_CACHE: tuple[float, "GoldData"] | None = None
_TTL = 60


class GoldPoint(BaseModel):
    date: str
    close: float | None = None


class GoldSeries(BaseModel):
    name: str
    unit: str
    price: float | None = None
    change_pct: float | None = None   # decimal
    history: list[GoldPoint] = []


class GoldData(BaseModel):
    domestic: GoldSeries
    intl: GoldSeries
    etf_total: float | None = None    # global gold-ETF holdings, tonnes
    etf_change: float | None = None   # day change, tonnes
    etf_date: str | None = None
    source: str = "akshare-sge/comex"


def _domestic() -> GoldSeries:
    import akshare as ak

    s = GoldSeries(name="沪金 Au99.99", unit="元/克")
    prev = None
    try:
        df = ak.spot_hist_sge(symbol="Au99.99")
        if df is not None and not df.empty:
            rows = [GoldPoint(date=str(r["date"])[:10], close=_safe_float(r["close"])) for _, r in df.iterrows()]
            rows = [p for p in rows if p.close is not None]
            s.history = rows[-180:]
            if len(rows) >= 2:
                prev = rows[-2].close
                s.price = rows[-1].close
    except Exception as e:
        log.warning("sge hist failed: %s", e)
    # realtime overlay
    try:
        rt = ak.spot_quotations_sge(symbol="Au99.99")
        if rt is not None and not rt.empty:
            sub = rt[rt["品种"].astype(str) == "Au99.99"]
            if not sub.empty:
                p = _safe_float(sub.iloc[0].get("现价"))
                if p:
                    s.price = p
    except Exception as e:
        log.warning("sge realtime failed: %s", e)
    if s.price is not None and prev:
        s.change_pct = s.price / prev - 1
    return s


def _intl() -> GoldSeries:
    import akshare as ak

    s = GoldSeries(name="COMEX 黄金", unit="美元/盎司")
    try:
        df = ak.futures_foreign_hist(symbol="GC")
        if df is not None and not df.empty:
            rows = [GoldPoint(date=str(r["date"])[:10], close=_safe_float(r["close"])) for _, r in df.iterrows()]
            rows = [p for p in rows if p.close and p.close > 0]
            s.history = rows[-180:]
            if len(rows) >= 2:
                s.price = rows[-1].close
                s.change_pct = rows[-1].close / rows[-2].close - 1
    except Exception as e:
        log.warning("comex gold failed: %s", e)
    return s


def _etf_holdings() -> tuple[float | None, float | None, str | None]:
    import akshare as ak

    try:
        df = ak.macro_cons_gold()
        if df is not None and not df.empty:
            r = df.iloc[-1]
            return _safe_float(r.get("总库存")), _safe_float(r.get("增持/减持")), str(r.get("日期"))[:10]
    except Exception as e:
        log.warning("gold etf holdings failed: %s", e)
    return None, None, None


def get_gold() -> GoldData:
    global _CACHE
    if _CACHE and time.time() - _CACHE[0] < _TTL:
        return _CACHE[1]
    total, change, date = _etf_holdings()
    data = GoldData(domestic=_domestic(), intl=_intl(), etf_total=total, etf_change=change, etf_date=date)
    _CACHE = (time.time(), data)
    return data
