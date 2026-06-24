"""Unified market-data layer.

US tickers -> yfinance (akshare fallback on mainland cloud).
CN tickers (A-shares, 6-digit codes) -> akshare.
HK tickers (5-digit codes) -> akshare.

We deliberately keep the Snapshot schema small; LLMs and the frontend both
consume it, so the surface area must be stable.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel

log = logging.getLogger(__name__)

Market = Literal["US", "CN", "HK"]


class OHLCV(BaseModel):
    date: str  # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: float


class RealtimeQuote(BaseModel):
    current_price: float | None = None
    open: float | None = None
    prev_close: float | None = None
    day_high: float | None = None
    day_low: float | None = None
    volume: float | None = None
    amount: float | None = None
    turnover_rate: float | None = None  # decimal
    amplitude: float | None = None  # decimal
    change_pct: float | None = None  # decimal
    bid: float | None = None
    ask: float | None = None
    timestamp: str | None = None
    source: str | None = None


class Fundamentals(BaseModel):
    name: str | None = None
    sector: str | None = None
    market_cap: float | None = None  # in native currency
    pe: float | None = None
    pb: float | None = None
    dividend_yield: float | None = None  # decimal, e.g. 0.012
    revenue_yoy: float | None = None  # decimal, e.g. 0.18
    net_income_yoy: float | None = None
    eps: float | None = None
    revenue: float | None = None
    net_income: float | None = None
    roe: float | None = None  # decimal
    roa: float | None = None  # decimal
    gross_margin: float | None = None  # decimal
    net_margin: float | None = None  # decimal
    debt_asset_ratio: float | None = None  # decimal
    currency: str | None = None
    source_detail: str | None = None


class Snapshot(BaseModel):
    ticker: str
    market: Market
    price: float | None
    change_pct: float | None  # latest day, decimal (0.012 = +1.2%)
    ohlcv: list[OHLCV]
    fundamentals: Fundamentals
    realtime: RealtimeQuote | None = None
    source: str  # "yfinance" | "akshare" | "yfinance+fallback"


def _pct(v) -> float | None:
    f = _safe_float(v)
    if f is None:
        return None
    return f / 100.0


def _latest_row(df):
    if df is None or df.empty:
        return None
    return df.iloc[0]


def _symbol_name(ticker: str, market: Market) -> str | None:
    try:
        from app.services.symbol_search import load_symbols
        key = ticker.upper()
        if market == "CN":
            key = ticker.zfill(6)
        elif market == "HK":
            key = ticker.upper().replace("HK", "").zfill(5)
        for s in load_symbols():
            if s.market == market and s.ticker == key:
                return s.name
    except Exception:
        return None
    return None


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
        revenue=_safe_float(info.get("totalRevenue")),
        net_income=_safe_float(info.get("netIncomeToCommon")),
        roe=_safe_float(info.get("returnOnEquity")),
        roa=_safe_float(info.get("returnOnAssets")),
        gross_margin=_safe_float(info.get("grossMargins")),
        net_margin=_safe_float(info.get("profitMargins")),
        currency=info.get("currency", "USD"),
        source_detail="yfinance info",
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
        name=_symbol_name(symbol, "US") or symbol,
        currency="USD",
        source_detail="akshare stock_us_daily",
    )
    try:
        fin = ak.stock_financial_us_analysis_indicator_em(symbol=symbol)
        row = _latest_row(fin)
        if row is not None:
            fundamentals.name = str(row.get("SECURITY_NAME_ABBR") or symbol)
            fundamentals.eps = _safe_float(row.get("BASIC_EPS"))
            fundamentals.revenue = _safe_float(row.get("OPERATE_INCOME"))
            fundamentals.revenue_yoy = _pct(row.get("OPERATE_INCOME_YOY"))
            fundamentals.net_income = _safe_float(row.get("PARENT_HOLDER_NETPROFIT"))
            fundamentals.net_income_yoy = _pct(row.get("PARENT_HOLDER_NETPROFIT_YOY"))
            fundamentals.gross_margin = _pct(row.get("GROSS_PROFIT_RATIO"))
            fundamentals.net_margin = _pct(row.get("NET_PROFIT_RATIO"))
            fundamentals.roe = _pct(row.get("ROE_AVG"))
            fundamentals.roa = _pct(row.get("ROA"))
            fundamentals.debt_asset_ratio = _pct(row.get("DEBT_ASSET_RATIO"))
            if fundamentals.eps and last_close:
                fundamentals.pe = fundamentals.pe or (last_close / fundamentals.eps)
            fundamentals.source_detail = "akshare stock_us_daily + stock_financial_us_analysis_indicator_em"
    except Exception as e:
        log.warning("akshare US financial indicators failed for %s: %s", symbol, e)

    return Snapshot(
        ticker=symbol,
        market="US",
        price=last_close,
        change_pct=change_pct,
        ohlcv=ohlcv,
        fundamentals=fundamentals,
        source="akshare-us-daily",
    )


_CN_SPOT_CACHE: tuple[float, object] | None = None


def get_cn_spot():
    """Shared 60s-cached A-share spot table (akshare stock_zh_a_spot, Sina).
    Reused by the realtime quote and the market-overview hot lists."""
    global _CN_SPOT_CACHE
    import akshare as ak

    now = time.time()
    if _CN_SPOT_CACHE is None or now - _CN_SPOT_CACHE[0] > 60:
        _CN_SPOT_CACHE = (now, ak.stock_zh_a_spot())
    return _CN_SPOT_CACHE[1]


def _cn_realtime_quote(code: str) -> RealtimeQuote | None:
    """Best-effort A-share real-time quote from akshare stock_zh_a_spot.

    The endpoint downloads the whole A-share table and is relatively slow, so
    cache it for 60 seconds per process.
    """
    df = get_cn_spot()
    target = df[df["代码"].astype(str).str.contains(code, na=False)]
    if target.empty:
        return None
    row = target.iloc[0]
    return RealtimeQuote(
        current_price=_safe_float(row.get("最新价")),
        open=_safe_float(row.get("今开")),
        prev_close=_safe_float(row.get("昨收")),
        day_high=_safe_float(row.get("最高")),
        day_low=_safe_float(row.get("最低")),
        volume=_safe_float(row.get("成交量")),
        amount=_safe_float(row.get("成交额")),
        turnover_rate=None,
        amplitude=None,
        change_pct=_pct(row.get("涨跌幅")),
        bid=_safe_float(row.get("买入")),
        ask=_safe_float(row.get("卖出")),
        timestamp=str(row.get("时间戳")) if row.get("时间戳") is not None else None,
        source="akshare stock_zh_a_spot",
    )


# ---------- CN (akshare) ----------------------------------------------------


def _cn_snapshot(ticker: str) -> Snapshot:
    import akshare as ak

    code = ticker.zfill(6)  # 600519, 000001
    end = datetime.utcnow().date()
    start = end - timedelta(days=120)

    # Prefer stock_zh_a_daily on Aliyun: it is more stable than the EastMoney
    # stock_zh_a_hist endpoint and includes outstanding_share, which lets us
    # compute market cap even when valuation APIs are unavailable.
    source = "akshare-daily"
    prefix = "sh" if code.startswith("6") else "sz"
    try:
        hist = ak.stock_zh_a_daily(
            symbol=f"{prefix}{code}",
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
            adjust="",
        )
    except Exception as e:
        log.warning("akshare stock_zh_a_daily failed for %s; trying stock_zh_a_hist: %s", code, e)
        hist = None

    if hist is None or hist.empty:
        hist = ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
            adjust="",
        )
        source = "akshare"
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
    c_outstanding = cols.get("outstanding_share")

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

    realtime = None
    try:
        realtime = _cn_realtime_quote(code)
        if realtime and realtime.current_price:
            last_close = realtime.current_price
            change_pct = realtime.change_pct if realtime.change_pct is not None else change_pct
    except Exception as e:
        log.warning("akshare CN realtime quote failed for %s: %s", code, e)

    fundamentals = Fundamentals(name=_symbol_name(code, "CN"), currency="CNY", source_detail=source)
    if c_outstanding:
        try:
            shares = _safe_float(hist.iloc[-1].get(c_outstanding))
            if shares and last_close:
                fundamentals.market_cap = last_close * shares
                fundamentals.source_detail = f"{source} (market cap from outstanding_share)"
        except Exception as e:
            log.warning("CN market cap from outstanding_share failed for %s: %s", code, e)

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
            fundamentals.market_cap = fundamentals.market_cap or _safe_float(row.get("total_mv")) or _safe_float(row.get("total_market_value"))
            fundamentals.dividend_yield = _safe_float(row.get("dv_ratio"))
            if fundamentals.dividend_yield is not None:
                # akshare returns percent; normalize to decimal
                fundamentals.dividend_yield = fundamentals.dividend_yield / 100.0
    except Exception as e:
        log.warning("akshare stock_a_indicator_lg failed for %s: %s", code, e)

    try:
        fin = ak.stock_financial_analysis_indicator_em(symbol=code)
        row = _latest_row(fin)
        if row is not None:
            # akshare columns vary over time; read opportunistically.
            fundamentals.eps = fundamentals.eps or _safe_float(row.get("每股收益") or row.get("摊薄每股收益(元)"))
            fundamentals.roe = fundamentals.roe or _pct(row.get("净资产收益率") or row.get("加权净资产收益率(%)"))
            fundamentals.gross_margin = fundamentals.gross_margin or _pct(row.get("销售毛利率") or row.get("销售毛利率(%)"))
            fundamentals.net_margin = fundamentals.net_margin or _pct(row.get("销售净利率") or row.get("销售净利率(%)"))
            fundamentals.debt_asset_ratio = fundamentals.debt_asset_ratio or _pct(row.get("资产负债率") or row.get("资产负债率(%)"))
            if fundamentals.source_detail:
                fundamentals.source_detail += " + stock_financial_analysis_indicator_em"
            else:
                fundamentals.source_detail = "stock_financial_analysis_indicator_em"
    except Exception as e:
        log.warning("akshare CN financial indicators failed for %s: %s", code, e)

    # Growth (revenue / net income YoY) + absolute revenue/net income.
    # stock_financial_abstract returns RAW yuan floats (no Chinese-unit strings,
    # unlike stock_financial_abstract_ths) and carries 营业总收入增长率 /
    # 归属母公司净利润增长率 as percent values. Read all four from the SAME
    # report-period column so the figure and its YoY stay coherent. This also
    # backstops eps when the EM analysis-indicator endpoint regresses.
    try:
        absd = ak.stock_financial_abstract(symbol=code)
        if absd is not None and not absd.empty:
            cols = list(absd.columns)
            ind_col = cols[1]
            date_cols = cols[2:]  # report periods, newest first
            by_ind = {}
            for _, r in absd.iterrows():
                by_ind.setdefault(r[ind_col], r)  # first occurrence = 常用指标 section
            rev_row = by_ind.get("营业总收入")
            period = None
            if rev_row is not None:
                for d in date_cols:
                    if _safe_float(rev_row.get(d)) is not None:
                        period = d
                        break
            if period:
                def _abs_val(name: str):
                    row = by_ind.get(name)
                    return _safe_float(row.get(period)) if row is not None else None

                fundamentals.revenue = fundamentals.revenue or _abs_val("营业总收入")
                fundamentals.net_income = fundamentals.net_income or _abs_val("归母净利润")
                rev_g = _abs_val("营业总收入增长率")
                ni_g = _abs_val("归属母公司净利润增长率")
                if fundamentals.revenue_yoy is None and rev_g is not None:
                    fundamentals.revenue_yoy = rev_g / 100.0
                if fundamentals.net_income_yoy is None and ni_g is not None:
                    fundamentals.net_income_yoy = ni_g / 100.0
                def _val_at(name: str, col: str | None):
                    row = by_ind.get(name)
                    return _safe_float(row.get(col)) if (row is not None and col) else None

                def _newest(name: str):
                    row = by_ind.get(name)
                    if row is None:
                        return None
                    for d in date_cols:  # newest first
                        v = _safe_float(row.get(d))
                        if v is not None:
                            return v
                    return None

                annual = next((d for d in date_cols if d.endswith("1231")), None)

                # EPS backstop: prefer the latest annual (FY) figure so a single
                # quarter's cumulative EPS is not shown as if it were trailing.
                if fundamentals.eps is None and annual:
                    fundamentals.eps = _val_at("基本每股收益", annual)

                # The EM/legulegu valuation endpoints are dead on the prod VPS, so
                # derive PE/PB/ROE/margins from this (Sina-backed) source too.

                # PB from latest book value per share (balance-sheet snapshot).
                if fundamentals.pb is None and last_close:
                    bvps = _newest("每股净资产")
                    if bvps:
                        fundamentals.pb = last_close / bvps

                # PE from trailing-12-month EPS. EPS here is cumulative within a
                # fiscal year, so TTM = YTD + prevFY − prev-year-same-period.
                if fundamentals.pe is None and last_close:
                    ttm_eps = None
                    if period.endswith("1231"):
                        ttm_eps = _val_at("基本每股收益", period)
                    else:
                        yr = int(period[:4])
                        ytd = _val_at("基本每股收益", period)
                        pfy = _val_at("基本每股收益", f"{yr - 1}1231")
                        psame = _val_at("基本每股收益", f"{yr - 1}{period[4:]}")
                        if None not in (ytd, pfy, psame):
                            ttm_eps = ytd + pfy - psame
                        elif annual:
                            ttm_eps = _val_at("基本每股收益", annual)
                    if ttm_eps and ttm_eps > 0:
                        fundamentals.pe = last_close / ttm_eps

                # ROE / margins: latest annual (FY) headline figure; debt ratio is
                # a balance-sheet snapshot so take the newest available period.
                # ROE key has full/half-width parens across akshare versions —
                # resolve it by prefix instead of hard-coding the punctuation.
                roe_key = next(
                    (k for k in by_ind if k.startswith("净资产收益率") and "_" not in k and "摊薄" not in k),
                    None,
                )
                if fundamentals.roe is None and annual and roe_key:
                    fundamentals.roe = _pct(_val_at(roe_key, annual))
                if fundamentals.gross_margin is None and annual:
                    fundamentals.gross_margin = _pct(_val_at("毛利率", annual))
                if fundamentals.net_margin is None and annual:
                    fundamentals.net_margin = _pct(_val_at("销售净利率", annual))
                if fundamentals.debt_asset_ratio is None:
                    fundamentals.debt_asset_ratio = _pct(_newest("资产负债率"))

                tag = f"stock_financial_abstract ({period})"
                fundamentals.source_detail = (
                    f"{fundamentals.source_detail} + {tag}" if fundamentals.source_detail else tag
                )
    except Exception as e:
        log.warning("akshare stock_financial_abstract failed for %s: %s", code, e)

    return Snapshot(
        ticker=code,
        market="CN",
        price=last_close,
        change_pct=change_pct,
        ohlcv=ohlcv,
        fundamentals=fundamentals,
        realtime=realtime,
        source=source,
    )


# ---------- HK (akshare) ----------------------------------------------------


def _hk_snapshot(ticker: str) -> Snapshot:
    import akshare as ak

    code = ticker.strip().upper().replace("HK", "").zfill(5)
    hist = ak.stock_hk_daily(symbol=code, adjust="")
    if hist is None or hist.empty:
        raise ValueError(f"akshare returned no HK history for {code}")

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
        raise ValueError(f"akshare returned only NaN HK rows for {code}")

    last_close = ohlcv[-1].close
    prev_close = ohlcv[-2].close if len(ohlcv) > 1 else last_close
    change_pct = (last_close - prev_close) / prev_close if prev_close else None

    fundamentals = Fundamentals(
        name=_symbol_name(code, "HK") or code,
        currency="HKD",
        source_detail="akshare stock_hk_daily",
    )
    try:
        fin = ak.stock_hk_financial_indicator_em(symbol=code)
        row = _latest_row(fin)
        if row is not None:
            fundamentals.eps = _safe_float(row.get("基本每股收益(元)"))
            fundamentals.pb = _safe_float(row.get("市净率"))
            fundamentals.pe = _safe_float(row.get("市盈率"))
            fundamentals.market_cap = _safe_float(row.get("总市值(港元)")) or _safe_float(row.get("港股市值(港元)"))
            fundamentals.dividend_yield = _pct(row.get("股息率TTM(%)"))
            fundamentals.revenue = _safe_float(row.get("营业总收入"))
            fundamentals.revenue_yoy = _pct(row.get("营业总收入滚动环比增长(%)"))
            fundamentals.net_income = _safe_float(row.get("净利润"))
            fundamentals.net_income_yoy = _pct(row.get("净利润滚动环比增长(%)"))
            fundamentals.roe = _pct(row.get("股东权益回报率(%)"))
            fundamentals.roa = _pct(row.get("总资产回报率(%)"))
            fundamentals.source_detail = "akshare stock_hk_daily + stock_hk_financial_indicator_em"
    except Exception as e:
        log.warning("akshare HK financial indicators failed for %s: %s", code, e)

    try:
        profile = ak.stock_hk_company_profile_em(symbol=code)
        row = _latest_row(profile)
        if row is not None:
            fundamentals.name = str(row.get("公司名称") or fundamentals.name)
            fundamentals.sector = str(row.get("所属行业") or fundamentals.sector or "") or None
            fundamentals.source_detail = (fundamentals.source_detail or "") + " + stock_hk_company_profile_em"
    except Exception as e:
        log.warning("akshare HK company profile failed for %s: %s", code, e)

    return Snapshot(
        ticker=code,
        market="HK",
        price=last_close,
        change_pct=change_pct,
        ohlcv=ohlcv,
        fundamentals=fundamentals,
        source="akshare-hk-daily",
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
    if market == "HK":
        return _hk_snapshot(ticker)
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
