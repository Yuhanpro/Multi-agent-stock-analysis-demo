"""Gold data: domestic (上海黄金 Au99.99, 元/克) + international (COMEX GC, USD/oz)
+ global gold-ETF holdings + USD/CNY spread. Daily OHLC (for K-line) plus today's
intraday ticks (domestic). All sources reachable from the mainland VPS.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.services.market_data import _safe_float

log = logging.getLogger(__name__)

_CACHE: tuple[float, "GoldData"] | None = None
_TTL = 60
_OZ_G = 31.1035  # grams per troy ounce


class GoldPoint(BaseModel):
    date: str
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None


class IntradayPoint(BaseModel):
    time: str
    price: float | None = None


class GoldTech(BaseModel):
    """Descriptive technical state (NOT buy/sell signals). Educational context only."""
    ma20: float | None = None
    ma60: float | None = None
    trend: str = "中性"          # 偏强 / 中性 / 偏弱 (price vs MA20/MA60)
    rsi: float | None = None
    rsi_state: str = ""          # 超买 / 偏强 / 偏弱 / 超卖
    macd_state: str = ""         # 金叉上方 / 死叉下方
    boll_pos: str = ""           # 上轨附近 / 中轨上方 / 中轨下方 / 下轨附近
    mom20: float | None = None   # 20-day change, decimal
    atr_pct: float | None = None # ATR14 / price
    bull: int = 0                # of 5 dimensions leaning bullish
    summary: str = "中性"        # 偏强 / 中性 / 偏弱


class GoldSeries(BaseModel):
    name: str
    unit: str
    price: float | None = None
    change_pct: float | None = None   # decimal
    history: list[GoldPoint] = []     # daily OHLC (oldest→newest)
    intraday: list[IntradayPoint] = []  # today's ticks (domestic only)
    tech: GoldTech | None = None


class GoldData(BaseModel):
    domestic: GoldSeries
    intl: GoldSeries
    etf_total: float | None = None
    etf_change: float | None = None
    etf_date: str | None = None
    usdcny: float | None = None
    intl_in_cny: float | None = None
    premium: float | None = None
    premium_pct: float | None = None
    source: str = "akshare-sge/comex"


def _usdcny() -> float | None:
    import akshare as ak

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


def _tech(history: list[GoldPoint]) -> "GoldTech | None":
    """Descriptive technical indicators from daily OHLC. Context, not signals."""
    import numpy as np
    import pandas as pd

    pts = [p for p in history if p.close is not None]
    if len(pts) < 60:
        return None
    c = pd.Series([p.close for p in pts], dtype=float)
    h = pd.Series([p.high if p.high is not None else p.close for p in pts], dtype=float)
    lo = pd.Series([p.low if p.low is not None else p.close for p in pts], dtype=float)
    price = float(c.iloc[-1])
    ma20 = float(c.rolling(20).mean().iloc[-1])
    ma60 = float(c.rolling(60).mean().iloc[-1])
    d = c.diff()
    g = d.clip(lower=0).rolling(14).mean()
    ll = (-d.clip(upper=0)).rolling(14).mean()
    rsi = float((100 - 100 / (1 + g / ll)).iloc[-1])
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    sig = macd.ewm(span=9, adjust=False).mean()
    macd_hist = float((macd - sig).iloc[-1])
    std20 = float(c.rolling(20).std().iloc[-1])
    up, dn = ma20 + 2 * std20, ma20 - 2 * std20
    mom20 = float(price / c.iloc[-21] - 1) if len(c) >= 21 else None
    tr = pd.concat([h - lo, (h - c.shift()).abs(), (lo - c.shift()).abs()], axis=1).max(axis=1)
    atr = float(tr.rolling(14).mean().iloc[-1])
    atr_pct = atr / price if price else None

    trend = "偏强" if price > ma20 > ma60 else "偏弱" if price < ma20 < ma60 else "中性"
    rsi_state = "超买" if rsi > 70 else "偏强" if rsi > 50 else "超卖" if rsi < 30 else "偏弱"
    macd_state = "金叉上方" if macd_hist > 0 else "死叉下方"
    boll_pos = "上轨附近" if price >= up else "下轨附近" if price <= dn else "中轨上方" if price > ma20 else "中轨下方"
    bull = int(sum([price > ma60, rsi > 50, macd_hist > 0, price > ma20, (mom20 or 0) > 0]))
    summary = "偏强" if bull >= 4 else "偏弱" if bull <= 1 else "中性"
    return GoldTech(
        ma20=round(ma20, 2), ma60=round(ma60, 2), trend=trend,
        rsi=round(rsi, 1), rsi_state=rsi_state, macd_state=macd_state, boll_pos=boll_pos,
        mom20=round(mom20, 4) if mom20 is not None else None,
        atr_pct=round(atr_pct, 4) if atr_pct else None, bull=bull, summary=summary,
    )


def _ohlc_rows(df, keep: int = 2400) -> list[GoldPoint]:
    out: list[GoldPoint] = []
    for _, r in df.iterrows():
        c = _safe_float(r.get("close"))
        if c is None or c <= 0:
            continue
        out.append(GoldPoint(
            date=str(r.get("date"))[:10],
            open=_safe_float(r.get("open")), high=_safe_float(r.get("high")),
            low=_safe_float(r.get("low")), close=c,
        ))
    return out[-keep:]


def _domestic() -> GoldSeries:
    import akshare as ak

    s = GoldSeries(name="沪金 Au99.99", unit="元/克")
    last_close = prev_daily = None
    try:
        df = ak.spot_hist_sge(symbol="Au99.99")
        if df is not None and not df.empty:
            s.history = _ohlc_rows(df)
            if s.history:
                last_close = s.history[-1].close
            if len(s.history) >= 2:
                prev_daily = s.history[-2].close
            s.price = last_close
    except Exception as e:
        log.warning("sge hist failed: %s", e)
    # realtime overlay + intraday — the quote table is today's ticks (oldest→newest).
    rt_price = None
    try:
        rt = ak.spot_quotations_sge(symbol="Au99.99")
        if rt is not None and not rt.empty:
            sub = rt[rt["品种"].astype(str) == "Au99.99"]
            ticks = [IntradayPoint(time=str(r.get("时间")), price=_safe_float(r.get("现价")))
                     for _, r in sub.iterrows()
                     if str(r.get("时间")) != "00:00:00" and _safe_float(r.get("现价"))]
            if len(ticks) > 240:  # downsample
                step = len(ticks) // 240 + 1
                ticks = [t for i, t in enumerate(ticks) if i % step == 0 or i == len(ticks) - 1]
            s.intraday = ticks
            if ticks:
                rt_price = ticks[-1].price
                s.price = rt_price
    except Exception as e:
        log.warning("sge realtime failed: %s", e)
    if rt_price and last_close:
        s.change_pct = rt_price / last_close - 1
    elif last_close and prev_daily:
        s.change_pct = last_close / prev_daily - 1
    try:
        s.tech = _tech(s.history)
    except Exception as e:
        log.warning("domestic tech failed: %s", e)
    return s


def _intl() -> GoldSeries:
    import akshare as ak

    s = GoldSeries(name="COMEX 黄金", unit="美元/盎司")
    try:
        df = ak.futures_foreign_hist(symbol="GC")
        if df is not None and not df.empty:
            s.history = _ohlc_rows(df)
            if len(s.history) >= 2:
                s.price = s.history[-1].close
                s.change_pct = s.history[-1].close / s.history[-2].close - 1
    except Exception as e:
        log.warning("comex gold failed: %s", e)
    try:
        s.tech = _tech(s.history)
    except Exception as e:
        log.warning("intl tech failed: %s", e)
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
