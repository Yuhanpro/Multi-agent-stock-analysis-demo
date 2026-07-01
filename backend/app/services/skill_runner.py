"""skill_runner — single-agent streaming over the DeepSeek (OpenAI-compatible) API.

Loads the buffett skill from backend/app/prompts/buffett/ and uses it as a
system prompt. The frontend gets `meta`, `token`, `done`, `error` SSE events.

Why we inline all references at boot:
  The original SKILL.md tells Claude to call the Read tool on demand to load
  references/*.md. The DeepSeek API has no Read tool — so we inline every
  reference once into the system prompt. DeepSeek auto-caches repeated system
  prompts (no cache_control headers needed); cache hits drop input cost ~10x.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

import httpx
from openai import AsyncOpenAI

from app.config import get_settings
from app.services.financials import Financials, format_for_prompt
from app.services.funds import Fund
from app.services.market_data import Snapshot

log = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

# DeepSeek pricing (USD per 1M tokens, Jun 2026 list price).
# V4 generation is current; V3.2 aliases (deepseek-chat / deepseek-reasoner)
# remain mapped to V4-Flash modes until 2026-07-24.
PRICING = {
    "deepseek-v4-flash":  {"input": 0.14, "input_cached": 0.04, "output": 0.55},
    "deepseek-v4-pro":    {"input": 0.435, "input_cached": 0.11, "output": 1.65},
    # Legacy aliases — kept so older configs keep costing right.
    "deepseek-chat":      {"input": 0.14, "input_cached": 0.04, "output": 0.55},
    "deepseek-reasoner":  {"input": 0.14, "input_cached": 0.04, "output": 0.55},
    # Fallback: assume V4-Flash rates for unknown ids.
}

_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)


@dataclass(frozen=True)
class Skill:
    name: str
    system_prompt: str
    description: str


def _strip_frontmatter(md: str) -> str:
    return _FRONTMATTER_RE.sub("", md, count=1).lstrip()


def _load_prompt_skill(name: str, description: str) -> Skill:
    base = PROMPTS_DIR / name
    skill_md = _strip_frontmatter((base / "SKILL.md").read_text(encoding="utf-8"))

    chunks = []
    for subdir, label in (("references", "Reference"), ("assets", "Asset")):
        d = base / subdir
        if not d.exists():
            continue
        for path in sorted(d.glob("*")):
            if not path.is_file():
                continue
            body = _strip_frontmatter(path.read_text(encoding="utf-8"))
            chunks.append(f"\n\n---\n\n# {label}: {path.name}\n\n{body}")
    extra_blob = "".join(chunks)

    # Adapter notes: replace Claude Code-only tool instructions with API-mode behavior.
    adapter = (
        "# API Mode Adapter\n\n"
        "You are running over the DeepSeek API (OpenAI-compatible), not "
        "Claude Code. There is **no Read/Bash/WebSearch/Grep/Python tool** "
        "available — do not attempt to call any tool or ask the user to run "
        "scripts. Every reference/asset file mentioned in the skill below is "
        "already inlined further down in this same system prompt; treat them "
        "as already read. Decide which references apply to the user's question "
        "and reason from them directly.\n\n"
        "You may use the live snapshot block in the user message as seed data, "
        "but do not hallucinate missing numbers. If the task requires data not "
        "present in the snapshot, state the needed evidence and mark the claim "
        "as a hypothesis.\n\n"
        "Output in the user's selected language. Use **Markdown** for headings, "
        "tables, bullets — the frontend renders Markdown.\n\n"
        "---\n\n"
    )

    system = adapter + skill_md + extra_blob
    return Skill(name=name, system_prompt=system, description=description)


def _load_buffett() -> Skill:
    return _load_prompt_skill(
        "buffett",
        "Warren Buffett value-investing analysis (full deep-dive path).",
    )


def _load_serenity() -> Skill:
    return _load_prompt_skill(
        "serenity",
        "Serenity supply-chain bottleneck and industry-chain research.",
    )


_SKILLS: dict[str, Skill] | None = None


def get_skill(name: str) -> Skill:
    global _SKILLS
    if _SKILLS is None:
        _SKILLS = {"buffett": _load_buffett(), "serenity": _load_serenity()}
        for s in _SKILLS.values():
            log.info("loaded skill %r system prompt: %d chars", s.name, len(s.system_prompt))
    if name not in _SKILLS:
        raise KeyError(f"unknown skill: {name!r}")
    return _SKILLS[name]


def _format_snapshot_for_prompt(s: Snapshot) -> str:
    """Turn the Snapshot model into a compact, model-readable block."""
    f = s.fundamentals

    def pct(v: float | None) -> str:
        return f"{v*100:.2f}%" if v is not None else "n/a"

    def num(v: float | None, suffix: str = "") -> str:
        return f"{v:,.2f}{suffix}" if v is not None else "n/a"

    last_30 = s.ohlcv[-30:] if len(s.ohlcv) >= 30 else s.ohlcv
    closes = ", ".join(f"{x.date}:{x.close:.2f}" for x in last_30)

    return (
        f"## Snapshot data (live) — provided so you do not need to guess numbers\n\n"
        f"- ticker: {s.ticker}  ({s.market})  source: {s.source}\n"
        f"- price (latest close): {num(s.price)}\n"
        f"- last-day change: {pct(s.change_pct)}\n"
        f"- name: {f.name or 'n/a'} · sector: {f.sector or 'n/a'} · "
        f"currency: {f.currency or 'n/a'}\n"
        f"- market_cap: {num(f.market_cap)}\n"
        f"- P/E (trailing): {num(f.pe)}  ·  P/B: {num(f.pb)}  ·  "
        f"dividend_yield: {pct(f.dividend_yield)}\n"
        f"- EPS: {num(f.eps)}  ·  revenue: {num(f.revenue)}  ·  net_income: {num(f.net_income)}\n"
        f"- revenue_yoy: {pct(f.revenue_yoy)}  ·  net_income_yoy: {pct(f.net_income_yoy)}\n"
        f"- ROE: {pct(f.roe)}  ·  ROA: {pct(f.roa)}  ·  "
        f"gross_margin: {pct(f.gross_margin)}  ·  net_margin: {pct(f.net_margin)}\n"
        f"- debt/assets: {pct(f.debt_asset_ratio)}\n\n"
        f"Last ~30 trading-day closes: {closes}\n"
    )


def estimate_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cached_input_tokens: int = 0,
) -> float:
    p = PRICING.get(model, PRICING["deepseek-v4-flash"])
    fresh_input = max(0, input_tokens - cached_input_tokens)
    return (
        fresh_input * p["input"]
        + cached_input_tokens * p.get("input_cached", p["input"])
        + output_tokens * p["output"]
    ) / 1_000_000


async def stream_quick(
    *,
    skill_name: str,
    snapshot: Snapshot,
    financials: Financials | None = None,
    user_question: str | None = None,
    cost_basis: float | None = None,
    shares: float | None = None,
    buy_date: str | None = None,
    model: str | None = None,
    language: str = "en",
) -> AsyncIterator[tuple[str, dict]]:
    """Yield (event_name, data) tuples to be wrapped as SSE.

    Events:
      meta   {"model", "skill"}                         — emitted first, once
      token  {"text"}                                   — streamed text deltas
      done   {"input_tokens","output_tokens",
              "cached_input_tokens","cost_usd",
              "stop_reason"}                            — final
      error  {"message"}                                — terminal error
    """
    settings = get_settings()
    if not settings.deepseek_api_key:
        yield "error", {"message": "DEEPSEEK_API_KEY not configured on server"}
        return

    skill = get_skill(skill_name)
    model = model or settings.deep_think_llm

    user_msg_parts = [_format_snapshot_for_prompt(snapshot)]
    if financials is not None:
        block = format_for_prompt(financials)
        if block:
            user_msg_parts.append("\n" + block)
    if cost_basis is not None:
        name = snapshot.fundamentals.name or snapshot.ticker
        price = snapshot.price
        cur = snapshot.fundamentals.currency or ""
        pl = ((price - cost_basis) / cost_basis * 100) if (price and cost_basis) else None
        bits = [f"成本价 {cost_basis} {cur}/股"]
        if shares:
            bits.append(f"持股 {shares} 股")
        if buy_date:
            bits.append(f"买入日期 {buy_date}")
        if price is not None:
            bits.append(f"当前价 {price} {cur}")
        if pl is not None:
            bits.append(f"未实现盈亏约 {pl:+.1f}%")
        posline = " · ".join(bits)
        if (language or "en").lower().startswith("zh"):
            diag = (
                f"\n## 持仓诊断任务\n\n用户当前持有 {name}({snapshot.ticker}):{posline}。\n\n"
                "请给出明确的**仓位建议:加仓 / 持有 / 减仓 / 清仓**(给目标价、止损与理由)。\n"
                "**核心原则(务必遵守)**:\n"
                "1. 成本价只是背景信息,**决策必须基于公司质地、当前估值与前瞻风险**,而不是买入价。\n"
                "2. **不要以'回本'为目标**——'套牢了再拿拿'是典型的损失厌恶/锚定偏差。\n"
                "3. 若用户的处境暗示其可能因亏损而非理性持有,请**明确指出这一偏差并纠正**。\n"
                "4. 把'前瞻投资逻辑'与'用户当前盈亏处境'分开讲清楚。\n\n"
                "**输出要求**:在报告**最开头**先单独写一节 `## 持仓建议`,包含:"
                "① 明确动作(加仓 / 持有 / 减仓 / 清仓)之一;② 一句话核心理由(基于前瞻价值,而非成本);"
                "③ 是否存在'为回本而持有'的锚定 / 损失厌恶风险(有则直接点破)。"
                "之后再按 Standard Output Format 展开完整深度分析。\n"
            )
        else:
            diag = (
                f"\n## Position diagnosis task\n\nThe user holds {name} ({snapshot.ticker}): {posline}.\n\n"
                "Give a clear **position recommendation: ADD / HOLD / TRIM / SELL** (with target, stop, and reasoning).\n"
                "**Core rules:**\n"
                "1. Cost basis is context only — the decision MUST rest on business quality, current "
                "valuation and forward risk, NOT the entry price.\n"
                "2. Do NOT aim to 'break even' — holding a loser to recover is textbook loss-aversion / anchoring.\n"
                "3. If the user's situation suggests holding irrationally because of a loss, call out that bias and correct it.\n"
                "4. Separate the forward investment thesis from the user's current P/L situation.\n\n"
                "**Output requirement**: START the report with a dedicated `## Position Recommendation` "
                "section containing: (1) one action (ADD / HOLD / TRIM / SELL); (2) a one-line core reason "
                "(based on forward value, not cost); (3) whether there is a 'holding to break even' "
                "anchoring / loss-aversion risk (call it out if so). THEN continue with the full Standard Output Format.\n"
            )
        if user_question:
            diag += f"\n用户补充问题 / extra question: {user_question.strip()}\n"
        user_msg_parts.append(diag)
    elif user_question:
        user_msg_parts.append(f"\n## User question\n\n{user_question.strip()}\n")
    else:
        if skill.name == "serenity":
            user_msg_parts.append(
                f"\n## Task\n\nApply the Serenity supply-chain bottleneck research workflow to "
                f"{snapshot.fundamentals.name or snapshot.ticker} ({snapshot.ticker}). "
                "Focus on value-chain position, upstream/downstream dependencies, "
                "scarce chokepoints, verification evidence, risks, and next checks. "
                "Use the snapshot data above as seed context; do not hallucinate "
                "missing numbers.\n"
            )
        else:
            user_msg_parts.append(
                f"\n## Task\n\nApply the buffett deep-analysis path to "
                f"{snapshot.fundamentals.name or snapshot.ticker} ({snapshot.ticker}). "
                "Produce the full Standard Output Format. Use the snapshot data "
                "above; do not hallucinate numbers you don't have.\n"
            )
    # Language directive — placed last so it sticks. The buffett system prompt
    # is mostly English; without this nudge DeepSeek defaults to English.
    if (language or "en").lower().startswith("zh"):
        user_msg_parts.append(
            "\n**Output language: 简体中文。** 整份报告(包括所有 Standard "
            "Output Format 的标题、表格、要点)用中文输出。专业术语保留英文。\n"
        )
    user_text = "\n".join(user_msg_parts)

    yield "meta", {"model": model, "skill": skill.name}

    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        http_client=httpx.AsyncClient(trust_env=False),
    )

    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": skill.system_prompt},
                {"role": "user", "content": user_text},
            ],
            max_tokens=4096,
            stream=True,
            stream_options={"include_usage": True},
        )
        usage = None
        stop_reason = None
        async for chunk in stream:
            if chunk.usage is not None:
                usage = chunk.usage
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta
            if delta and delta.content:
                yield "token", {"text": delta.content}
            if choice.finish_reason:
                stop_reason = choice.finish_reason
    except Exception as e:
        log.exception("deepseek stream failed")
        yield "error", {"message": f"upstream error: {e}"}
        return

    if usage is None:
        yield "done", {
            "input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0,
            "cost_usd": 0.0, "stop_reason": stop_reason or "unknown",
        }
        return

    in_tok = usage.prompt_tokens
    out_tok = usage.completion_tokens
    # DeepSeek reports cache hits in prompt_tokens_details.cached_tokens.
    cached = 0
    details = getattr(usage, "prompt_tokens_details", None)
    if details is not None:
        cached = getattr(details, "cached_tokens", 0) or 0

    yield "done", {
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "cached_input_tokens": cached,
        "cost_usd": round(estimate_cost_usd(model, in_tok, out_tok, cached), 6),
        "stop_reason": stop_reason or "stop",
    }


_FUND_SYSTEM = (
    "你是一位严谨的基金分析师。基于提供的基金数据,做客观、结构化的分析,覆盖:"
    "1) 持仓集中度与前十大重仓;2) 行业/风格暴露与押注;3) 基金经理、公司、规模与流动性;"
    "4) 多周期业绩与相对业绩基准的超额;5) 最大回撤与风险特征;6) 费率与性价比;"
    "7) 适合的投资者与主要风险。要点式输出,先给一句话总体结论。明确说明这不构成投资建议。"
)


def _format_fund_for_prompt(f: Fund) -> str:
    def pct(v):
        return f"{v*100:.2f}%" if v is not None else "n/a"

    order = ["1m", "3m", "6m", "1y", "ytd", "since"]
    rets = " · ".join(f"{k}:{pct(f.returns[k])}" for k in order if k in f.returns)
    conc = sum(h.pct or 0 for h in f.holdings)
    holds = "; ".join(f"{h.name} {h.pct:.2f}%" for h in f.holdings if h.pct is not None)
    rt = ""
    if f.realtime and f.realtime.price is not None:
        rt = f"\n- ETF 现价 {f.realtime.price} · IOPV {f.realtime.iopv} · 折溢价率 {f.realtime.premium}%"
    return (
        f"## 基金数据\n"
        f"- {f.name}({f.code}) · 类型 {f.type or 'n/a'}\n"
        f"- 经理 {f.manager or 'n/a'} · 公司 {f.company or 'n/a'} · 规模 {f.scale or 'n/a'} · 成立 {f.inception or 'n/a'}\n"
        f"- 业绩基准: {f.benchmark or 'n/a'}\n"
        f"- 多周期收益: {rets or 'n/a'}\n"
        f"- 最大回撤(成立来): {pct(f.max_drawdown)}\n"
        f"- 前十大重仓(占净值,合计 {conc:.1f}%): {holds or 'n/a'}{rt}\n"
    )


async def stream_fund_review(
    *, fund: Fund, model: str | None = None, language: str = "en",
) -> AsyncIterator[tuple[str, dict]]:
    """Fund-specific LLM review (reuses the DeepSeek streaming + cost model)."""
    settings = get_settings()
    if not settings.deepseek_api_key:
        yield "error", {"message": "DEEPSEEK_API_KEY not configured on server"}
        return
    model = model or settings.quick_think_llm

    user_text = _format_fund_for_prompt(fund)
    user_text += f"\n## 任务\n\n请分析基金 {fund.name}({fund.code})。"
    if (language or "en").lower().startswith("zh"):
        user_text += "\n**用简体中文输出。** 专业术语可保留英文。\n"
    else:
        user_text += "\n**Write the entire analysis in English.**\n"

    yield "meta", {"model": model, "skill": "fund"}

    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        http_client=httpx.AsyncClient(trust_env=False),
    )
    usage = None
    stop_reason = None
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": _FUND_SYSTEM}, {"role": "user", "content": user_text}],
            max_tokens=3072,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.usage is not None:
                usage = chunk.usage
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.delta and choice.delta.content:
                yield "token", {"text": choice.delta.content}
            if choice.finish_reason:
                stop_reason = choice.finish_reason
    except Exception as e:
        log.exception("fund review stream failed")
        yield "error", {"message": f"upstream error: {e}"}
        return

    in_tok = usage.prompt_tokens if usage else 0
    out_tok = usage.completion_tokens if usage else 0
    cached = 0
    if usage is not None:
        details = getattr(usage, "prompt_tokens_details", None)
        cached = getattr(details, "cached_tokens", 0) or 0 if details else 0
    yield "done", {
        "input_tokens": in_tok, "output_tokens": out_tok, "cached_input_tokens": cached,
        "cost_usd": round(estimate_cost_usd(model, in_tok, out_tok, cached), 6),
        "stop_reason": stop_reason or "stop",
    }


_FOLLOWUP_SYSTEM = """你是一位严谨、务实的股票投资分析助手,正在就某一只具体股票与用户进行多轮追问。

背景:你此前已为用户生成过一份完整的深度分析报告(见下方上下文)。现在用户会基于这份报告或最新行情继续追问。

回答原则:
- 直接聚焦用户当前的问题,不要重复整篇报告;需要时只引用相关结论。
- 只依据上下文给出的行情快照与报告事实作答;没有的数据就明说"暂无该数据",绝不编造数字或新闻。
- 可以给出有判断力的看法(估值是否合理、主要风险、值得跟踪的信号),但要点明不确定性。
- 不构成投资建议;涉及买卖决策时提醒用户结合自身情况判断。
- 简洁专业:通常 2–5 段或要点列表,能一句说清就不展开。
- 用与用户提问相同的语言回答。"""


async def stream_followup(
    *,
    snapshot: Snapshot,
    report: str | None,
    history: list[dict],
    question: str,
    model: str | None = None,
    language: str = "en",
) -> AsyncIterator[tuple[str, dict]]:
    """Multi-turn follow-up Q&A about a stock, grounded in its snapshot and the
    prior analysis report. Reuses the DeepSeek streaming + cost model."""
    settings = get_settings()
    if not settings.deepseek_api_key:
        yield "error", {"message": "DEEPSEEK_API_KEY not configured on server"}
        return
    model = model or settings.quick_think_llm

    sys = _FOLLOWUP_SYSTEM
    if (language or "en").lower().startswith("zh"):
        sys += "\n\n**用简体中文回答。** 专业术语可保留英文。"
    else:
        sys += "\n\n**Answer in English.** Keep it concise."

    context_block = "## 股票上下文(实时行情快照)\n\n" + _format_snapshot_for_prompt(snapshot)
    if report and report.strip():
        # Cap the embedded report so a very long debate transcript can't blow the
        # context window; the tail (conclusions) matters most.
        rpt = report.strip()
        if len(rpt) > 24000:
            rpt = rpt[-24000:]
        context_block += "\n\n## 此前生成的分析报告(供你引用,勿照抄)\n\n" + rpt

    messages: list[dict] = [{"role": "system", "content": sys + "\n\n" + context_block}]
    for turn in (history or [])[-10:]:  # cap history to keep cost/latency bounded
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": (question or "").strip()})

    yield "meta", {"model": model, "skill": "followup"}

    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        http_client=httpx.AsyncClient(trust_env=False),
    )
    usage = None
    stop_reason = None
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=2048,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.usage is not None:
                usage = chunk.usage
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.delta and choice.delta.content:
                yield "token", {"text": choice.delta.content}
            if choice.finish_reason:
                stop_reason = choice.finish_reason
    except Exception as e:
        log.exception("followup stream failed")
        yield "error", {"message": f"upstream error: {e}"}
        return

    in_tok = usage.prompt_tokens if usage else 0
    out_tok = usage.completion_tokens if usage else 0
    cached = 0
    if usage is not None:
        details = getattr(usage, "prompt_tokens_details", None)
        cached = getattr(details, "cached_tokens", 0) or 0 if details else 0
    yield "done", {
        "input_tokens": in_tok, "output_tokens": out_tok, "cached_input_tokens": cached,
        "cost_usd": round(estimate_cost_usd(model, in_tok, out_tok, cached), 6),
        "stop_reason": stop_reason or "stop",
    }


_GOLD_SYSTEM = """你是一位专业的黄金市场分析师,为用户做**每日黄金复盘**。你会拿到国内金(上海黄金 Au99.99,元/克)、国际金(COMEX,美元/盎司)的价格与近期走势,以及全球黄金ETF持仓变化。

请输出一份简明复盘,结构:
1. **今日/近日走势回顾**:国内金、国际金各自的涨跌与幅度。
2. **内外联动与价差**:两者方向是否一致、价差(汇率因素)有何变化。
3. **资金面**:全球黄金ETF持仓增减持,说明多空资金意愿。
4. **关键价位与后市关注点**:值得盯的价位区间、可能的催化(美元、实际利率、避险、央行购金等,作为**背景逻辑**说明,而非当日实证)。
5. **一句话小结**。

原则:
- 只依据提供的数据说涨跌与数字,**不要编造具体新闻或未提供的数字**;宏观驱动只作背景逻辑,明确它不是当日证据。
- 客观中性,给"关注方向"而非确定性预测。
- 不构成投资建议。用简体中文,简明(要点或 4–6 段)。"""


def _pct_over(history: list, n: int) -> float | None:
    pts = [p for p in history if getattr(p, "close", None) is not None]
    if len(pts) <= n:
        return None
    last, past = pts[-1].close, pts[-1 - n].close
    return (last / past - 1) if past else None


def _format_gold_for_prompt(gold) -> str:
    def pct(v):
        return f"{v*100:+.2f}%" if v is not None else "n/a"

    def line(s):
        return (f"- {s.name}:现价 {s.price} {s.unit} · 今日 {pct(s.change_pct)} · "
                f"近5日 {pct(_pct_over(s.history, 5))} · 近20日 {pct(_pct_over(s.history, 20))}")

    parts = ["## 黄金数据(截至最新)", line(gold.domestic), line(gold.intl)]
    if getattr(gold, "premium", None) is not None:
        tag = "溢价" if gold.premium >= 0 else "贴水"
        parts.append(
            f"- 内外价差:国际金折算 {gold.intl_in_cny} 元/克(汇率 {gold.usdcny})· "
            f"国内金相对国际金{tag} {gold.premium:+.2f} 元/克({gold.premium_pct*100:+.2f}%)"
        )
    if gold.etf_total is not None:
        parts.append(f"- 全球黄金ETF持仓:{gold.etf_total} 吨 · 较上日 {gold.etf_change:+.2f} 吨({gold.etf_date})")
    # last ~10 closes, aligned by index tail
    dom = [p for p in gold.domestic.history if p.close is not None][-10:]
    intl = [p for p in gold.intl.history if p.close is not None][-10:]
    parts.append("\n近约10日收盘 —— 国内金(元/克):")
    parts.append("  " + ", ".join(f"{p.date[5:]}:{p.close}" for p in dom))
    parts.append("国际金(美元/盎司):")
    parts.append("  " + ", ".join(f"{p.date[5:]}:{p.close}" for p in intl))
    return "\n".join(parts)


async def stream_gold_review(*, gold, model: str | None = None, language: str = "zh") -> AsyncIterator[tuple[str, dict]]:
    """AI daily gold recap (reuses the DeepSeek streaming + cost model)."""
    settings = get_settings()
    if not settings.deepseek_api_key:
        yield "error", {"message": "DEEPSEEK_API_KEY not configured on server"}
        return
    model = model or settings.quick_think_llm

    user_text = _format_gold_for_prompt(gold) + "\n\n## 任务\n\n请做今日黄金复盘。"
    if not (language or "zh").lower().startswith("zh"):
        user_text += "\n**Write the review in English.**"

    yield "meta", {"model": model, "skill": "gold"}
    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url,
        http_client=httpx.AsyncClient(trust_env=False),
    )
    usage = None
    stop_reason = None
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": _GOLD_SYSTEM}, {"role": "user", "content": user_text}],
            max_tokens=2048, stream=True, stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.usage is not None:
                usage = chunk.usage
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.delta and choice.delta.content:
                yield "token", {"text": choice.delta.content}
            if choice.finish_reason:
                stop_reason = choice.finish_reason
    except Exception as e:
        log.exception("gold review stream failed")
        yield "error", {"message": f"upstream error: {e}"}
        return

    in_tok = usage.prompt_tokens if usage else 0
    out_tok = usage.completion_tokens if usage else 0
    cached = 0
    if usage is not None:
        details = getattr(usage, "prompt_tokens_details", None)
        cached = getattr(details, "cached_tokens", 0) or 0 if details else 0
    yield "done", {
        "input_tokens": in_tok, "output_tokens": out_tok, "cached_input_tokens": cached,
        "cost_usd": round(estimate_cost_usd(model, in_tok, out_tok, cached), 6),
        "stop_reason": stop_reason or "stop",
    }


def sse_event(event: str, data: dict) -> dict:
    """Shape expected by sse_starlette.EventSourceResponse.

    Yielding a pre-formatted "event: ...\\ndata: ...\\n\\n" string would be
    double-wrapped by EventSourceResponse — yield a dict instead and let it
    serialize.
    """
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}
