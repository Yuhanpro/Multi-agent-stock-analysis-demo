"""Synthetic regression checks: no network and no production database."""
from app.services.recommendation_backtest import PriceBar, simulate_price_rules


def trending(start: float, days: int, step: float) -> list[PriceBar]:
    bars = []
    price = start
    for index in range(days):
        previous = price
        price *= 1 + step
        bars.append(PriceBar(
            date=f"2025-{index // 28 + 1:02d}-{index % 28 + 1:02d}",
            open=previous,
            high=price * 1.01,
            low=previous * 0.995,
            close=price,
            volume=1_000_000,
        ))
    return bars


result = simulate_price_rules({"600001": trending(10, 220, 0.002)}, "balanced")
assert result.signals > 0
assert result.windows[0].sample_size > 0
assert result.windows[0].average_return is not None
assert result.transaction_cost_pct > 0
assert result.methodology
assert any("选择偏差" in item for item in result.limitations)
assert result.stock_names["600001"] == "600001"
assert result.trades
assert result.trades[0].signal_date < result.trades[0].entry_date
assert result.trades[0].entry_price > 0
assert result.trades[0].exit_price > 0
assert result.trades[0].exit_reason in {"target", "stop", "time", "open"}
assert result.trades[0].forward_outcomes
print("recommendation backtest checks passed")
