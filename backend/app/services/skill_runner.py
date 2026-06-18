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
        f"- P/E (trailing): {num(f.pe)}  ·  P/B: {num(f.pb)}\n"
        f"- dividend_yield: {pct(f.dividend_yield)}  ·  EPS: {num(f.eps)}  ·  "
        f"revenue_yoy: {pct(f.revenue_yoy)}\n\n"
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
    user_question: str | None = None,
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
    if user_question:
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


def sse_event(event: str, data: dict) -> dict:
    """Shape expected by sse_starlette.EventSourceResponse.

    Yielding a pre-formatted "event: ...\\ndata: ...\\n\\n" string would be
    double-wrapped by EventSourceResponse — yield a dict instead and let it
    serialize.
    """
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}
