"""Explainable, rule-based A-share candidate ranking.

This is a research screener, not an order signal. It deliberately uses only
fields visible to the user so every score can be reproduced and challenged.
"""
from __future__ import annotations

import math
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Literal

from pydantic import BaseModel

from app.services import db
from app.services.market_data import _pct, _safe_float, get_cn_spot

Profile = Literal["conservative", "balanced", "aggressive"]

_CACHE: dict[str, tuple[float, "RecommendationResponse"]] = {}
_TTL = 180


class ScoreBreakdown(BaseModel):
    liquidity: float
    momentum: float
    valuation: float
    stability: float


class TradePlan(BaseModel):
    signal: Literal["watch", "wait", "consider"]
    signal_label: str
    entry_low: float
    entry_high: float
    stop_price: float
    target_price: float
    expected_upside_pct: float
    max_risk_pct: float
    reward_risk_ratio: float
    holding_period: str
    position_hint: str
    invalidation: str


class Recommendation(BaseModel):
    ticker: str
    name: str
    industry: str
    market: str = "CN"
    price: float
    change_pct: float
    amount: float
    turnover_rate: float | None = None
    pe: float | None = None
    pb: float | None = None
    amplitude: float | None = None
    score: float
    score_breakdown: ScoreBreakdown
    thesis: str
    trade_plan: TradePlan
    reasons: list[str]
    risks: list[str]


class PerformanceWindow(BaseModel):
    trading_days: int
    sample_size: int
    win_rate: float | None = None
    average_return: float | None = None
    status: str


class RecommendationPerformance(BaseModel):
    tracking_since: str | None = None
    total_signals: int = 0
    methodology: str
    windows: list[PerformanceWindow]


class RecommendationResponse(BaseModel):
    profile: Profile
    industry: str | None = None
    available_industries: list[str]
    as_of: str
    candidates: list[Recommendation]
    universe_size: int
    eligible_size: int
    performance: RecommendationPerformance
    methodology: str
    disclaimer: str


def _field(row: Any, *names: str) -> Any:
    for name in names:
        value = row.get(name)
        if value is not None:
            return value
    return None


def _clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def _score_row(
    row: Any,
    profile: Profile,
    industry_map: dict[str, str] | None = None,
) -> Recommendation | None:
    ticker = re.sub(r"\D", "", str(row.get("代码") or ""))
    name = str(row.get("名称") or "").strip()
    industry = str(
        _field(row, "行业", "所属行业")
        or (industry_map or {}).get(ticker)
        or "其他"
    ).strip()
    price = _safe_float(row.get("最新价"))
    amount = _safe_float(row.get("成交额"))
    change = _pct(row.get("涨跌幅"))
    if not ticker or not name or price is None or price <= 0 or amount is None or change is None:
        return None
    if "ST" in name.upper() or name.startswith("退") or ticker.startswith(("4", "8")):
        return None

    change_pct = change * 100
    turnover = _safe_float(_field(row, "换手率"))
    pe = _safe_float(_field(row, "市盈率-动态", "市盈率"))
    pb = _safe_float(_field(row, "市净率"))
    amplitude = _safe_float(_field(row, "振幅"))

    minimum_amount = {"conservative": 5e8, "balanced": 2e8, "aggressive": 1e8}[profile]
    change_range = {
        "conservative": (-1.0, 4.0),
        "balanced": (0.0, 6.0),
        "aggressive": (1.0, 8.0),
    }[profile]
    if amount < minimum_amount or not (change_range[0] <= change_pct <= change_range[1]):
        return None

    liquidity = _clamp((math.log10(max(amount, 1)) - 8) * 42)
    momentum_peak = {"conservative": 1.5, "balanced": 3.0, "aggressive": 5.0}[profile]
    momentum = _clamp(100 - abs(change_pct - momentum_peak) * 18)
    valuation_parts = []
    if pe is not None and pe > 0:
        valuation_parts.append(_clamp(100 - abs(pe - 22) * 2.2))
    if pb is not None and pb > 0:
        valuation_parts.append(_clamp(100 - abs(pb - 2.5) * 12))
    valuation = sum(valuation_parts) / len(valuation_parts) if valuation_parts else 50
    stability = _clamp(100 - max((amplitude or 4) - 3, 0) * 10)

    weights = {
        "conservative": (0.30, 0.15, 0.30, 0.25),
        "balanced": (0.30, 0.30, 0.20, 0.20),
        "aggressive": (0.25, 0.50, 0.10, 0.15),
    }[profile]
    total = sum(v * w for v, w in zip((liquidity, momentum, valuation, stability), weights))

    reasons = [
        f"成交额 {amount / 1e8:.1f} 亿元，流动性通过筛选",
        f"当日涨幅 {change_pct:+.2f}%，处于{profile}档动量区间",
    ]
    if pe is not None and 0 < pe <= 35:
        reasons.append(f"动态市盈率 {pe:.1f}，未触发高估值过滤")

    risks = []
    if change_pct >= 5:
        risks.append("短线涨幅较高，需防止追涨回撤")
    if turnover is not None and turnover >= 15:
        risks.append(f"换手率 {turnover:.1f}% 偏高，筹码波动可能较大")
    if pe is not None and (pe <= 0 or pe > 50):
        risks.append("市盈率异常或偏高，基本面需进一步核验")
    if amplitude is not None and amplitude >= 8:
        risks.append(f"振幅 {amplitude:.1f}% 偏高")
    if not risks:
        risks.append("规则只使用当日行情与估值快照，未覆盖公告和突发消息")

    # A plan is intentionally conservative: strong same-day moves are not
    # converted into "buy now" instructions. Prices are deterministic and can
    # therefore be saved and audited later.
    target_pct = {"conservative": 0.12, "balanced": 0.18, "aggressive": 0.24}[profile]
    stop_pct = {"conservative": 0.05, "balanced": 0.07, "aggressive": 0.09}[profile]
    if change_pct >= 4.5:
        signal = "wait"
        signal_label = "等待回调"
        entry_high = price * 0.98
        entry_low = price * 0.94
    elif total >= 72 and (amplitude is None or amplitude < 8):
        signal = "consider"
        signal_label = "可考虑试仓"
        entry_low = price * 0.985
        entry_high = price * 1.005
    else:
        signal = "watch"
        signal_label = "进入观察"
        entry_low = price * 0.96
        entry_high = price * 0.99
    stop_price = entry_low * (1 - stop_pct)
    target_price = entry_high * (1 + target_pct)
    expected_upside = (target_price / entry_high - 1) * 100
    max_risk = (entry_high / stop_price - 1) * 100
    reward_risk = expected_upside / max_risk if max_risk else 0
    holding_period = {
        "conservative": "20–60 个交易日",
        "balanced": "15–45 个交易日",
        "aggressive": "5–20 个交易日",
    }[profile]
    thesis = (
        f"{industry}行业候选；流动性与适度动量通过筛选，"
        f"估值分 {valuation:.0f}、稳定性分 {stability:.0f}。"
    )
    plan = TradePlan(
        signal=signal,
        signal_label=signal_label,
        entry_low=round(entry_low, 2),
        entry_high=round(entry_high, 2),
        stop_price=round(stop_price, 2),
        target_price=round(target_price, 2),
        expected_upside_pct=round(expected_upside, 1),
        max_risk_pct=round(max_risk, 1),
        reward_risk_ratio=round(reward_risk, 1),
        holding_period=holding_period,
        position_hint="首次试仓不超过总资产的 5%，确认后再分批增加",
        invalidation=f"收盘跌破 ¥{stop_price:.2f}，或基本面/公告出现与入选逻辑相反的变化",
    )

    return Recommendation(
        ticker=ticker,
        name=name,
        industry=industry,
        price=price,
        change_pct=round(change_pct, 2),
        amount=amount,
        turnover_rate=turnover,
        pe=pe,
        pb=pb,
        amplitude=amplitude,
        score=round(total, 1),
        score_breakdown=ScoreBreakdown(
            liquidity=round(liquidity, 1),
            momentum=round(momentum, 1),
            valuation=round(valuation, 1),
            stability=round(stability, 1),
        ),
        thesis=thesis,
        trade_plan=plan,
        reasons=reasons,
        risks=risks,
    )


def _record_and_measure(
    profile: Profile,
    candidates: list[Recommendation],
    all_prices: dict[str, float],
    now: datetime,
) -> RecommendationPerformance:
    date = now.date().isoformat()
    created_at = now.isoformat()
    db.executemany(
        """INSERT OR IGNORE INTO recommendation_price_snap
           (date, ticker, price, created_at) VALUES (?, ?, ?, ?)""",
        [(date, ticker, price, created_at) for ticker, price in all_prices.items()],
    )
    db.executemany(
        """INSERT OR IGNORE INTO recommendation_snap
           (date, profile, ticker, name, industry, rank, score, signal, price,
            entry_low, entry_high, stop_price, target_price, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                date, profile, item.ticker, item.name, item.industry, rank,
                item.score, item.trade_plan.signal, item.price,
                item.trade_plan.entry_low, item.trade_plan.entry_high,
                item.trade_plan.stop_price, item.trade_plan.target_price, created_at,
            )
            for rank, item in enumerate(candidates, 1)
        ],
    )
    first = db.query_one("SELECT MIN(date) AS date FROM recommendation_snap")
    total = db.query_one(
        "SELECT COUNT(*) AS n FROM recommendation_snap WHERE profile = ?",
        (profile,),
    )
    windows: list[PerformanceWindow] = []
    for trading_days in (5, 20, 60):
        # nth later observed market date approximates trading days and naturally
        # skips weekends/holidays. Only matured rows enter the denominator.
        rows = db.query_all(
            """SELECT r.price AS start_price,
                      (SELECT p.price FROM recommendation_price_snap p
                       WHERE p.ticker = r.ticker AND p.date > r.date
                       ORDER BY p.date LIMIT 1 OFFSET ?) AS end_price
               FROM recommendation_snap r
              WHERE r.profile = ?""",
            (trading_days - 1, profile),
        )
        returns = [
            (float(row["end_price"]) / float(row["start_price"]) - 1) * 100
            for row in rows
            if row["end_price"] is not None and row["start_price"]
        ]
        windows.append(
            PerformanceWindow(
                trading_days=trading_days,
                sample_size=len(returns),
                win_rate=round(sum(value > 0 for value in returns) / len(returns) * 100, 1)
                if returns else None,
                average_return=round(sum(returns) / len(returns), 2) if returns else None,
                status="已形成真实样本" if returns else "样本积累中",
            )
        )
    return RecommendationPerformance(
        tracking_since=first["date"] if first and first["date"] else None,
        total_signals=int(total["n"]) if total else 0,
        methodology="按推荐当日可见价格记录，使用第 5/20/60 个后续交易日价格计算；不回填、不删除失败样本。",
        windows=windows,
    )


def rank_rows(
    rows: Iterable[Any],
    profile: Profile = "balanced",
    limit: int = 10,
    industry_map: dict[str, str] | None = None,
    max_per_industry: int = 2,
    industry: str | None = None,
) -> tuple[list[Recommendation], int]:
    candidates = [
        candidate
        for row in rows
        if (candidate := _score_row(row, profile, industry_map)) is not None
    ]
    if industry:
        candidates = [candidate for candidate in candidates if candidate.industry == industry]
    candidates.sort(key=lambda item: (-item.score, -item.amount, item.ticker))

    if industry:
        return candidates[:limit], len(candidates)

    selected: list[Recommendation] = []
    industry_counts: dict[str, int] = {}
    for candidate in candidates:
        # Unknown classifications should not collapse the entire result into one
        # synthetic industry when the upstream industry feed is unavailable.
        if candidate.industry != "其他":
            count = industry_counts.get(candidate.industry, 0)
            if count >= max_per_industry:
                continue
            industry_counts[candidate.industry] = count + 1
        selected.append(candidate)
        if len(selected) >= limit:
            break
    return selected, len(candidates)


def get_recommendations(
    profile: Profile = "balanced",
    limit: int = 10,
    industry: str | None = None,
) -> RecommendationResponse:
    normalized_industry = industry.strip() if industry else None
    cache_key = f"{profile}:{limit}:{normalized_industry or 'all'}"
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _TTL:
        return cached[1]

    df = get_cn_spot()
    if df is None or getattr(df, "empty", True):
        raise ValueError("A股行情暂不可用")
    try:
        from app.services.hotspot import _industry_map

        industry_map = _industry_map()
    except Exception:
        industry_map = {}
    rows = [row for _, row in df.iterrows()]
    candidates, eligible_size = rank_rows(
        rows,
        profile,
        limit,
        industry_map=industry_map,
        industry=normalized_industry,
    )
    available_industries = sorted({value for value in industry_map.values() if value})
    now = datetime.now(timezone.utc) + timedelta(hours=8)
    as_of = now.isoformat()
    all_prices = {
        re.sub(r"\D", "", str(row.get("代码") or "")): price
        for row in rows
        if (price := _safe_float(row.get("最新价"))) is not None and price > 0
    }
    # Industry drill-downs are exploratory views, not additional published
    # signals. Counting them would let repeated filters inflate the scorecard.
    performance = _record_and_measure(
        profile,
        candidates if normalized_industry is None else [],
        all_prices,
        now,
    )
    result = RecommendationResponse(
        profile=profile,
        industry=normalized_industry,
        available_industries=available_industries,
        as_of=as_of,
        candidates=candidates,
        universe_size=len(df),
        eligible_size=eligible_size,
        performance=performance,
        methodology=(
            f"仅在“{normalized_industry}”行业内，剔除 ST、退市及北交所股票后，"
            "按流动性、适度动量、估值和波动稳定性加权排名。"
            if normalized_industry
            else "剔除 ST、退市及北交所股票后，按流动性、适度动量、估值和波动稳定性评分；"
            "全部行业榜再做分散处理，每个行业最多 2 只。"
        ),
        disclaimer="仅供研究和模拟验证，不构成投资建议；历史与当日信号不代表未来收益。",
    )
    _CACHE[cache_key] = (time.time(), result)
    return result
