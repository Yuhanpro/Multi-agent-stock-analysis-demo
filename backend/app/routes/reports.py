"""Saved-report routes — list / get / delete (all require auth)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.services import reports
from app.services.auth import User, get_current_user

router = APIRouter()


class ShareBody(BaseModel):
    public: bool


@router.get("/reports", response_model=list[reports.ReportMeta])
def get_reports(user: User = Depends(get_current_user)) -> list[reports.ReportMeta]:
    return reports.list_reports(user.id)


@router.get("/reports/{report_id}", response_model=reports.Report)
def get_one(report_id: str, user: User = Depends(get_current_user)) -> reports.Report:
    report = reports.get_report(user.id, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="报告不存在")
    return report


@router.delete("/reports/{report_id}")
def delete_one(report_id: str, user: User = Depends(get_current_user)) -> dict:
    if not reports.delete_report(user.id, report_id):
        raise HTTPException(status_code=404, detail="报告不存在")
    return {"ok": True}


@router.post("/reports/{report_id}/share", response_model=reports.Report)
def share(report_id: str, body: ShareBody, user: User = Depends(get_current_user)) -> reports.Report:
    if not reports.set_public(user.id, report_id, body.public):
        raise HTTPException(status_code=404, detail="报告不存在")
    report = reports.get_report(user.id, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="报告不存在")
    return report


@router.get("/public/reports/{report_id}", response_model=reports.Report)
def public_report(report_id: str) -> reports.Report:
    """Public read — no auth; only returns reports the owner marked shareable."""
    report = reports.get_public_report(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="报告不存在或未公开")
    return report
