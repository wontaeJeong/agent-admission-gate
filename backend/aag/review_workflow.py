"""Review transitions. Caller owns the transaction; no side effect commits here.

Lock order: current User (non-key UPDATE), then Review CAS, then Job / event /
audit / notification rows. Never upgrade the User lock by updating its key: PG
FK KEY SHARE locks from other actors' events must remain compatible. SQLite's
first write serializes before the initial read, avoiding snapshot upgrades.
"""

import time
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import and_, case, or_, select, update

from .db import audit, record
from .models import Job, Review, ReviewEvent, User
from .notifications import emit_notification
from .sources import validate_git_url


def current_actor(s, actor, *, reviewer=False):
    actor.interactive()
    if reviewer:
        actor.review()
    predicates = [User.id == actor.id, User.active.is_(True)]
    if reviewer:
        predicates.append(User.reviewer.is_(True))
    if s.execute(update(User).where(*predicates).values(name=User.name)).rowcount != 1:
        raise HTTPException(403, "Current qualification required")
    user = s.get(User, actor.id, populate_existing=True)
    return user


def visible_review(s, actor, review_id):
    actor.interactive()
    r = s.get(Review, review_id)
    if not r or (r.requester_id != actor.id and not actor.staff):
        raise HTTPException(404, "Review not found")
    return r


def review_dto(s, review, actor):
    user = s.get(User, review.assignee_id) if review.assignee_id else None
    links = {}
    for direction, linked in (
        (
            "previous",
            s.get(Review, review.previous_review_id) if review.previous_review_id else None,
        ),
        ("next", s.scalar(select(Review).where(Review.previous_review_id == review.id))),
    ):
        authorized = linked and (linked.requester_id == actor.id or actor.staff)
        job = s.get(Job, linked.job_id) if authorized else None
        links[direction + "_review_id"] = linked.id if authorized else None
        links[direction + "_content_hash"] = job.content_hash if job else None
    return {
        **record(review),
        **links,
        "assignee": {
            "id": user.id,
            "name": user.name,
            "active": user.active,
            "qualified": user.reviewer,
        }
        if user
        else None,
    }


def event(s, actor, r, kind, before, after, reason=None):
    s.add(
        ReviewEvent(
            review_id=r.id,
            actor_id=actor.id,
            kind=kind,
            from_state=before,
            to_state=after,
            reason=reason,
        )
    )
    # Audit holds identity/transition metadata; public reasons live only in ReviewEvent.
    audit(s, actor.id, "review." + kind, r.id, from_state=before, to_state=after)


def transition_review(
    s, actor, review_id, expected_revision, action, reason=None, *, new_job_id=None
):
    user = current_actor(s, actor, reviewer=action in {"claim", "request_changes"})
    r = visible_review(s, actor, review_id)
    if action == "follow-up":
        return follow_up(s, actor, r, expected_revision, new_job_id, reason)
    before = r.workflow_state
    previous_assignee = r.assignee_id
    if action in {"withdraw", "request_changes", "respond"} and (
        not reason or not 5 <= len(reason.strip()) <= 4000
    ):
        raise HTTPException(422, "A reason of 5–4000 characters is required")
    predicates = [
        Review.id == review_id,
        Review.revision == expected_revision,
        Review.status == "pending",
    ]
    if action == "claim":
        if r.requester_id == actor.id:
            raise HTTPException(403, "Self-claim is not permitted")
        predicates += [
            Review.workflow_state == "waiting",
            Review.assignee_id.is_(None),
            Review.requester_id != actor.id,
        ]
        values = {"assignee_id": actor.id, "claimed_at": time.time(), "workflow_state": "in_review"}
        reason = None
    elif action == "release":
        if not r.assignee_id:
            raise HTTPException(409, "Review is not assigned")
        assignee = s.get(User, r.assignee_id)
        admin = actor.role == "admin" and user.role == "admin"
        qualified = actor.reviewer and user.reviewer
        stale = not assignee or not assignee.active or not assignee.reviewer
        if actor.id != r.assignee_id and not admin and not (qualified and stale):
            raise HTTPException(
                403,
                "Only the assignee, administrator or qualified stale-claim reviewer can release",
            )
        if actor.id != r.assignee_id and (not reason or not 5 <= len(reason.strip()) <= 4000):
            raise HTTPException(422, "A release reason of 5–4000 characters is required")
        predicates += [
            Review.assignee_id == r.assignee_id,
            Review.workflow_state.in_(["waiting", "in_review", "changes_requested"]),
        ]
        if actor.id != r.assignee_id and not admin:
            predicates.append(
                ~select(User.id)
                .where(
                    User.id == Review.assignee_id, User.active.is_(True), User.reviewer.is_(True)
                )
                .exists()
            )
        values = {
            "assignee_id": None,
            "claimed_at": None,
            "workflow_state": "changes_requested" if before == "changes_requested" else "waiting",
        }
    elif action == "request_changes":
        if r.assignee_id != actor.id or r.requester_id == actor.id:
            raise HTTPException(403, "Only the assigned reviewer can request changes")
        predicates += [Review.assignee_id == actor.id, Review.workflow_state == "in_review"]
        values = {"workflow_state": "changes_requested"}
    elif action in {"withdraw", "respond"}:
        if r.requester_id != actor.id:
            raise HTTPException(403, "Only the requester can change this request")
        predicates.append(Review.requester_id == actor.id)
        if action == "withdraw":
            values = {"status": "withdrawn", "workflow_state": "closed", "closed_reason": reason}
        else:
            predicates.append(Review.workflow_state == "changes_requested")
            # Evaluate current qualification in the CAS statement, without taking
            # a second actor lock after Review (which would invert lock ordering).
            valid_assignee = (
                select(User.id)
                .where(
                    User.id == Review.assignee_id,
                    User.active.is_(True),
                    User.reviewer.is_(True),
                    User.id != Review.requester_id,
                )
                .exists()
            )
            values = {
                "workflow_state": case((valid_assignee, "in_review"), else_="waiting"),
                "assignee_id": case((valid_assignee, Review.assignee_id), else_=None),
                "claimed_at": case((valid_assignee, Review.claimed_at), else_=None),
            }
    else:
        raise HTTPException(422, "Unsupported transition")
    changed = s.execute(
        update(Review).where(*predicates).values(**values, revision=Review.revision + 1)
    ).rowcount
    if changed != 1:
        raise HTTPException(409, "Review changed; reload before retrying")
    s.refresh(r)
    event(s, actor, r, action, before, r.workflow_state, reason)
    kind = {
        "claim": "claimed",
        "release": "released",
        "request_changes": "changes_requested",
        "respond": "responded",
        "withdraw": "withdrawn",
    }[action]
    recipient = previous_assignee if action in {"respond", "withdraw"} else r.requester_id
    emit_notification(
        s,
        "review." + kind,
        s.get(Job, r.job_id),
        [recipient] if recipient else [],
        f"review.update:{r.id}:{r.revision}",
        r.id,
        actor_id=actor.id,
    )
    s.flush()
    return review_dto(s, r, actor)


def followup_conflict(s, actor, review_id):
    linked = s.scalar(select(Review).where(Review.previous_review_id == review_id))
    return HTTPException(
        409,
        {
            "message": "Review changed or already has a follow-up; reload before retrying",
            "next_review_id": linked.id
            if linked and (linked.requester_id == actor.id or actor.staff)
            else None,
        },
    )


def follow_up(s, actor, r, expected_revision, new_job_id, reason):
    """Actor is already locked; source CAS precedes all domain and inbox writes."""
    if r.requester_id != actor.id:
        raise HTTPException(403, "Only the requester can create a follow-up")
    old, new = s.get(Job, r.job_id), s.get(Job, new_job_id)
    if not old or old.owner_id != actor.id or not new or new.owner_id != actor.id:
        raise HTTPException(404, "Scan not found")
    if s.scalar(select(Review.id).where(Review.previous_review_id == r.id)):
        raise followup_conflict(s, actor, r.id)
    eligible = r.status == "rejected" or (
        r.status == "pending" and r.workflow_state == "changes_requested"
    )
    if not eligible or r.revision != expected_revision:
        raise followup_conflict(s, actor, r.id)
    if new.id == old.id or new.status != "COMPLETED" or new.created_at < old.created_at:
        raise HTTPException(409, "A new completed scan at or after the original is required")
    if old.source_type != new.source_type:
        raise HTTPException(422, "Scan source type differs")
    if old.source_type == "git":
        try:
            urls = [
                validate_git_url(j.source, [urlsplit(j.source).hostname], resolve=False)
                for j in (old, new)
            ]
        except ValueError:
            raise HTTPException(422, "Repository identity is unavailable") from None
        if urls[0] != urls[1]:
            raise HTTPException(422, "Scan repository differs")
    elif old.source_type != "upload" or new.lineage_root_id != (old.lineage_root_id or old.id):
        raise HTTPException(422, "Scan ZIP lineage differs")
    if s.scalar(select(Review.id).where(Review.job_id == new.id)):
        raise HTTPException(409, "Review request already exists for this scan")
    superseded = r.status == "pending"
    before = r.workflow_state
    values = (
        {
            "status": "withdrawn",
            "workflow_state": "closed",
            "closed_reason": "superseded",
            "revision": Review.revision + 1,
        }
        if superseded
        else {"revision": Review.revision}
    )
    changed = s.execute(
        update(Review)
        .where(
            Review.id == r.id,
            Review.revision == expected_revision,
            or_(
                Review.status == "rejected",
                and_(Review.status == "pending", Review.workflow_state == "changes_requested"),
            ),
        )
        .values(**values)
    ).rowcount
    if changed != 1:
        raise followup_conflict(s, actor, r.id)
    follow = Review(job_id=new.id, requester_id=actor.id, reason=reason, previous_review_id=r.id)
    s.add(follow)
    s.flush()
    if superseded:
        event(s, actor, r, "superseded", before, "closed", reason)
    event(s, actor, follow, "follow_up", "closed" if not superseded else before, "waiting", reason)
    # Two legitimate events can share a recipient. Sort the union once to
    # prevent inversions between the old assignment and the new reviewer set.
    reviewers = set(s.scalars(select(User.id).where(User.reviewer.is_(True))))
    old_recipients = {r.assignee_id} - {None} if superseded else set()
    for recipient in sorted(reviewers | old_recipients):
        if recipient in old_recipients:
            emit_notification(
                s,
                "review.withdrawn",
                old,
                [recipient],
                f"review.update:{r.id}:{r.revision}",
                r.id,
                actor_id=actor.id,
            )
        if recipient in reviewers:
            emit_notification(
                s,
                "review.requested",
                new,
                [recipient],
                "review.requested:" + follow.id,
                follow.id,
                actor_id=actor.id,
            )
    s.flush()
    return review_dto(s, follow, actor)


def decide_review(s, actor, review_id, data):
    current_actor(s, actor, reviewer=True)
    r = visible_review(s, actor, review_id)
    if r.requester_id == actor.id:
        raise HTTPException(403, "Self-approval is not permitted")
    job = s.get(Job, r.job_id)
    if job.status != "COMPLETED":
        raise HTTPException(409, "Scan must be completed")
    if data.decision == "approved" and job.result.get("coverage_complete") is not True:
        raise HTTPException(409, "Complete required scanners and rescan before approval")
    before, unclaimed = r.workflow_state, r.assignee_id is None
    predicates = [
        Review.id == r.id,
        Review.revision
        == (data.expected_revision if data.expected_revision is not None else r.revision),
        Review.status == "pending",
        Review.requester_id != actor.id,
        or_(
            and_(Review.workflow_state == "waiting", Review.assignee_id.is_(None)),
            and_(Review.workflow_state == "in_review", Review.assignee_id == actor.id),
        ),
    ]
    changed = s.execute(
        update(Review)
        .where(*predicates)
        .values(
            status=data.decision,
            workflow_state="closed",
            reviewer_id=actor.id,
            assignee_id=actor.id,
            claimed_at=r.claimed_at or time.time(),
            decision_reason=data.reason,
            decided_at=time.time(),
            revision=Review.revision + 1,
        )
    ).rowcount
    if changed != 1:
        raise HTTPException(409, "Review changed or is assigned to another reviewer")
    if unclaimed:
        # Actual legacy self-claim only; no inferred historical assignments/events.
        s.add(
            ReviewEvent(
                review_id=r.id,
                actor_id=actor.id,
                kind="claim",
                from_state=before,
                to_state="in_review",
            )
        )
        before = "in_review"
    job.effective_verdict = "ALLOW" if data.decision == "approved" else "BLOCK"
    event(s, actor, r, data.decision, before, "closed", data.reason)
    if unclaimed:
        emit_notification(
            s,
            "review.claimed",
            job,
            [r.requester_id],
            f"review.update:{r.id}:{r.revision}",
            r.id,
            actor_id=actor.id,
        )
    emit_notification(
        s, "review." + data.decision, job, [r.requester_id], "review.decided:" + r.id, r.id
    )
    return {"ok": True}
