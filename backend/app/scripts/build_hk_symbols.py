"""Build HK symbol cache via akshare.

Run from backend/:
    python app/scripts/build_hk_symbols.py

Output:
    app/data/symbols_hk_full.json
"""
from __future__ import annotations

import json
from pathlib import Path

import akshare as ak

OUT = Path(__file__).resolve().parents[1] / "data" / "symbols_hk_full.json"


def aliases_for(code: str, name: str, en: str) -> list[str]:
    aliases: list[str] = []
    clean = name.replace("－", "-").replace(" ", "")
    if clean != name:
        aliases.append(clean)
    if en:
        aliases.append(en)
    # Strip common share-class suffixes for easier search.
    for suffix in ("-W", "-SW", "-S", "-B", "-WR", "-R"):
        if clean.endswith(suffix):
            aliases.append(clean[: -len(suffix)])
    # Let users search by numeric code without leading zeroes.
    aliases.append(str(int(code)))
    out: list[str] = []
    for a in aliases:
        if a and a not in out and a != name:
            out.append(a)
    return out


def main() -> None:
    df = ak.stock_hk_spot()
    rows = []
    for _, row in df.iterrows():
        code = str(row["代码"]).zfill(5)
        name = str(row.get("中文名称", "")).strip() or code
        en = str(row.get("英文名称", "")).strip()
        rows.append({
            "ticker": code,
            "market": "HK",
            "name": name,
            "aliases": aliases_for(code, name, en),
        })
    rows.sort(key=lambda x: x["ticker"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(rows)} HK symbols to {OUT}")


if __name__ == "__main__":
    main()
