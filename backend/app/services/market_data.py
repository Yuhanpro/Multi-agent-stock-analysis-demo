"""Unified market-data layer.

US tickers -> yfinance.
CN tickers (A-shares, 6-digit codes) -> akshare.

We deliberately keep the Snapshot schema small; LLMs and the frontend both
consume it, so the surface area must be stable.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel

log = logging.getLogger(__name__)

Market = Literal["US", "CN"]


class OHLCV(BaseModel):
    date: str  # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: float


class Fundamentals(BaseModel):
    name: str | None = None
    sector: str | None = None
    market_cap: float | None = None  # in native currency
    pe: float | None = None
    pb: float | None = None
    dividend_yield: float | None = None  # decimal, e.g. 0.012
    revenue_yoy: float | None = None  # decimal, e.g. 0.18
    eps: float | None = None
    currency: str | None = None


class Snapshot(BaseModel):
    ticker: str
    market: Market
    price: float | None
    change_pct: float | None  # latest day, decimal (0.012 = +1.2%)
    ohlcv: list[OHLCV]
    fundamentals: Fundamentals
    source: str  # "yfinance" | "akshare" | "yfinance+fallback"


# ---------- US (yfinance) ---------------------------------------------------


def _us_snapshot(ticker: str) -> Snapshot:
    """US snapshot with yfinance first, akshare fallback.

    Yahoo Finance often rate-limits mainland/cloud IP ranges. On our Aliyun
    light server, yfinance returns HTTP 429, while akshare's `stock_us_daily`
    still serves AAPL daily bars. The fallback keeps Snapshot/Quick usable even
    when fundamentals are sparse.
    """
    try:
        return _us_snapshot_yfinance(ticker)
    except Exception as e:
        log.warning("yfinance US snapshot failed for %s; falling back to akshare: %s", ticker, e)
        return _us_snapshot_akshare(ticker)


def _us_snapshot_yfinance(ticker: str) -> Snapshot:
    import yfinance as yf

    t = yf.Ticker(ticker)
    hist = t.history(period="3mo", auto_adjust=False)
    if hist.empty:
        raise ValueError(f"yfinance returned no history for {ticker}")

    ohlcv = [
        OHLCV(
            date=idx.strftime("%Y-%m-%d"),
            open=float(row["Open"]),
            high=float(row["High"]),
            low=float(row["Low"]),
            close=float(row["Close"]),
            volume=float(row["Volume"]),
        )
        for idx, row in hist.iterrows()
        # yfinance occasionally tails a partial row (current trading day not yet
        # settled) where Close is NaN. Drop it so price/change_pct stay real.
        if row["Close"] == row["Close"]
    ]
    if not ohlcv:
        raise ValueError(f"yfinance returned only NaN rows for {ticker}")

    last_close = ohlcv[-1].close
    prev_close = ohlcv[-2].close if len(ohlcv) > 1 else last_close
    change_pct = (last_close - prev_close) / prev_close if prev_close else None

    info: dict = {}
    try:
        info = t.info or {}
    except Exception as e:  # yfinance .info is flaky
        log.warning("yfinance .info failed for %s: %s", ticker, e)

    fundamentals = Fundamentals(
        name=info.get("longName") or info.get("shortName"),
        sector=info.get("sector"),
        market_cap=_safe_float(info.get("marketCap")),
        pe=_safe_float(info.get("trailingPE")),
        pb=_safe_float(info.get("priceToBook")),
        dividend_yield=_safe_float(info.get("dividendYield")),
        revenue_yoy=_safe_float(info.get("revenueGrowth")),
        eps=_safe_float(info.get("trailingEps")),
        currency=info.get("currency", "USD"),
    )

    return Snapshot(
        ticker=ticker.upper(),
        market="US",
        price=last_close,
        change_pct=change_pct,
        ohlcv=ohlcv,
        fundamentals=fundamentals,
        source="yfinance",
    )


def _us_snapshot_akshare(ticker: str) -> Snapshot:
    import akshare as ak

    symbol = ticker.upper()
    hist = ak.stock_us_daily(symbol=symbol, adjust="")
    if hist is None or hist.empty:
        raise ValueError(f"akshare returned no US history for {symbol}")

    # ak.stock_us_daily columns are English: date/open/high/low/close/volume.
    hist = hist.tail(90)
    ohlcv = [
        OHLCV(
            date=str(row["date"])[:10],
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]),
        )
        for _, row in hist.iterrows()
        if row["close"] == row["close"]
    ]
    if not ohlcv:
        raise ValueError(f"akshare returned only NaN US rows for {symbol}")

    last_close = ohlcv[-1].close
    prev_close = ohlcv[-2].close if len(ohlcv) > 1 else last_close
    change_pct = (last_close - prev_close) / prev_close if prev_close else None

    fundamentals = Fundamentals(
        name=symbol,
        currency="USD",
    )

    return Snapshot(
        ticker=symbol,
        market="US",
        price=last_close,
        change_pct=change_pct,
        ohlcv=ohlcv,
        fundamentals=fundamentals,
        source="akshare-us-daily",
    )


# ---------- CN (akshare) ----------------------------------------------------


def _cn_snapshot(ticker: str) -> Snapshot:
    import akshare as ak

    code = ticker.zfill(6)  # 600519, 000001
    end = datetime.utcnow().date()
    start = end - timedelta(days=120)

    source = "akshare"
    try:
        hist = ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
            adjust="",
        )
    except Exception as e:
        log.warning("akshare stock_zh_a_hist failed for %s; trying stock_zh_a_daily: %s", code, e)
        hist = None

    if hist is None or hist.empty:
        # Fallback: stock_zh_a_daily uses English columns and has been more
        # stable on the Aliyun light server. It expects sh/sz prefix.
        prefix = "sh" if code.startswith("6") else "sz"
        hist = ak.stock_zh_a_daily(
            symbol=f"{prefix}{code}",
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
            adjust="",
        )
        source = "akshare-daily"
    if hist is None or hist.empty:
        raise ValueError(f"akshare returned no history for {code}")

    # Column names differ by akshare endpoint:
    # - stock_zh_a_hist:  日期 开盘 收盘 最高 最低 成交量
    # - stock_zh_a_daily: date open high low close volume
    cols = {c: c for c in hist.columns}
    def col(*names: str) -> str:
        for n in names:
            if n in cols:
                return n
        raise KeyError(f"akshare missing one of {names}; got {list(cols)}")

    c_date = col("日期", "date")
    c_open = col("开盘", "open")
    c_close = col("收盘", "close")
    c_high = col("最高", "high")
    c_low = col("最低", "low")
    c_vol = col("成交量", "volume")

    ohlcv = [
        OHLCV(
            date=str(row[c_date])[:10],
            open=float(row[c_open]),
            high=float(row[c_high]),
            low=float(row[c_low]),
            close=float(row[c_close]),
            volume=float(row[c_vol]),
        )
        for _, row in hist.iterrows()
        # mirror the yfinance defensive skip — NaN row would null out price
        if row[c_close] == row[c_close]
    ]
    if not ohlcv:
        raise ValueError(f"akshare returned only NaN rows for {code}")

    last_close = ohlcv[-1].close
    prev_close = ohlcv[-2].close if len(ohlcv) > 1 else last_close
    change_pct = (last_close - prev_close) / prev_close if prev_close else None

    fundamentals = Fundamentals(currency="CNY")
    try:
        info = ak.stock_individual_info_em(symbol=code)
        if info is not None and not info.empty:
            kv = dict(zip(info["item"], info["value"]))
            fundamentals.name = kv.get("股票简称") or kv.get("股票名称")
            fundamentals.sector = kv.get("行业")
            fundamentals.market_cap = _safe_float(kv.get("总市值"))
    except Exception as e:
        log.warning("akshare stock_individual_info_em failed for %s: %s", code, e)

    try:
        ind = ak.stock_a_indicator_lg(symbol=code)
        if ind is not None and not ind.empty:
            row = ind.iloc[-1]
            fundamentals.pe = _safe_float(row.get("pe_ttm"))
            fundamentals.pb = _safe_float(row.get("pb"))
            fundamentals.dividend_yield = _safe_float(row.get("dv_ratio"))
            if fundamentals.dividend_yield is not None:
                # akshare returns percent; normalize to decimal
                fundamentals.dividend_yield = fundamentals.dividend_yield / 100.0
    except Exception as e:
        log.warning("akshare stock_a_indicator_lg failed for %s: %s", code, e)

    return Snapshot(
        ticker=code,
        market="CN",
        price=last_close,
        change_pct=change_pct,
        ohlcv=ohlcv,
        fundamentals=fundamentals,
        source=source,
    )


# ---------- Public API ------------------------------------------------------


def get_snapshot(ticker: str, market: Market) -> Snapshot:
    if not ticker or not ticker.strip():
        raise ValueError("ticker is required")
    ticker = ticker.strip()
    if market == "US":
        return _us_snapshot(ticker)
    if market == "CN":
        return _cn_snapshot(ticker)
    raise ValueError(f"unsupported market: {market!r}")


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    # yfinance sometimes returns NaN
    if f != f:  # NaN check
        return None
    return f
