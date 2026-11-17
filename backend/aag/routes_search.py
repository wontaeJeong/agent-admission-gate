"""Interactive search using the same source authorization before every projection."""

import base64
import hashlib
import json
import math
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, func, literal, or_, select
from sqlalchemy.orm import aliased

from .auth import Actor, actor
from .job_query import job_scope_filters
from .models import FindingIndex, Job, Review
from .review_query import review_queue_predicates
from .search_index import INDEX_VERSION, pending_index, safe_text

router = APIRouter(prefix="/api")


def query_for(a, kind, scope, tokens):
    filters = job_scope_filters(a, scope)
    if kind == "reviews":
        filters += review_queue_predicates(a, "mine" if scope == "personal" else "all")
        created, identity, ordinal = Review.created_at, Review.id, literal(0)
        fields = [
            Job.id,
            Job.source,
            Job.ref,
            Job.resolved_commit,
            Review.reason,
            Review.decision_reason,
        ]
        query = select(
            Review.id.label("id"),
            Review.created_at.label("created_at"),
            Job.id.label("job_id"),
            Job.source,
            Job.effective_verdict,
            Review.reason,
            Review.decision_reason,
            Review.status,
            ordinal.label("ordinal"),
        ).join(Job, Review.job_id == Job.id)
    elif kind == "findings":
        created, identity, ordinal = Job.created_at, Job.id, FindingIndex.ordinal
        fields = [Job.id, FindingIndex.search_text]
        filters += [
            Job.finding_index_version == INDEX_VERSION,
            FindingIndex.schema_version == INDEX_VERSION,
        ]
        previous = aliased(FindingIndex)
        occurrence = (
            select(func.count())
            .where(
                previous.job_id == FindingIndex.job_id,
                previous.fingerprint == FindingIndex.fingerprint,
                previous.ordinal < FindingIndex.ordinal,
            )
            .correlate(FindingIndex)
            .scalar_subquery()
        )
        query = (
            select(
                Job.id.label("id"),
                Job.created_at,
                Job.id.label("job_id"),
                Job.source,
                Job.effective_verdict,
                FindingIndex.ordinal,
                FindingIndex.fingerprint,
                FindingIndex.title,
                FindingIndex.rule,
                FindingIndex.path,
                FindingIndex.engine,
                FindingIndex.action,
                occurrence.label("occurrence"),
                Review.status.label("review_status"),
            )
            .join(FindingIndex, FindingIndex.job_id == Job.id)
            .outerjoin(Review, and_(Review.job_id == Job.id, *review_queue_predicates(a, "all")))
        )
    else:
        created, identity, ordinal = Job.created_at, Job.id, literal(0)
        fields = [Job.id, Job.source, Job.ref, Job.resolved_commit, Job.target_commit]
        query = select(
            Job.id.label("id"),
            Job.created_at,
            Job.id.label("job_id"),
            Job.source,
            Job.effective_verdict,
            Job.status,
            Job.ref,
            Job.resolved_commit,
            ordinal.label("ordinal"),
        )
    for token in tokens:
        escaped = token.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(
            or_(*(func.lower(field).like("%" + escaped + "%", escape="\\") for field in fields))
        )
    return query.where(*filters), created, identity, ordinal


def cursor_key(a, kind, scope, tokens):
    return hashlib.sha256(json.dumps([a.id, kind, scope, tokens]).encode()).hexdigest()


def decode_cursor(value, key):
    try:
        payload = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        if not isinstance(payload, list) or len(payload) != 4:
            raise ValueError
        binding, created, identity, ordinal = payload
        if (
            binding != key
            or type(created) not in (float, int)
            or not math.isfinite(created)
            or not isinstance(identity, str)
            or not 1 <= len(identity) <= 64
            or type(ordinal) is not int
            or not 0 <= ordinal < 2**31
        ):
            raise ValueError
        return created, identity, ordinal
    except (ValueError, TypeError, UnicodeError, OverflowError):
        raise HTTPException(422, "Invalid search cursor") from None


@router.get("/search")
def search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    type: Literal["scans", "reviews", "findings"] = "scans",
    scope: Literal["personal", "review", "all"] = "personal",
    page_size: int = Query(25, ge=1, le=50),
    cursor: str | None = Query(None, max_length=1024),
    a: Actor = Depends(actor),
):
    a.interactive()
    if not request.app.state.settings.search_enabled:
        raise HTTPException(404, "Search unavailable")
    if scope == "review":
        a.review()
    if scope == "all" and not a.staff:
        raise HTTPException(403, "Staff required")
    allowed = {"q", "type", "scope", "page_size", "cursor"}
    if set(request.query_params) - allowed or any(
        len(request.query_params.getlist(k)) != 1 for k in request.query_params
    ):
        raise HTTPException(422, "Unsupported search parameters")
    tokens = q.strip().split()
    if len(q.strip()) < 2 or not 1 <= len(tokens) <= 8 or any(ord(c) < 32 for c in q):
        raise HTTPException(422, "Search requires 2–200 characters and at most 8 tokens")
    query, created, identity, ordinal = query_for(a, type, scope, tokens)
    key = cursor_key(a, type, scope, tokens)
    with request.app.state.db.session() as s:
        complete = True
        if type == "findings":
            complete = not s.scalar(
                select(Job.id)
                .where(
                    *job_scope_filters(a, scope),
                    Job.status == "COMPLETED",
                    pending_index(),
                )
                .limit(1)
            )
        total = s.scalar(select(func.count()).select_from(query.subquery())) if complete else None
        if cursor:
            stamp, item_id, position = decode_cursor(cursor, key)
            # Re-authorize anchors after permission changes. Never turn hidden IDs into metadata.
            if not s.execute(
                query.where(created == stamp, identity == item_id, ordinal == position).limit(1)
            ).first():
                raise HTTPException(422, "Invalid search cursor")
            query = query.where(
                or_(
                    created < stamp,
                    and_(created == stamp, identity < item_id),
                    and_(created == stamp, identity == item_id, ordinal > position),
                )
            )
        rows = (
            s.execute(query.order_by(created.desc(), identity.desc(), ordinal).limit(page_size + 1))
            .mappings()
            .all()
        )
        items = []
        for row in rows[:page_size]:
            source = safe_text(row["source"])
            item_id = row["id"]
            href = "/reviews/" + item_id if type == "reviews" else "/jobs/" + row["job_id"]
            if type == "findings":
                item_id += ":" + str(row["ordinal"])
                label = row["title"] or row["rule"] or row["job_id"]
                snippet = " · ".join(
                    str(row[k] or "")
                    for k in (
                        "rule",
                        "path",
                        "engine",
                        "action",
                        "effective_verdict",
                        "review_status",
                    )
                )
                if row["fingerprint"]:
                    href += "?" + urlencode(
                        {
                            "tab": "findings",
                            "finding": row["fingerprint"],
                            "occurrence": row["occurrence"],
                        }
                    )
            elif type == "reviews":
                label = source
                snippet = " · ".join(
                    safe_text(row[k])
                    for k in ("reason", "decision_reason", "status", "effective_verdict")
                )
            else:
                label = source
                snippet = " · ".join(
                    safe_text(row[k])
                    for k in ("ref", "resolved_commit", "status", "effective_verdict")
                )
            items.append(
                {
                    "kind": type,
                    "id": item_id,
                    "label": safe_text(label),
                    "safe_snippet": safe_text(snippet, 500),
                    "href": href,
                }
            )
        next_cursor = None
        if len(rows) > page_size:
            row = rows[page_size - 1]
            next_cursor = (
                base64.urlsafe_b64encode(
                    json.dumps([key, row["created_at"], row["id"], row["ordinal"]]).encode()
                )
                .decode()
                .rstrip("=")
            )
        return {
            "items": items,
            "next_cursor": next_cursor,
            "total": total,
            "index_complete": complete,
        }
