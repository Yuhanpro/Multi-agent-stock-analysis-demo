"""Price alerts CRUD + WeChat push-channel binding. All per-user (auth required)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services import alerts as alerts_svc
from app.services.alert_scheduler import evaluate_once
from app.services.auth import User, get_current_user
from app.services.push import PROVIDERS, send_push

router = APIRouter()


class AlertBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Literal["US", "CN", "HK"] = "CN"
    up_pct: float | None = Field(None, gt=0, le=100)
    down_pct: float | None = Field(None, gt=0, le=100)
    target_above: float | None = Field(None, gt=0)
    target_below: float | None = Field(None, gt=0)
    enabled: bool = True
    note: str = Field("", max_length=120)


@router.get("/alerts", response_model=list[alerts_svc.Alert])
def list_alerts(user: User = Depends(get_current_user)) -> list[alerts_svc.Alert]:
    return alerts_svc.list_alerts(user.id)


@router.put("/alerts", response_model=alerts_svc.Alert)
def upsert_alert(body: AlertBody, user: User = Depends(get_current_user)) -> alerts_svc.Alert:
    if not any([body.up_pct, body.down_pct, body.target_above, body.target_below]):
        raise HTTPException(status_code=400, detail="至少设置一个提醒条件")
    return alerts_svc.upsert_alert(
        user.id, body.ticker.strip().upper(), body.market,
        up_pct=body.up_pct, down_pct=body.down_pct,
        target_above=body.target_above, target_below=body.target_below,
        enabled=body.enabled, note=body.note,
    )


@router.delete("/alerts/{market}/{ticker}")
def delete_alert(market: str, ticker: str, user: User = Depends(get_current_user)) -> dict:
    alerts_svc.delete_alert(user.id, ticker.strip().upper(), market)
    return {"ok": True}


# ---- push channel ----------------------------------------------------------

class PushBody(BaseModel):
    provider: Literal["serverchan", "pushplus"]
    key: str = Field(..., min_length=4, max_length=200)


@router.get("/account/push")
def get_push(user: User = Depends(get_current_user)) -> dict:
    provider, key = alerts_svc.get_push(user.id)
    return {"provider": provider, "key": key}


@router.put("/account/push")
def set_push(body: PushBody, user: User = Depends(get_current_user)) -> dict:
    if body.provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="未知推送渠道")
    alerts_svc.set_push(user.id, body.provider, body.key.strip())
    return {"ok": True}


@router.delete("/account/push")
def clear_push(user: User = Depends(get_current_user)) -> dict:
    alerts_svc.set_push(user.id, None, None)
    return {"ok": True}


@router.post("/account/push/test")
def test_push(user: User = Depends(get_current_user)) -> dict:
    provider, key = alerts_svc.get_push(user.id)
    if not provider or not key:
        raise HTTPException(status_code=400, detail="尚未绑定推送渠道")
    ok, detail = send_push(provider, key, "stock-web 测试推送",
                           "绑定成功!当你的自选股触发涨跌/到价条件时,会在这里收到提醒。")
    if not ok:
        raise HTTPException(status_code=502, detail=f"推送失败: {detail}")
    return {"ok": True}


@router.post("/alerts/run")
def run_now(user: User = Depends(get_current_user)) -> dict:
    """Force one evaluation sweep (also works outside trading hours) for testing."""
    return {"sent": evaluate_once()}
