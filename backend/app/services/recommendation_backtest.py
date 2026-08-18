"""Point-in-time-safe historical validation for recommendation price rules.

Only information available on the signal date is allowed.  Fundamentals are
therefore included only when a dated snapshot exists in the offline research
store; today's PE/PB is never projected backwards.
"""
from __future__ import annotations

import math
import time
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from app.services.market_data import _safe_float

Profile = Literal["conservative", "balanced", "aggressive"]

_CACHE: dict[str, tuple[float, "BacktestResponse"]] = {}
_TTL = 6 * 60 * 60


class PriceBar(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class BacktestWindow(BaseModel):
    trading_days: int
    sample_size: int
    positive_rate: float | None = None
    average_return: float | None = None
    median_return: float | None = None
    benchmark_return: float | None = None
    excess_return: float | None = None


class ForwardOutcome(BaseModel):
    trading_days: int
    date: str
    price: float
    return_pct: float
    benchmark_return_pct: float | None = None
    excess_return_pct: float | None = None


class BacktestTrade(BaseModel):
    ticker: str
    name: str
    signal_date: str
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    exit_reason: Literal["target", "stop", "time", "open"]
    exit_reason_label: str
    holding_days: int
    return_pct: float
    benchmark_return_pct: float | None = None
    excess_return_pct: float | None = None
    forward_outcomes: list[ForwardOutcome]


class EquityPoint(BaseModel):
    date: str
    strategy: float
    benchmark: float | None = None


class ExecutionStats(BaseModel):
    suspended: int = 0
    limit_locked: int = 0
    invalid_open: int = 0


class BenchmarkSummary(BaseModel):
    ticker: str
    name: str
    return_pct: float | None = None
    annualized_return_pct: float | None = None
    max_drawdown_pct: float | None = None
    excess_return_pct: float | None = None


class BacktestResponse(BaseModel):
    profile: Profile
    years: int
    as_of: str
    universe: list[str]
    stock_names: dict[str, str]
    signals: int
    target_first_rate: float | None = None
    stop_first_rate: float | None = None
    average_trade_return: float | None = None
    max_drawdown: float | None = None
    transaction_cost_pct: float
    slippage_pct: float
    benchmark: BenchmarkSummary | None = None
    portfolio_return: float | None = None
    portfolio_annualized_return: float | None = None
    equity_curve: list[EquityPoint] = Field(default_factory=list)
    execution_stats: ExecutionStats = Field(default_factory=ExecutionStats)
    fundamentals_coverage_pct: float = 0
    windows: list[BacktestWindow]
    trades: list[BacktestTrade]
    methodology: str
    limitations: list[str]


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _max_drawdown(values: list[float]) -> float | None:
    if not values:
        return None
    peak = values[0]
    drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        if peak:
            drawdown = min(drawdown, value / peak - 1)
    return drawdown * 100


def _board_limit(ticker: str) -> float:
    if ticker.startswith(("300", "301", "688")):
        return 0.20
    if ticker.startswith(("4", "8")):
        return 0.30
    return 0.10


def _benchmark_return(
    benchmark_by_date: dict[str, PriceBar],
    start_date: str,
    end_date: str,
) -> float | None:
    start = benchmark_by_date.get(start_date)
    end = benchmark_by_date.get(end_date)
    if not start or not end or start.close <= 0:
        return None
    return (end.close / start.close - 1) * 100


def simulate_price_rules(
    histories: dict[str, list[PriceBar]],
    profile: Profile,
    transaction_cost_pct: float = 0.18,
    slippage_pct: float = 0.05,
    stock_names: dict[str, str] | None = None,
    benchmark_bars: list[PriceBar] | None = None,
    benchmark_ticker: str = "000300",
    benchmark_name: str = "沪深300",
) -> BacktestResponse:
    """Walk forward using only bars available before each next-open entry."""
    target_pct = {"conservative": 0.12, "balanced": 0.18, "aggressive": 0.24}[profile]
    stop_pct = {"conservative": 0.05, "balanced": 0.07, "aggressive": 0.09}[profile]
    daily_range = {
        "conservative": (-0.01, 0.04),
        "balanced": (0.00, 0.06),
        "aggressive": (0.01, 0.08),
    }[profile]
    forward: dict[int, list[float]] = {5: [], 20: [], 60: []}
    trade_returns: list[float] = []
    equity_returns: list[float] = []
    target_first = 0
    stop_first = 0
    total_signals = 0
    trades: list[BacktestTrade] = []
    execution_stats = ExecutionStats()
    benchmark_by_date = {bar.date: bar for bar in (benchmark_bars or [])}
    window_benchmark: dict[int, list[float]] = {5: [], 20: [], 60: []}

    names = stock_names or {ticker: ticker for ticker in histories}
    for ticker, bars in histories.items():
        if len(bars) < 121:
            continue
        next_eligible = 60
        for index in range(60, len(bars) - 1):
            if index < next_eligible:
                continue
            closes = [bar.close for bar in bars[index - 59:index + 1]]
            current = bars[index]
            previous = bars[index - 1]
            if not previous.close or min(closes) <= 0:
                continue
            day_change = current.close / previous.close - 1
            ma20 = sum(closes[-20:]) / 20
            ma60 = sum(closes) / 60
            returns20 = current.close / closes[-21] - 1
            log_returns = [
                math.log(closes[offset] / closes[offset - 1])
                for offset in range(1, len(closes))
                if closes[offset - 1] > 0
            ]
            volatility = (
                math.sqrt(sum(value * value for value in log_returns[-20:]) / 20) * math.sqrt(252)
                if len(log_returns) >= 20 else 1
            )
            # Moderate trend confirmation, no same-close execution.
            if not (
                daily_range[0] <= day_change <= daily_range[1]
                and current.close > ma20 > ma60
                and 0.02 <= returns20 <= 0.25
                and volatility <= (0.42 if profile == "aggressive" else 0.34)
            ):
                continue

            entry_index = index + 1
            entry_bar = bars[entry_index]
            if entry_bar.volume <= 0:
                execution_stats.suspended += 1
                continue
            if entry_bar.open >= current.close * (1 + _board_limit(ticker) - 0.001):
                execution_stats.limit_locked += 1
                continue
            entry = entry_bar.open * (1 + slippage_pct / 100)
            if entry <= 0:
                execution_stats.invalid_open += 1
                continue
            total_signals += 1
            stop = entry * (1 - stop_pct)
            target = entry * (1 + target_pct)
            exit_return = None
            exit_price = entry
            exit_date = bars[entry_index].date
            exit_reason: Literal["target", "stop", "time"] = "time"
            exit_cursor = entry_index
            max_horizon = min(entry_index + 60, len(bars) - 1)
            for cursor in range(entry_index, max_horizon + 1):
                bar = bars[cursor]
                # Conservative convention when both are touched intraday.
                if bar.low <= stop:
                    stop_first += 1
                    exit_price = stop * (1 - slippage_pct / 100)
                    exit_return = (exit_price / entry - 1) * 100 - transaction_cost_pct
                    exit_date = bar.date
                    exit_reason = "stop"
                    exit_cursor = cursor
                    break
                if bar.high >= target:
                    target_first += 1
                    exit_price = target * (1 - slippage_pct / 100)
                    exit_return = (exit_price / entry - 1) * 100 - transaction_cost_pct
                    exit_date = bar.date
                    exit_reason = "target"
                    exit_cursor = cursor
                    break
            if exit_return is None:
                exit_price = bars[max_horizon].close * (1 - slippage_pct / 100)
                exit_date = bars[max_horizon].date
                exit_cursor = max_horizon
                exit_return = (
                    exit_price / entry - 1
                ) * 100 - transaction_cost_pct
            is_open = exit_reason == "time" and max_horizon < entry_index + 60
            if is_open:
                exit_reason = "open"
            else:
                trade_returns.append(exit_return)
                equity_returns.append(exit_return / 100)
            outcomes: list[ForwardOutcome] = []
            for horizon in forward:
                end_index = entry_index + horizon - 1
                if end_index < len(bars):
                    value = (bars[end_index].close / entry - 1) * 100 - transaction_cost_pct
                    forward[horizon].append(value)
                    benchmark_value = _benchmark_return(
                        benchmark_by_date, bars[entry_index].date, bars[end_index].date
                    )
                    if benchmark_value is not None:
                        window_benchmark[horizon].append(benchmark_value)
                    outcomes.append(
                        ForwardOutcome(
                            trading_days=horizon,
                            date=bars[end_index].date,
                            price=round(bars[end_index].close, 2),
                            return_pct=round(value, 2),
                            benchmark_return_pct=round(benchmark_value, 2)
                            if benchmark_value is not None else None,
                            excess_return_pct=round(value - benchmark_value, 2)
                            if benchmark_value is not None else None,
                        )
                    )
            trade_benchmark = _benchmark_return(
                benchmark_by_date, bars[entry_index].date, exit_date
            )
            trades.append(
                BacktestTrade(
                    ticker=ticker,
                    name=names.get(ticker, ticker),
                    signal_date=current.date,
                    entry_date=bars[entry_index].date,
                    entry_price=round(entry, 2),
                    exit_date=exit_date,
                    exit_price=round(exit_price, 2),
                    exit_reason=exit_reason,
                    exit_reason_label={
                        "target": "达到目标",
                        "stop": "触发止损",
                        "time": "持有到期",
                        "open": "仍在观察",
                    }[exit_reason],
                    holding_days=exit_cursor - entry_index + 1,
                    return_pct=round(exit_return, 2),
                    benchmark_return_pct=round(trade_benchmark, 2)
                    if trade_benchmark is not None else None,
                    excess_return_pct=round(exit_return - trade_benchmark, 2)
                    if trade_benchmark is not None else None,
                    forward_outcomes=outcomes,
                )
            )
            # Prevent overlapping positions in the same stock.
            next_eligible = entry_index + 20

    # A dated, equal-risk portfolio ledger. At most ten positions can be active;
    # unused slots remain cash, avoiding the old serial-trade drawdown shortcut.
    dated_returns: dict[str, list[float]] = {}
    completed_trades = [trade for trade in trades if trade.exit_reason != "open"]
    for trade in trades:
        if trade.exit_reason == "open":
            continue
        dated_returns.setdefault(trade.exit_date, []).append(trade.return_pct / 100)
    equity = 1.0
    equity_curve: list[EquityPoint] = []
    portfolio_start_date = min((trade.entry_date for trade in completed_trades), default=None)
    portfolio_end_date = max((trade.exit_date for trade in completed_trades), default=None)
    benchmark_start_bar = benchmark_by_date.get(portfolio_start_date) if portfolio_start_date else None
    for event_date in sorted(dated_returns):
        equity *= 1 + sum(dated_returns[event_date]) / 10
        benchmark_level = None
        if benchmark_start_bar:
            first = benchmark_start_bar.close
            current_bar = benchmark_by_date.get(event_date)
            if first > 0 and current_bar:
                benchmark_level = current_bar.close / first
        equity_curve.append(
            EquityPoint(
                date=event_date,
                strategy=round(equity, 5),
                benchmark=round(benchmark_level, 5) if benchmark_level is not None else None,
            )
        )
    portfolio_drawdown = _max_drawdown([point.strategy for point in equity_curve])
    portfolio_return = (equity - 1) * 100 if equity_curve else None
    elapsed_years = 0.0
    if len(equity_curve) > 1:
        elapsed_years = max(
            (date.fromisoformat(equity_curve[-1].date) - date.fromisoformat(equity_curve[0].date)).days / 365.25,
            1 / 365.25,
        )
    portfolio_annualized = (
        (equity ** (1 / elapsed_years) - 1) * 100 if elapsed_years > 0 and equity > 0 else None
    )
    benchmark_summary = None
    if benchmark_bars:
        benchmark_values = [
            bar.close for bar in benchmark_bars
            if bar.close > 0
            and (not portfolio_start_date or bar.date >= portfolio_start_date)
            and (not portfolio_end_date or bar.date <= portfolio_end_date)
        ]
        benchmark_start = benchmark_by_date.get(portfolio_start_date) if portfolio_start_date else None
        benchmark_end = benchmark_by_date.get(portfolio_end_date) if portfolio_end_date else None
        benchmark_return = (
            (benchmark_end.close / benchmark_start.close - 1) * 100
            if benchmark_start and benchmark_end and benchmark_start.close > 0 else None
        )
        benchmark_elapsed_years = (
            max(
                (date.fromisoformat(portfolio_end_date) - date.fromisoformat(portfolio_start_date)).days / 365.25,
                1 / 365.25,
            )
            if portfolio_start_date and portfolio_end_date else 0
        )
        benchmark_annualized = (
            ((1 + benchmark_return / 100) ** (1 / benchmark_elapsed_years) - 1) * 100
            if benchmark_return is not None and benchmark_elapsed_years > 0 and benchmark_return > -100 else None
        )
        benchmark_summary = BenchmarkSummary(
            ticker=benchmark_ticker,
            name=benchmark_name,
            return_pct=round(benchmark_return, 2) if benchmark_return is not None else None,
            annualized_return_pct=round(benchmark_annualized, 2) if benchmark_annualized is not None else None,
            max_drawdown_pct=round(_max_drawdown(benchmark_values), 2),
            excess_return_pct=round(portfolio_return - benchmark_return, 2)
            if portfolio_return is not None and benchmark_return is not None else None,
        )

    windows = []
    for horizon, values in forward.items():
        windows.append(
            BacktestWindow(
                trading_days=horizon,
                sample_size=len(values),
                positive_rate=round(sum(value > 0 for value in values) / len(values) * 100, 1)
                if values else None,
                average_return=round(sum(values) / len(values), 2) if values else None,
                median_return=round(_median(values), 2) if values else None,
                benchmark_return=round(sum(window_benchmark[horizon]) / len(window_benchmark[horizon]), 2)
                if window_benchmark[horizon] else None,
                excess_return=round(
                    sum(values) / len(values) - sum(window_benchmark[horizon]) / len(window_benchmark[horizon]), 2
                ) if values and window_benchmark[horizon] else None,
            )
        )
    return BacktestResponse(
        profile=profile,
        years=0,
        as_of=date.today().isoformat(),
        universe=list(histories),
        stock_names=stock_names or {ticker: ticker for ticker in histories},
        signals=total_signals,
        target_first_rate=round(target_first / total_signals * 100, 1) if total_signals else None,
        stop_first_rate=round(stop_first / total_signals * 100, 1) if total_signals else None,
        average_trade_return=round(sum(trade_returns) / len(trade_returns), 2)
        if trade_returns else None,
        max_drawdown=round(portfolio_drawdown, 2) if portfolio_drawdown is not None else None,
        transaction_cost_pct=transaction_cost_pct,
        slippage_pct=slippage_pct,
        benchmark=benchmark_summary,
        portfolio_return=round(portfolio_return, 2) if portfolio_return is not None else None,
        portfolio_annualized_return=round(portfolio_annualized, 2)
        if portfolio_annualized is not None else None,
        equity_curve=equity_curve,
        execution_stats=execution_stats,
        windows=windows,
        trades=sorted(trades, key=lambda item: (item.entry_date, item.ticker), reverse=True),
        methodology=(
            "使用前复权日线；信号仅使用当日及此前60个交易日数据，下一交易日开盘成交；"
            "同股信号至少间隔20日；停牌或一字涨停不可成交；同日触及止损和目标时按止损处理；"
            "成交价计入滑点，收益另扣双边交易成本；组合按10个等风险槽位、未使用资金留作现金。"
        ),
        limitations=[
            "自由选股模式仍存在用户选择偏差；全市场截面模式需先完成离线历史数据集。",
            "历史 PE、PB、财报仅在公告日快照存在时才允许参与；当前请求无快照时覆盖率为0，不用今日数据回填。",
            "涨跌停按板块常规比例近似，未识别历史 ST 状态；滑点是固定假设，不代表大额成交冲击。",
            "历史结果不代表未来收益。",
        ],
    )


def _load_history(ticker: str, years: int) -> list[PriceBar]:
    import akshare as ak

    code = ticker.zfill(6)
    prefix = "sh" if code.startswith("6") else "sz"
    end = date.today()
    start = end - timedelta(days=years * 366 + 120)
    frame = ak.stock_zh_a_daily(
        symbol=f"{prefix}{code}",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="qfq",
    )
    if frame is None or frame.empty:
        return []
    result = []
    for _, row in frame.iterrows():
        values = [_safe_float(row.get(key)) for key in ("open", "high", "low", "close", "volume")]
        if any(value is None for value in values) or min(values[:4]) <= 0:
            continue
        result.append(
            PriceBar(
                date=str(row.get("date"))[:10],
                open=values[0],
                high=values[1],
                low=values[2],
                close=values[3],
                volume=values[4],
            )
        )
    return result


def _load_benchmark(years: int) -> list[PriceBar]:
    """Load CSI 300 without adjustment for excess-return comparison."""
    import akshare as ak

    end = date.today()
    start = end - timedelta(days=years * 366 + 120)
    frame = ak.stock_zh_index_daily(symbol="sh000300")
    if frame is None or frame.empty:
        return []
    result = []
    for _, row in frame.iterrows():
        raw_date = str(row.get("date"))[:10]
        if raw_date < start.isoformat() or raw_date > end.isoformat():
            continue
        values = [_safe_float(row.get(key)) for key in ("open", "high", "low", "close", "volume")]
        if any(value is None for value in values) or min(values[:4]) <= 0:
            continue
        result.append(
            PriceBar(
                date=raw_date,
                open=values[0],
                high=values[1],
                low=values[2],
                close=values[3],
                volume=values[4],
            )
        )
    return result


def get_price_backtest(
    profile: Profile = "balanced",
    years: int = 3,
    limit: int = 10,
    tickers: list[str] | None = None,
    industry: str | None = None,
) -> BacktestResponse:
    from app.services.recommendations import get_recommendations

    normalized = sorted({ticker.zfill(6) for ticker in (tickers or [])})
    key = f"{profile}:{years}:{limit}:{industry or 'all'}:{','.join(normalized) or 'auto'}"
    cached = _CACHE.get(key)
    if cached and time.time() - cached[0] < _TTL:
        return cached[1]
    recommendations = get_recommendations(profile=profile, limit=limit, industry=industry)
    recommendation_names = {item.ticker: item.name for item in recommendations.candidates}
    if normalized:
        try:
            from app.services.symbol_search import load_symbols
            symbol_names = {
                item.ticker: item.name
                for item in load_symbols()
                if item.market == "CN" and item.ticker in normalized
            }
        except Exception:
            symbol_names = {}
        selected_tickers = normalized
        selected_names = {
            ticker: symbol_names.get(ticker) or recommendation_names.get(ticker) or ticker
            for ticker in selected_tickers
        }
    else:
        selected_tickers = [item.ticker for item in recommendations.candidates]
        selected_names = recommendation_names
    histories = {
        ticker: bars
        for ticker in selected_tickers
        if (bars := _load_history(ticker, years))
    }
    if not histories:
        raise ValueError("所选股票没有取得可用的历史日线")
    result = simulate_price_rules(
        histories,
        profile,
        stock_names=selected_names,
        benchmark_bars=_load_benchmark(years),
    )
    result.years = years
    result.as_of = recommendations.as_of
    _CACHE[key] = (time.time(), result)
    return result
