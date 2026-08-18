"""Focused regression checks for the explainable recommendation ranker."""
from app.services.recommendations import rank_rows


def row(code, name, price, amount, change, pe=20, pb=2, turnover=4, amplitude=4, industry=None):
    return {
        "代码": code, "名称": name, "最新价": price, "成交额": amount,
        "涨跌幅": change, "市盈率-动态": pe, "市净率": pb,
        "换手率": turnover, "振幅": amplitude, "行业": industry,
    }


items = [
    row("600001", "稳健股份", 20, 2_000_000_000, 2.8),
    row("600002", "高波股份", 10, 1_500_000_000, 5.8, pe=90, turnover=20, amplitude=12),
    row("600003", "ST样本", 3, 3_000_000_000, 2),
    row("600004", "低流动性", 8, 20_000_000, 3),
]

picks, eligible = rank_rows(items, "balanced", 10)
assert eligible == 2
assert [x.ticker for x in picks] == ["600001", "600002"]
assert picks[0].score > picks[1].score
assert any("偏高" in risk for risk in picks[1].risks)
assert picks[0].trade_plan.entry_low < picks[0].trade_plan.entry_high
assert picks[0].trade_plan.stop_price < picks[0].trade_plan.entry_low
assert picks[0].trade_plan.target_price > picks[0].trade_plan.entry_high
assert picks[0].trade_plan.reward_risk_ratio > 1
assert picks[1].trade_plan.signal == "wait"
assert "收盘跌破" in picks[0].trade_plan.invalidation

industry_rows = [
    row("600011", "科技一", 20, 3_000_000_000, 3.0, industry="软件服务"),
    row("600012", "科技二", 20, 2_900_000_000, 3.0, industry="软件服务"),
    row("600013", "科技三", 20, 2_800_000_000, 3.0, industry="软件服务"),
    row("600014", "医药一", 20, 2_700_000_000, 3.0, industry="医药制造"),
]
diverse, diverse_eligible = rank_rows(industry_rows, "balanced", 4)
assert diverse_eligible == 4
assert [x.ticker for x in diverse] == ["600011", "600012", "600014"]
assert [x.industry for x in diverse] == ["软件服务", "软件服务", "医药制造"]

software_only, software_eligible = rank_rows(
    industry_rows,
    "balanced",
    10,
    industry="软件服务",
)
assert software_eligible == 3
assert [x.ticker for x in software_only] == ["600011", "600012", "600013"]

mapped, _ = rank_rows(
    [row("600021", "映射样本", 20, 2_000_000_000, 3.0)],
    "balanced",
    10,
    industry_map={"600021": "银行"},
)
assert mapped[0].industry == "银行"
print("recommendation ranking checks passed")
