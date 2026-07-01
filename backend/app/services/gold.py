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
    usdcny: float | None = None       # USD/CNY used for the conversion
    intl_in_cny: float | None = None  # international gold converted to 元/克
    premium: float | None = None      # domestic − intl_in_cny (元/克); +溢价 / −贴水
    premium_pct: float | None = None
    source: str = "akshare-sge/comex"


_OZ_G = 31.1035  # grams per troy ounce


def _usdcny() -> float | None:
    """USD/CNY from the Bank of China quote (中行牌价, per-100 → divide)."""
    import akshare as ak
    from datetime import datetime, timedelta, timezone

    try:
        cn = datetime.now(timezone.utc) + timedelta(hours=8)
        df = ak.currency_boc_sina(symbol="美元",
                                  start_date=(cn - timedelta(days=12)).strftime("%Y%m%d"),
                                  end_date=cn.strftime("%Y%m%d"))
        if df is not None and not df.empty:
            v = _safe_float(df.iloc[-1].get("央行中间价"))
            if v:
                return v / 100.0
    except Exception as e:
        log.warning("usdcny failed: %s", e)
    return None


def _domestic() -> GoldSeries:
    import akshare as ak

    s = GoldSeries(name="沪金 Au99.99", unit="元/克")
    last_close = prev_daily = None
    try:
        df = ak.spot_hist_sge(symbol="Au99.99")
        if df is not None and not df.empty:
            rows = [GoldPoint(date=str(r["date"])[:10], close=_safe_float(r["close"])) for _, r in df.iterrows()]
            rows = [p for p in rows if p.close is not None]
            s.history = rows[-180:]
            if rows:
                last_close = rows[-1].close        # 最近日收盘(交易日内即"昨收")
                s.price = last_close
            if len(rows) >= 2:
                prev_daily = rows[-2].close
    except Exception as e:
        log.warning("sge hist failed: %s", e)
    # realtime overlay — the table is today's intraday ticks; take the LATEST one.
    rt_price = None
    try:
        rt = ak.spot_quotations_sge(symbol="Au99.99")
        if rt is not None and not rt.empty:
            sub = rt[rt["品种"].astype(str) == "Au99.99"]
            if not sub.empty:
                rt_price = _safe_float(sub.iloc[-1].get("现价"))
                if rt_price:
                    s.price = rt_price
    except Exception as e:
        log.warning("sge realtime failed: %s", e)
    if rt_price and last_close:
        s.change_pct = rt_price / last_close - 1          # 实时 vs 昨收
    elif last_close and prev_daily:
        s.change_pct = last_close / prev_daily - 1        # 无实时时用最新日涨跌
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
    # domestic-vs-international spread, converting COMEX (USD/oz) to 元/克.
    usdcny = _usdcny()
    data.usdcny = round(usdcny, 4) if usdcny else None
    if data.intl.price and usdcny:
        intl_cny = data.intl.price / _OZ_G * usdcny
        data.intl_in_cny = round(intl_cny, 2)
        if data.domestic.price and intl_cny:
            data.premium = round(data.domestic.price - intl_cny, 2)
            data.premium_pct = round(data.premium / intl_cny, 4)
    _CACHE = (time.time(), data)
    return data
