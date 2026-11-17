"""Closed registry for notification kinds, current authority and safe internal targets."""

from dataclasses import dataclass
from urllib.parse import quote

from sqlalchemy import and_, case, func, literal, or_, select

from .models import APIKey, ExceptionRule, Job, Notification, Review, User
from .search_index import safe_text


@dataclass(frozen=True)
class Target:
    model: type
    kinds: dict[str, str]


TARGETS = {
    "scan": Target(
        Job,
        {
            **{f"scan.{k}": "scans" for k in ("completed", "failed", "cancelled")},
            "comment.created": "comments",
        },
    ),
    "review": Target(
        Review,
        {
            "review.requested": "review_requests",
            "review.approved": "review_results",
            "review.rejected": "review_results",
            **{
                f"review.{k}": "review_updates"
                for k in ("claimed", "released", "changes_requested", "responded", "withdrawn")
            },
        },
    ),
    "api_key": Target(
        APIKey, {f"key.{k}": "credentials" for k in ("expiring_7d", "expiring_1d", "expired")}
    ),
    "exception": Target(
        ExceptionRule,
        {f"exception.{k}": "exceptions" for k in ("expiring_7d", "expiring_1d", "expired")},
    ),
}
EVENT_PREFERENCE = {
    kind: preference for target in TARGETS.values() for kind, preference in target.kinds.items()
}


def target_visibility(resource_type, resource_id, kind, *, actor=None):
    """Live User authority, capped by the authenticated Actor for inbox requests."""
    if isinstance(resource_type, str):
        resource_type = literal(resource_type)
    if isinstance(resource_id, str):
        resource_id = literal(resource_id)
    if isinstance(kind, str):
        kind = literal(kind)
    # OIDC group intersection can lower Actor privileges without changing User.
    # Delivery has no requesting actor; reads/writes must honor both ceilings.
    admin = and_(User.role == "admin", actor is None or actor.role == "admin")
    reviewer = and_(User.reviewer.is_(True), actor is None or actor.reviewer)
    staff = or_(admin, reviewer)
    scan = (
        select(Job.id)
        .where(Job.id == resource_id, or_(Job.owner_id == User.id, staff))
        .correlate(User, Notification)
        .exists()
    )
    review = (
        select(Review.id)
        .join(Job, Job.id == Review.job_id)
        .where(
            Review.id == resource_id,
            or_(staff, and_(Job.owner_id == User.id, Review.requester_id == User.id)),
            or_(kind != "review.requested", and_(reviewer, User.id != Job.owner_id)),
        )
        .correlate(User, Notification)
        .exists()
    )
    key = (
        select(APIKey.id)
        .where(
            APIKey.id == resource_id,
            APIKey.owner_id == User.id,
        )
        .correlate(User, Notification)
        .exists()
    )
    exception = (
        select(ExceptionRule.id)
        .where(
            ExceptionRule.id == resource_id,
            ExceptionRule.created_by == User.id,
            admin,
        )
        .correlate(User, Notification)
        .exists()
    )
    visibility = {"scan": scan, "review": review, "api_key": key, "exception": exception}
    return and_(
        User.active.is_(True),
        or_(
            *(
                and_(resource_type == name, kind.in_(target.kinds), visibility[name])
                for name, target in TARGETS.items()
            )
        ),
    )


def resolve_target(s, kind, resource_type, resource_id):
    target = TARGETS.get(resource_type)
    if target is None or kind not in target.kinds:
        raise ValueError("Unsupported notification target or event kind")
    resource = s.get(target.model, resource_id)
    if resource is None:
        raise ValueError("Notification target does not exist")
    job = (
        resource
        if resource_type == "scan"
        else (s.get(Job, resource.job_id) if resource_type == "review" else None)
    )
    if resource_type == "review" and job is None:
        raise ValueError("Notification review has no scan")
    return resource, job


def with_target_details(query, now):
    """Project only public label/state in the SAME authorized SQL snapshot."""
    source = case(
        (Notification.resource_type == "api_key", APIKey.name),
        (Notification.resource_type == "exception", ExceptionRule.source),
        else_=Job.source,
    )
    state = case(
        (
            Notification.resource_type == "api_key",
            case(
                (APIKey.revoked_at.is_not(None), "revoked"),
                (APIKey.expires_at <= now, "expired"),
                else_="active",
            ),
        ),
        (
            Notification.resource_type == "exception",
            case(
                (ExceptionRule.active.is_(False), "revoked"),
                (ExceptionRule.expires_at <= now, "expired"),
                else_="active",
            ),
        ),
        (Notification.resource_type == "review", Review.status),
        else_=func.lower(Job.status),
    )
    return (
        query.outerjoin(Job, Job.id == Notification.job_id)
        .outerjoin(Review, Review.id == Notification.review_id)
        .outerjoin(
            APIKey,
            and_(Notification.resource_type == "api_key", APIKey.id == Notification.resource_id),
        )
        .outerjoin(
            ExceptionRule,
            and_(
                Notification.resource_type == "exception",
                ExceptionRule.id == Notification.resource_id,
            ),
        )
        .add_columns(source, state)
    )


def target_record(n, source, state):
    ident = quote(n.resource_id, safe="")
    href = {
        "scan": f"/jobs/{ident}",
        "review": f"/reviews/{ident}",
        "api_key": f"/api-keys?key={ident}",
        "exception": f"/admin?tab=allowlist&exception={ident}",
    }[n.resource_type]
    return {
        "source": source if n.resource_type in {"scan", "review"} else safe_text(source, 200),
        "href": href,
        "target_state": state,
    }
