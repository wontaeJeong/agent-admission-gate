from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError

from .auth import Actor, actor
from .saved_views import (
    Resource,
    ViewCreate,
    ViewDelete,
    ViewPatch,
    change_view,
    create_view,
    delete_view,
    list_views,
)

router = APIRouter(prefix="/api/saved-views")


def personal_actor(request: Request, a: Actor = Depends(actor)):
    a.interactive()
    if request.headers.get("x-aag-account") != a.id:
        raise HTTPException(409, "Account changed; reload required")
    return a


@router.get("")
def get_views(request: Request, resource: Resource, a: Actor = Depends(personal_actor)):
    with request.app.state.db.session() as s:
        return list_views(s, a, resource)


@router.post("", status_code=201)
def post_view(data: ViewCreate, request: Request, a: Actor = Depends(personal_actor)):
    with request.app.state.db.session.begin() as s:
        return create_view(s, a, data.model_dump())


@router.patch("/{view_id}")
def patch_view(view_id: str, data: ViewPatch, request: Request, a: Actor = Depends(personal_actor)):
    try:
        with request.app.state.db.session.begin() as s:
            return change_view(s, a, view_id, data.model_dump(exclude_unset=True))
    except IntegrityError as e:
        raise HTTPException(409, "A view with this name already exists") from e


@router.delete("/{view_id}")
def remove_view(
    view_id: str, data: ViewDelete, request: Request, a: Actor = Depends(personal_actor)
):
    with request.app.state.db.session.begin() as s:
        return delete_view(s, a, view_id, data.expected_revision)
