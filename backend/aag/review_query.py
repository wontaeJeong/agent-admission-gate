"""One authorization/queue predicate shared by list and dashboard."""

from sqlalchemy import or_

from .models import Review


def review_queue_predicates(actor, tab="pending", stage=None, assignee="any"):
    predicates = []
    if not actor.staff or tab == "mine":
        predicates.append(Review.requester_id == actor.id)
    if tab in {"pending", "approved"}:
        predicates.append(Review.status == tab)
    if tab == "actionable":
        predicates += [
            Review.status == "pending",
            Review.workflow_state.in_(["waiting", "in_review"]),
            Review.requester_id != actor.id,
            or_(Review.assignee_id.is_(None), Review.assignee_id == actor.id),
        ]
    if stage:
        predicates.append(Review.workflow_state == stage)
    if assignee == "me":
        predicates.append(Review.assignee_id == actor.id)
    elif assignee == "unassigned":
        predicates.append(Review.assignee_id.is_(None))
    return predicates
