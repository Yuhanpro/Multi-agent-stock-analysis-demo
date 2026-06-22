"""Build full A-share symbol cache via akshare.

Run from backend/:
    python app/scripts/build_cn_symbols.py

Output:
    app/data/symbols_cn_full.json
"""
from __future__ import annotations

import json
from pathlib import Path

import akshare as ak

OUT = Path(__file__).resolve().parents[1] / "data" / "symbols_cn_full.json"


def market_board(code: str) -> str:
    if code.startswith(("300", "301")):
        return "创业板"
    if code.startswith(("688", "689")):
        return "科创板"
    if code.startswith(("8", "4", "9")):
        return "北交所"
    if code.startswith("6"):
        return "沪市主板"
    if code.startswith(("000", "001", "002", "003")):
        return "深市主板"
    return "A股"


def make_aliases(code: str, name: str) -> list[str]:
    aliases: list[str] = []
    clean = name.replace(" ", "")
    if clean != name:
        aliases.append(clean)
    aliases.append(market_board(code))
    # Common ST variants should still be searchable by the non-ST name.
    for prefix in ("*ST", "ST", "N", "C"):
        if clean.startswith(prefix) and len(clean) > len(prefix):
            aliases.append(clean[len(prefix):])
    # De-duplicate while preserving order.
    out: list[str] = []
    for a in aliases:
        if a and a not in out and a != name:
            out.append(a)
    return out


def main() -> None:
    df = ak.stock_info_a_code_name()
    rows = []
    for _, row in df.iterrows():
        code = str(row["code"]).zfill(6)
        name = str(row["name"]).strip()
        rows.append({
            "ticker": code,
            "market": "CN",
            "name": name,
            "aliases": make_aliases(code, name),
        })
    rows.sort(key=lambda x: x["ticker"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(rows)} symbols to {OUT}")


if __name__ == "__main__":
    main()
