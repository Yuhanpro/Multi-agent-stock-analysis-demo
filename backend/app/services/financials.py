"""Curated multi-period financial statements for US / CN / HK.

Feeds the analysis agents (Quick / Serenity prompts and TradingAgents) with the
core line items of the income statement, balance sheet and cash-flow statement
across ~5 annual periods + recent quarters, plus a comprehensive ratio set.

Sources, picked for reliability (esp. on the mainland VPS):
  US  -> yfinance statements (akshare EM report as fallback)
  CN  -> akshare stock_financial_abstract (Sina; rock-solid on the VPS),
         balance-sheet totals derived from equity + debt ratio
  HK  -> akshare stock_financial_hk_analysis_indicator_em (income + ratios)
         + stock_financial_hk_report_em (balance/cash-flow amounts)

Results are cached for a few hours since statement data only changes quarterly.
Everything degrades to None rather than raising, so a flaky upstream never
breaks a snapshot/agent run.
"""
from __future__ import annotations

import logging
import time
from typing import Literal

from pydantic import BaseModel

from app.services.market_data import Market, _safe_float

log = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, "Financials"]] = {}
_TTL_SECONDS = 6 * 3600


class FinPeriod(BaseModel):
    period: str            # "2025" (annual) or "2025Q3"
    end_date: str          # "2025-09-30"
    is_annual: bool
    # income statement
    revenue: float | None = None
    gross_profit: float | None = None
    operating_income: float | None = None
    net_income: float | None = None
    eps: float | None = None
    # balance sheet
    total_assets: float | None = None
    total_liabilities: float | None = None
    total_equity: float | None = None
    cash: float | None = None
    total_debt: float | None = None
    # cash flow
    operating_cash_flow: float | None = None
    capex: float | None = None
    free_cash_flow: float | None = None


class Financials(BaseModel):
    ticker: str
    market: Market
    currency: str | None = None
    annual: list[FinPeriod] = []
    quarterly: list[FinPeriod] = []
    ratios: dict[str, float | None] = {}  # latest-period ratios (decimals)
    source: str = ""


# ---------- helpers ---------------------------------------------------------


def _q_label(end_date: str) -> tuple[str, bool]:
    """Map an ISO end-date to (period label, is_annual) by calendar convention
    (Dec = annual). Correct for A-shares; US uses _label() with an explicit
    is_annual from the statement source since fiscal years vary (e.g. Apple=Sep)."""
    y, m = end_date[:4], end_date[5:7]
    if m == "12":
        return y, True
    q = {"03": "Q1", "06": "Q2", "09": "Q3"}.get(m, m)
    return f"{y}{q}", False


def _label(end_date: str, is_annual: bool) -> str:
    y, m = end_date[:4], end_date[5:7]
    if is_annual:
        return y
    q = {"03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4"}.get(m, m)
    return f"{y}{q}"


def _pct_dec(v) -> float | None:
    """Percent value -> decimal (32.5 -> 0.325)."""
    f = _safe_float(v)
    return f / 100.0 if f is not None else None


# ---------- US (yfinance) ---------------------------------------------------


def _row(df, *names: str):
    if df is None or getattr(df, "empty", True):
        return None
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def _us_financials(ticker: str) -> Financials:
    import yfinance as yf

    t = yf.Ticker(ticker.upper())
    fin = Financials(ticker=ticker.upper(), market="US", currency="USD", source="yfinance")

    def build(inc, bal, cf, limit: int, is_annual: bool) -> list[FinPeriod]:
        if inc is None or getattr(inc, "empty", True):
            return []
        r_rev = _row(inc, "Total Revenue", "Operating Revenue")
        r_gp = _row(inc, "Gross Profit")
        r_oi = _row(inc, "Operating Income", "Total Operating Income As Reported")
        r_ni = _row(inc, "Net Income", "Net Income Common Stockholders")
        r_eps = _row(inc, "Diluted EPS", "Basic EPS")
        r_ta = _row(bal, "Total Assets")
        r_tl = _row(bal, "Total Liabilities Net Minority Interest")
        r_te = _row(bal, "Stockholders Equity", "Total Equity Gross Minority Interest")
        r_cash = _row(bal, "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")
        r_debt = _row(bal, "Total Debt")
        r_ocf = _row(cf, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities")
        r_capex = _row(cf, "Capital Expenditure")
        r_fcf = _row(cf, "Free Cash Flow")

        def at(row, col):
            if row is None or col not in row.index:
                return None
            return _safe_float(row[col])

        periods: list[FinPeriod] = []
        for col in list(inc.columns)[:limit]:
            end = str(col)[:10]
            p = FinPeriod(
                period=_label(end, is_annual), end_date=end, is_annual=is_annual,
                revenue=at(r_rev, col), gross_profit=at(r_gp, col),
                operating_income=at(r_oi, col), net_income=at(r_ni, col), eps=at(r_eps, col),
                total_assets=at(r_ta, col), total_liabilities=at(r_tl, col),
                total_equity=at(r_te, col), cash=at(r_cash, col), total_debt=at(r_debt, col),
                operating_cash_flow=at(r_ocf, col), capex=at(r_capex, col), free_cash_flow=at(r_fcf, col),
            )
            # Skip all-empty columns (yfinance sometimes pads an extra blank year).
            if p.revenue is None and p.net_income is None and p.total_assets is None:
                continue
            periods.append(p)
        return periods

    try:
        fin.annual = build(t.income_stmt, t.balance_sheet, t.cashflow, 5, True)
    except Exception as e:
        log.warning("yfinance annual statements failed for %s: %s", ticker, e)
    try:
        fin.quarterly = build(t.quarterly_income_stmt, t.quarterly_balance_sheet, t.quarterly_cashflow, 6, False)
    except Exception as e:
        log.warning("yfinance quarterly statements failed for %s: %s", ticker, e)

    # Ratios from the latest annual period (fall back to latest quarter when
    # yfinance returns an empty annual frame, which happens intermittently).
    base = fin.annual or fin.quarterly
    if base:
        p = base[0]
        r: dict[str, float | None] = {}
        if p.revenue:
            if p.gross_profit is not None:
                r["gross_margin"] = p.gross_profit / p.revenue
            if p.operating_income is not None:
                r["operating_margin"] = p.operating_income / p.revenue
            if p.net_income is not None:
                r["net_margin"] = p.net_income / p.revenue
        if p.total_equity:
            r["roe"] = (p.net_income / p.total_equity) if p.net_income is not None else None
        if p.total_assets:
            r["roa"] = (p.net_income / p.total_assets) if p.net_income is not None else None
            if p.total_liabilities is not None:
                r["debt_to_assets"] = p.total_liabilities / p.total_assets
        fin.ratios = {k: v for k, v in r.items() if v is not None}

    if not fin.annual and not fin.quarterly:
        fin = _us_financials_akshare(ticker)
    return fin


def _us_financials_akshare(ticker: str) -> Financials:
    """Fallback for when yfinance is rate-limited (common on the VPS)."""
    import akshare as ak

    fin = Financials(ticker=ticker.upper(), market="US", currency="USD", source="akshare-us-em")
    try:
        ind = ak.stock_financial_us_analysis_indicator_em(symbol=ticker.upper())
    except Exception as e:
        log.warning("akshare US indicator fallback failed for %s: %s", ticker, e)
        return fin
    if ind is None or ind.empty:
        return fin
    ind = ind.head(6)
    periods: list[FinPeriod] = []
    for _, row in ind.iterrows():
        end = str(row.get("REPORT_DATE") or "")[:10]
        if not end:
            continue
        label, is_annual = _q_label(end)
        periods.append(FinPeriod(
            period=label, end_date=end, is_annual=is_annual,
            revenue=_safe_float(row.get("OPERATE_INCOME")),
            net_income=_safe_float(row.get("PARENT_HOLDER_NETPROFIT")),
            eps=_safe_float(row.get("BASIC_EPS")),
        ))
    fin.annual = [p for p in periods if p.is_annual] or periods
    fin.quarterly = [p for p in periods if not p.is_annual]
    return fin


# ---------- CN (akshare stock_financial_abstract) ---------------------------


def _cn_financials(ticker: str) -> Financials:
    import akshare as ak

    code = ticker.zfill(6)
    fin = Financials(ticker=code, market="CN", currency="CNY", source="akshare-abstract")
    absd = ak.stock_financial_abstract(symbol=code)
    if absd is None or absd.empty:
        return fin

    cols = list(absd.columns)
    ind_col = cols[1]
    date_cols = cols[2:]  # newest first
    by_ind: dict[str, object] = {}
    for _, r in absd.iterrows():
        by_ind.setdefault(r[ind_col], r)

    def val(name: str, col: str):
        row = by_ind.get(name)
        return _safe_float(row.get(col)) if row is not None else None

    roe_key = next((k for k in by_ind if k.startswith("净资产收益率") and "_" not in k and "摊薄" not in k), None)

    def make_period(col: str) -> FinPeriod:
        label, is_annual = _q_label(col[:4] + "-" + col[4:6] + "-" + col[6:8])
        revenue = val("营业总收入", col)
        cost = val("营业成本", col)
        gross = (revenue - cost) if (revenue is not None and cost is not None) else None
        op_margin = _pct_dec(val("营业利润率", col))
        op_income = (revenue * op_margin) if (revenue is not None and op_margin is not None) else None
        equity = val("股东权益合计(净资产)", col)
        dar = _pct_dec(val("资产负债率", col))
        total_assets = (equity / (1 - dar)) if (equity is not None and dar not in (None, 1)) else None
        total_liab = (total_assets - equity) if (total_assets is not None and equity is not None) else None
        return FinPeriod(
            period=label, end_date=col[:4] + "-" + col[4:6] + "-" + col[6:8], is_annual=is_annual,
            revenue=revenue, gross_profit=gross, operating_income=op_income,
            net_income=val("归母净利润", col), eps=val("基本每股收益", col),
            total_assets=total_assets, total_liabilities=total_liab, total_equity=equity,
            operating_cash_flow=val("经营现金流量净额", col),
        )

    annual_cols = [c for c in date_cols if c.endswith("1231")][:5]
    quarter_cols = [c for c in date_cols if not c.endswith("1231")][:6]
    fin.annual = [make_period(c) for c in annual_cols]
    fin.quarterly = [make_period(c) for c in quarter_cols]

    latest = date_cols[0] if date_cols else None
    if latest:
        fin.ratios = {k: v for k, v in {
            "roe": _pct_dec(val(roe_key, latest)) if roe_key else None,
            "roa": _pct_dec(val("总资产报酬率(ROA)", latest)),
            "gross_margin": _pct_dec(val("毛利率", latest)),
            "operating_margin": _pct_dec(val("营业利润率", latest)),
            "net_margin": _pct_dec(val("销售净利率", latest)),
            "debt_to_assets": _pct_dec(val("资产负债率", latest)),
            "current_ratio": _safe_float(val("流动比率", latest)),
            "quick_ratio": _safe_float(val("速动比率", latest)),
            "asset_turnover": _safe_float(val("总资产周转率", latest)),
            "inventory_turnover": _safe_float(val("存货周转率", latest)),
            "revenue_yoy": _pct_dec(val("营业总收入增长率", latest)),
            "net_income_yoy": _pct_dec(val("归属母公司净利润增长率", latest)),
        }.items() if v is not None}
    return fin


# ---------- HK (akshare) ----------------------------------------------------


def _hk_financials(ticker: str) -> Financials:
    import akshare as ak

    code = ticker.strip().upper().replace("HK", "").zfill(5)
    fin = Financials(ticker=code, market="HK", currency=None, source="akshare-hk-em")

    try:
        ind = ak.stock_financial_hk_analysis_indicator_em(symbol=code, indicator="年度")
    except Exception as e:
        log.warning("akshare HK indicator failed for %s: %s", code, e)
        ind = None

    income_by_end: dict[str, FinPeriod] = {}
    if ind is not None and not ind.empty:
        if "CURRENCY" in ind.columns and len(ind):
            fin.currency = str(ind.iloc[0].get("CURRENCY") or "") or None
        for _, row in ind.head(5).iterrows():
            end = str(row.get("REPORT_DATE") or "")[:10]
            if not end:
                continue
            income_by_end[end] = FinPeriod(
                period=_label(end, True), end_date=end, is_annual=True,
                revenue=_safe_float(row.get("OPERATE_INCOME")),
                gross_profit=_safe_float(row.get("GROSS_PROFIT")),
                net_income=_safe_float(row.get("HOLDER_PROFIT")),
                eps=_safe_float(row.get("BASIC_EPS")),
            )
        latest = ind.iloc[0]
        fin.ratios = {k: v for k, v in {
            "roe": _pct_dec(latest.get("ROE_AVG")),
            "roa": _pct_dec(latest.get("ROA")),
            "gross_margin": _pct_dec(latest.get("GROSS_PROFIT_RATIO")),
            "net_margin": _pct_dec(latest.get("NET_PROFIT_RATIO")),
            "debt_to_assets": _pct_dec(latest.get("DEBT_ASSET_RATIO")),
            "current_ratio": _safe_float(latest.get("CURRENT_RATIO")),
            "revenue_yoy": _pct_dec(latest.get("OPERATE_INCOME_YOY")),
            "net_income_yoy": _pct_dec(latest.get("HOLDER_PROFIT_YOY")),
        }.items() if v is not None}

    # Enrich balance-sheet amounts (total assets / cash) from the report table.
    try:
        bs = ak.stock_financial_hk_report_em(stock=code, symbol="资产负债表", indicator="年度")
        if bs is not None and not bs.empty:
            for end, grp in bs.groupby(bs["REPORT_DATE"].astype(str).str[:10]):
                if end not in income_by_end:
                    continue
                items = dict(zip(grp["STD_ITEM_NAME"], grp["AMOUNT"]))
                p = income_by_end[end]
                p.total_assets = _safe_float(items.get("总资产"))
                p.cash = _safe_float(items.get("现金及等价物"))
                ta, eq_item = p.total_assets, _safe_float(items.get("股东权益") or items.get("权益总额"))
                if eq_item is not None:
                    p.total_equity = eq_item
                    if ta is not None:
                        p.total_liabilities = ta - eq_item
    except Exception as e:
        log.warning("akshare HK balance report failed for %s: %s", code, e)

    ordered = sorted(income_by_end.values(), key=lambda p: p.end_date, reverse=True)
    fin.annual = ordered[:5]
    return fin


# ---------- public API ------------------------------------------------------


def get_financials(ticker: str, market: Market) -> Financials:
    key = f"{market}:{ticker.strip().upper()}"
    hit = _CACHE.get(key)
    if hit and (time.time() - hit[0]) < _TTL_SECONDS:
        return hit[1]
    if market == "US":
        fin = _us_financials(ticker)
    elif market == "CN":
        fin = _cn_financials(ticker)
    elif market == "HK":
        fin = _hk_financials(ticker)
    else:
        raise ValueError(f"unsupported market: {market!r}")
    _CACHE[key] = (time.time(), fin)
    return fin


def format_for_prompt(fin: Financials) -> str:
    """Compact, model-readable multi-period statement block."""
    if not fin.annual and not fin.quarterly:
        return ""
    cur = fin.currency or ""

    def money(v: float | None) -> str:
        if v is None:
            return "n/a"
        a = abs(v)
        if a >= 1e8:
            return f"{v/1e8:.2f}亿"
        if a >= 1e4:
            return f"{v/1e4:.2f}万"
        return f"{v:.2f}"

    def line(p: FinPeriod) -> str:
        return (
            f"  {p.period}: 营收 {money(p.revenue)} · 毛利 {money(p.gross_profit)} · "
            f"营业利润 {money(p.operating_income)} · 净利 {money(p.net_income)} · EPS {p.eps if p.eps is not None else 'n/a'} · "
            f"总资产 {money(p.total_assets)} · 负债 {money(p.total_liabilities)} · 权益 {money(p.total_equity)} · "
            f"现金 {money(p.cash)} · 有息负债 {money(p.total_debt)} · 经营现金流 {money(p.operating_cash_flow)} · "
            f"资本开支 {money(p.capex)} · FCF {money(p.free_cash_flow)}"
        )

    parts = [f"## 财务报表(多期,单位原币 {cur},source: {fin.source})"]
    if fin.annual:
        parts.append("年报(新→旧):")
        parts += [line(p) for p in fin.annual]
    if fin.quarterly:
        parts.append("季报(新→旧):")
        parts += [line(p) for p in fin.quarterly[:4]]
    if fin.ratios:
        rs = " · ".join(
            f"{k}={v*100:.2f}%" if k.endswith(("margin", "roe", "roa", "yoy", "to_assets")) else f"{k}={v:.2f}"
            for k, v in fin.ratios.items()
        )
        parts.append(f"最新比率:{rs}")
    return "\n".join(parts) + "\n"
