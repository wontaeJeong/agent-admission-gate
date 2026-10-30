import asyncio
import time
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from sqlalchemy import func, select, update

from .auth import Actor, actor
from .db import audit, record
from .models import Comment, Job, Review, User
from .schemas import CommentRequest, Reason, ReviewDecision, ScanRequest
from .service import TERMINAL, owned_job

router = APIRouter(prefix="/api")


@router.post("/scans", status_code=202)
async def scan(
    data: ScanRequest,
    request: Request,
    response: Response,
    wait: int = Query(0, ge=0, le=30),
    a: Actor = Depends(actor),
):
    result = await request.app.state.scans.submit(a, data)
    response.headers["Location"] = "/api/scans/" + result["id"]
    if wait:
        task = request.app.state.scans.tasks[result["id"]]
        try:
            await asyncio.wait_for(asyncio.shield(task), wait)
        except TimeoutError:
            return result
        with request.app.state.db.session() as s:
            result = record(s.get(Job, result["id"]))
        response.status_code = 200
    return result


@router.post("/scans/upload", status_code=202)
async def upload_scan(
    request: Request,
    file: UploadFile = File(...),
    profile: Literal["static", "full"] = Form("static"),
    force_rescan: bool = Form(False),
    a: Actor = Depends(actor),
):
    a.scope("scan:write")
    data = await file.read(request.app.state.settings.max_upload_bytes + 1)
    if len(data) > request.app.state.settings.max_upload_bytes:
        raise HTTPException(413, "Upload exceeds size limit")
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(422, "Upload a ZIP package")
    return await request.app.state.scans.submit(
        a, upload=data, filename=file.filename, upload_profile=profile, upload_force=force_rescan
    )


@router.get("/scans")
def list_scans(
    request: Request,
    q: str = Query("", max_length=200),
    status: str = "",
    verdict: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    mine: bool = False,
    a: Actor = Depends(actor),
):
    a.scope("scan:read")
    query = select(Job)
    if mine or a.key_id or not a.staff:
        query = query.where(Job.owner_id == a.id)
    if q:
        query = query.where(Job.source.contains(q, autoescape=True))
    if status:
        query = query.where(Job.status == status)
    if verdict:
        query = query.where(Job.effective_verdict == verdict)
    with request.app.state.db.session() as s:
        total = s.scalar(select(func.count()).select_from(query.subquery()))
        rows = s.scalars(
            query.order_by(Job.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        return {
            "items": [record(j, ("result",)) for j in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }


@router.get("/scans/{job_id}")
def get_scan(job_id: str, request: Request, a: Actor = Depends(actor)):
    a.scope("scan:read")
    with request.app.state.db.session() as s:
        return record(owned_job(s, job_id, a))


@router.post("/scans/{job_id}/cancel")
async def cancel_scan(job_id: str, request: Request, a: Actor = Depends(actor)):
    return await request.app.state.scans.cancel(job_id, a)


@router.get("/scans/{job_id}/export")
def export_scan(
    job_id: str,
    request: Request,
    format: Literal["json", "sarif"] = "json",
    a: Actor = Depends(actor),
):
    import json

    a.scope("scan:read")
    with request.app.state.db.session() as s:
        job = owned_job(s, job_id, a)
        payload = record(job)
        if format == "sarif":
            payload = {
                "version": "2.1.0",
                "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
                "runs": [
                    {
                        "tool": {"driver": {"name": "agent-admission-gate", "version": "0.1.0"}},
                        "results": [
                            {
                                "ruleId": f["rule"],
                                "level": "error"
                                if f["severity"] in {"high", "critical"}
                                else "warning",
                                "message": {"text": f["title"]},
                                "partialFingerprints": {"aag/v1": f["fingerprint"]},
                                **(
                                    {
                                        "locations": [
                                            {
                                                "physicalLocation": {
                                                    "artifactLocation": {"uri": f["path"]},
                                                    **(
                                                        {"region": {"startLine": f["line"]}}
                                                        if isinstance(f.get("line"), int)
                                                        and f["line"] > 0
                                                        else {}
                                                    ),
                                                }
                                            }
                                        ]
                                    }
                                    if f["path"]
                                    else {}
                                ),
                            }
                            for f in job.result.get("findings", [])
                            if not f.get("suppressed")
                        ],
                    }
                ],
            }
        return Response(
            json.dumps(payload, ensure_ascii=False),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="scan-{job.id}.{format}.json"'},
        )


@router.get("/scans/{job_id}/comments")
def scan_comments(job_id: str, request: Request, a: Actor = Depends(actor)):
    a.scope("scan:read")
    with request.app.state.db.session() as s:
        owned_job(s, job_id, a)
        query = select(Comment).where(Comment.target_type == "scan", Comment.target_id == job_id)
        if a.key_id or not a.staff:
            query = query.where(Comment.internal.is_(False))
        return [
            {**record(c), "author": s.get(User, c.author_id).name}
            for c in s.scalars(query.order_by(Comment.created_at))
        ]


@router.post("/scans/{job_id}/comments", status_code=201)
def comment_scan(job_id: str, data: CommentRequest, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    if data.internal and not a.staff:
        raise HTTPException(403, "Internal comments require staff")
    with request.app.state.db.session.begin() as s:
        owned_job(s, job_id, a)
        c = Comment(target_type="scan", target_id=job_id, author_id=a.id, **data.model_dump())
        s.add(c)
        s.flush()
        audit(s, a.id, "scan.comment", job_id, internal=data.internal)
        return record(c)


@router.post("/scans/{job_id}/review", status_code=201)
def request_review(job_id: str, data: Reason, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session.begin() as s:
        job = owned_job(s, job_id, a)
        if job.owner_id != a.id:
            raise HTTPException(403, "Only the scan owner can request review")
        if job.status != "COMPLETED":
            raise HTTPException(409, "Only completed scans can be reviewed")
        if s.scalar(select(Review).where(Review.job_id == job_id)):
            raise HTTPException(409, "Review already exists; rescan for another review")
        review = Review(job_id=job_id, requester_id=a.id, reason=data.reason)
        s.add(review)
        s.flush()
        audit(s, a.id, "review.request", review.id)
        return record(review)


@router.get("/reviews")
def reviews(
    request: Request,
    tab: Literal["pending", "mine", "approved", "all"] = "pending",
    page: int = Query(1, ge=1),
    a: Actor = Depends(actor),
):
    a.interactive()
    query = select(Review)
    if not a.staff or tab == "mine":
        query = query.where(Review.requester_id == a.id)
    if tab in {"pending", "approved"}:
        query = query.where(Review.status == tab)
    with request.app.state.db.session() as s:
        total = s.scalar(select(func.count()).select_from(query.subquery()))
        return {
            "items": [
                {**record(r), "source": s.get(Job, r.job_id).source}
                for r in s.scalars(
                    query.order_by(Review.created_at.desc()).offset((page - 1) * 25).limit(25)
                )
            ],
            "total": total,
        }


@router.get("/reviews/{review_id}")
def review_detail(review_id: str, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session() as s:
        r = s.get(Review, review_id)
        if not r or (r.requester_id != a.id and not a.staff):
            raise HTTPException(404, "Review not found")
        return {**record(r), "job": record(s.get(Job, r.job_id))}


@router.post("/reviews/{review_id}/decision")
def review_decision(
    review_id: str, data: ReviewDecision, request: Request, a: Actor = Depends(actor)
):
    a.review()
    with request.app.state.db.session.begin() as s:
        r = s.get(Review, review_id)
        if not r:
            raise HTTPException(404, "Review not found")
        if r.requester_id == a.id:
            raise HTTPException(403, "Self-approval is not permitted")
        job = s.get(Job, r.job_id)
        if job.status not in TERMINAL or job.status != "COMPLETED":
            raise HTTPException(409, "Scan must be completed")
        # A human approval cannot turn missing scanner coverage into a passing admission.
        if data.decision == "approved" and not job.result.get("coverage_complete"):
            raise HTTPException(409, "Complete required scanners and rescan before approval")
        changed = s.execute(
            update(Review)
            .where(Review.id == review_id, Review.status == "pending")
            .values(
                status=data.decision,
                reviewer_id=a.id,
                decision_reason=data.reason,
                decided_at=time.time(),
            )
        ).rowcount
        if changed != 1:
            raise HTTPException(409, "Review already decided")
        job.effective_verdict = "ALLOW" if data.decision == "approved" else "BLOCK"
        audit(
            s,
            a.id,
            "review." + data.decision,
            review_id,
            reason=data.reason,
            original_verdict=job.verdict,
        )
    return {"ok": True}
