import asyncio
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
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError

from .auth import Actor, actor
from .db import audit, record
from .job_query import job_scope_filters, utc_window_start
from .models import Comment, Job, Review, ReviewEvent, User
from .notifications import emit_notification
from .review_query import review_queue_predicates
from .review_workflow import (
    decide_review,
    followup_conflict,
    review_dto,
    transition_review,
    visible_review,
)
from .scan_comparison import compare_jobs
from .scan_history import history_item, history_query
from .scan_summary import build_scan_summary
from .schemas import (
    CommentRequest,
    Reason,
    ReviewChange,
    ReviewClaim,
    ReviewDecision,
    ReviewFollowUp,
    ReviewRelease,
    ScanRequest,
)
from .service import owned_job

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
    origin_job_id: str | None = Form(None, min_length=1, max_length=64),
    a: Actor = Depends(actor),
):
    a.scope("scan:write")
    if set(await request.form()) - {"file", "profile", "force_rescan", "origin_job_id"}:
        raise HTTPException(422, "Unsupported upload fields")
    data = await file.read(request.app.state.settings.max_upload_bytes + 1)
    if len(data) > request.app.state.settings.max_upload_bytes:
        raise HTTPException(413, "Upload exceeds size limit")
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(422, "Upload a ZIP package")
    return await request.app.state.scans.submit(
        a,
        upload=data,
        filename=file.filename,
        upload_profile=profile,
        upload_force=force_rescan,
        upload_origin_job_id=origin_job_id,
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
    scope: Literal["personal", "review", "all"] | None = None,
    days: int | None = None,
    a: Actor = Depends(actor),
):
    a.scope("scan:read")
    if scope == "review":
        a.review()
    if scope == "all":
        a.interactive()
        if not a.staff:
            raise HTTPException(403, "Staff required")
    if days is not None and days not in {7, 14, 30, 90}:
        raise HTTPException(422, "Days must be 7, 14, 30 or 90")
    query = select(Job)
    if scope:
        query = query.where(*job_scope_filters(a, scope))
    if mine or a.key_id or not a.staff:
        query = query.where(Job.owner_id == a.id)
    if days is not None:
        query = query.where(Job.created_at >= utc_window_start(days))
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
        job = owned_job(s, job_id, a)
        payload = record(job)
        if not a.key_id:
            query = select(Review).where(Review.job_id == job_id)
            if not a.staff:
                query = query.where(Review.requester_id == a.id)
            review = s.scalar(query)
            payload["review"] = {"id": review.id, "status": review.status} if review else None
        return payload


@router.get("/scans/{job_id}/history")
def scan_history(
    job_id: str,
    request: Request,
    ref: str = Query("", max_length=200),
    profile: Literal["", "static", "full"] = "",
    status: Literal["", "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    a: Actor = Depends(actor),
):
    a.scope("scan:read")
    allowed = {"ref", "profile", "status", "page", "page_size"}
    if set(request.query_params) - allowed or any(
        len(request.query_params.getlist(key)) > 1 for key in allowed
    ):
        raise HTTPException(422, "Unsupported history query")
    with request.app.state.db.session() as s:
        reference = owned_job(s, job_id, a)
        query = history_query(a, reference)
        for column, value in ((Job.ref, ref), (Job.profile, profile), (Job.status, status)):
            if value:
                query = query.where(column == value)
        total = s.scalar(select(func.count()).select_from(query.subquery()))
        rows = s.scalars(
            query.order_by(Job.created_at.desc(), Job.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return {
            "items": [history_item(s, a, job) for job in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }


@router.get("/scans/{job_id}/compare")
def scan_compare(
    job_id: str,
    request: Request,
    baseline_id: str = Query(..., min_length=1, max_length=64),
    allow_unlinked: bool = False,
    a: Actor = Depends(actor),
):
    a.scope("scan:read")
    allowed = {"baseline_id", "allow_unlinked"}
    if set(request.query_params) - allowed or any(
        len(request.query_params.getlist(key)) > 1 for key in allowed
    ):
        raise HTTPException(422, "Unsupported comparison query")
    with request.app.state.db.session() as s:
        current = owned_job(s, job_id, a)
        baseline = owned_job(s, baseline_id, a)
        return compare_jobs(baseline, current, allow_unlinked=allow_unlinked)


@router.get("/scans/{job_id}/summary")
def scan_summary(
    job_id: str,
    request: Request,
    format: Literal["markdown"] = "markdown",
    a: Actor = Depends(actor),
):
    a.scope("scan:read")
    if set(request.query_params) - {"format"} or len(request.query_params.getlist("format")) > 1:
        raise HTTPException(422, "Unsupported summary query")
    with request.app.state.db.session() as s:
        job = owned_job(s, job_id, a)
        # Explicit field projection: never pass ORM records, raw results or errors.
        public = {
            key: getattr(job, key)
            for key in (
                "id",
                "source",
                "ref",
                "resolved_commit",
                "content_hash",
                "created_at",
                "profile",
                "status",
                "verdict",
                "effective_verdict",
            )
        }
        public["coverage_complete"] = job.result.get("coverage_complete") is True
        public["limitations"] = [v for v in job.result.get("limitations", []) if isinstance(v, str)]
        public["engines"] = [
            {key: engine.get(key) for key in ("name", "status")}
            for engine in job.result.get("engines", [])
        ]
        public["findings"] = [
            {
                key: finding.get(key)
                for key in (
                    "severity",
                    "engine",
                    "rule",
                    "title",
                    "path",
                    "line",
                    "suppressed",
                )
            }
            for finding in job.result.get("findings", [])
        ]
        public_review = None
        if not a.key_id:
            query = select(Review).where(Review.job_id == job_id)
            if not a.staff:
                query = query.where(Review.requester_id == a.id)
            review = s.scalar(query)
            if review:
                public_review = {"status": review.status, "decision_reason": review.decision_reason}
        content = build_scan_summary(
            public,
            public_review=public_review,
            public_url=request.app.state.settings.public_url,
        )
        return Response(
            content,
            media_type="text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="scan-{job.id}.md"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )


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
        job = owned_job(s, job_id, a)
        c = Comment(target_type="scan", target_id=job_id, author_id=a.id, **data.model_dump())
        s.add(c)
        s.flush()
        audit(s, a.id, "scan.comment", job_id, internal=data.internal)
        if not data.internal:
            review = s.scalar(select(Review).where(Review.job_id == job_id))
            recipients = {job.owner_id}
            if review and review.reviewer_id:
                recipients.add(review.reviewer_id)
            emit_notification(s, "comment.created", job, recipients - {a.id}, "comment:" + c.id)
        return record(c)


@router.post("/scans/{job_id}/review", status_code=201)
def request_review(job_id: str, data: Reason, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    try:
        with request.app.state.db.session.begin() as s:
            job = owned_job(s, job_id, a)
            if job.owner_id != a.id:
                raise HTTPException(403, "Only the scan owner can request review")
            if job.status != "COMPLETED":
                raise HTTPException(409, "Only completed scans can be reviewed")
            if s.scalar(select(Review).where(Review.job_id == job_id)):
                raise HTTPException(409, "Review request could not be created for this scan")
            review = Review(job_id=job_id, requester_id=a.id, reason=data.reason)
            s.add(review)
            s.flush()
            audit(s, a.id, "review.request", review.id)
            reviewers = s.scalars(select(User.id).where(User.reviewer.is_(True)))
            emit_notification(
                s, "review.requested", job, reviewers, "review.requested:" + review.id, review.id
            )
            return review_dto(s, review, a)
    except IntegrityError:
        # Another request can win after the duplicate check. Preserve unrelated DB errors.
        with request.app.state.db.session() as s:
            if s.scalar(select(Review.id).where(Review.job_id == job_id)):
                raise HTTPException(
                    409, "Review request could not be created for this scan"
                ) from None
        raise


@router.get("/reviews")
def reviews(
    request: Request,
    tab: Literal["pending", "mine", "approved", "all", "actionable"] = "pending",
    status: Literal["pending", "approved", "rejected", "withdrawn"] | None = None,
    stage: Literal["waiting", "in_review", "changes_requested", "closed"] | None = None,
    assignee: Literal["me", "unassigned", "any"] = "any",
    q: str = Query("", max_length=200),
    sort: Literal["newest", "oldest"] = "newest",
    page: int = Query(1, ge=1),
    a: Actor = Depends(actor),
):
    a.interactive()
    if tab == "actionable":
        a.review()
    query = select(Review).where(*review_queue_predicates(a, tab, stage, assignee))
    if q:
        query = query.where(
            Review.job_id.in_(select(Job.id).where(Job.source.contains(q, autoescape=True)))
        )
    if status:
        query = query.where(Review.status == status)
    with request.app.state.db.session() as s:
        total = s.scalar(select(func.count()).select_from(query.subquery()))
        return {
            "items": [
                {**review_dto(s, r, a), "source": s.get(Job, r.job_id).source}
                for r in s.scalars(
                    query.order_by(
                        Review.created_at.asc() if sort == "oldest" else Review.created_at.desc(),
                        Review.id,
                    )
                    .offset((page - 1) * 25)
                    .limit(25)
                )
            ],
            "total": total,
        }


@router.get("/reviews/{review_id}")
def review_detail(review_id: str, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session() as s:
        r = visible_review(s, a, review_id)
        return {**review_dto(s, r, a), "job": record(s.get(Job, r.job_id))}


@router.post("/reviews/{review_id}/decision")
def review_decision(
    review_id: str, data: ReviewDecision, request: Request, a: Actor = Depends(actor)
):
    a.review()
    with request.app.state.db.session.begin() as s:
        return decide_review(s, a, review_id, data)


def require_review_transition(request, a):
    a.interactive()
    if request.headers.get("x-aag-account") != a.id:
        raise HTTPException(409, "Account context required")
    if not request.app.state.settings.review_workflow_enabled:
        raise HTTPException(404, "Review workflow disabled")


@router.post("/reviews/{review_id}/claim")
def claim_review(review_id: str, data: ReviewClaim, request: Request, a: Actor = Depends(actor)):
    require_review_transition(request, a)
    with request.app.state.db.session.begin() as s:
        return transition_review(s, a, review_id, data.expected_revision, "claim")


@router.post("/reviews/{review_id}/release")
def release_review(
    review_id: str, data: ReviewRelease, request: Request, a: Actor = Depends(actor)
):
    require_review_transition(request, a)
    with request.app.state.db.session.begin() as s:
        return transition_review(s, a, review_id, data.expected_revision, "release", data.reason)


@router.post("/reviews/{review_id}/withdraw")
def withdraw_review(
    review_id: str, data: ReviewChange, request: Request, a: Actor = Depends(actor)
):
    require_review_transition(request, a)
    with request.app.state.db.session.begin() as s:
        return transition_review(s, a, review_id, data.expected_revision, "withdraw", data.reason)


@router.post("/reviews/{review_id}/request-changes")
def request_changes_review(
    review_id: str, data: ReviewChange, request: Request, a: Actor = Depends(actor)
):
    require_review_transition(request, a)
    with request.app.state.db.session.begin() as s:
        return transition_review(
            s, a, review_id, data.expected_revision, "request_changes", data.reason
        )


@router.post("/reviews/{review_id}/respond")
def respond_review(review_id: str, data: ReviewChange, request: Request, a: Actor = Depends(actor)):
    require_review_transition(request, a)
    with request.app.state.db.session.begin() as s:
        return transition_review(s, a, review_id, data.expected_revision, "respond", data.reason)


@router.post("/reviews/{review_id}/follow-ups", status_code=201)
def follow_up_review(
    review_id: str, data: ReviewFollowUp, request: Request, a: Actor = Depends(actor)
):
    require_review_transition(request, a)
    try:
        with request.app.state.db.session.begin() as s:
            return transition_review(
                s,
                a,
                review_id,
                data.expected_revision,
                "follow-up",
                data.reason,
                new_job_id=data.new_job_id,
            )
    except IntegrityError:
        with request.app.state.db.session() as s:
            visible_review(s, a, review_id)
            if s.scalar(select(Review.id).where(Review.previous_review_id == review_id)):
                raise followup_conflict(s, a, review_id) from None
            if s.scalar(select(Review.id).where(Review.job_id == data.new_job_id)):
                raise HTTPException(409, "Review request already exists for this scan") from None
        raise


@router.get("/reviews/{review_id}/events")
def review_events(
    review_id: str,
    request: Request,
    after: str | None = Query(None, max_length=64),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    a: Actor = Depends(actor),
):
    with request.app.state.db.session() as s:
        visible_review(s, a, review_id)
        query = select(ReviewEvent).where(ReviewEvent.review_id == review_id)
        if after:
            if page != 1:
                raise HTTPException(422, "Use page or after, not both")
            cursor = s.get(ReviewEvent, after)
            if not cursor or cursor.review_id != review_id:
                raise HTTPException(422, "Invalid activity cursor")
            query = query.where(
                or_(
                    ReviewEvent.created_at > cursor.created_at,
                    and_(ReviewEvent.created_at == cursor.created_at, ReviewEvent.id > cursor.id),
                )
            )
        rows = list(
            s.scalars(
                query.order_by(ReviewEvent.created_at, ReviewEvent.id)
                .offset((page - 1) * page_size)
                .limit(page_size + 1)
            )
        )
        return {
            "page": page,
            "page_size": page_size,
            "items": [
                {**record(row), "actor_name": s.get(User, row.actor_id).name}
                for row in rows[:page_size]
            ],
            "next_cursor": rows[page_size - 1].id if len(rows) > page_size else None,
        }
