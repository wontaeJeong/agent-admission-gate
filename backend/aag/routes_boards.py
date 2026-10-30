import time
from typing import Literal

import bleach
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from markdown_it import MarkdownIt
from sqlalchemy import func, select, update

from .auth import Actor, actor
from .db import audit, record
from .models import Comment, Post, PostRead, User
from .schemas import CommentRequest, PostRequest

router = APIRouter(prefix="/api/boards")


def enabled(request):
    if not request.app.state.settings.boards_enabled:
        raise HTTPException(404, "Not found")


def rendered(body):
    html = MarkdownIt("commonmark", {"html": False}).render(body)
    return bleach.clean(
        html,
        tags={
            "p",
            "a",
            "strong",
            "em",
            "code",
            "pre",
            "blockquote",
            "ul",
            "ol",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "hr",
            "br",
        },
        attributes={"a": ["href", "title"]},
        protocols={"http", "https", "mailto"},
        strip=True,
    )


def can_read(p, a):
    if p.kind == "internal" and not a.staff:
        return False
    if p.visibility == "private" and p.author_id != a.id and not a.staff:
        return False
    return p.status != "draft" or p.author_id == a.id or a.staff


def visible_post(s, post_id, a):
    p = s.get(Post, post_id)
    if not p or not can_read(p, a):
        raise HTTPException(404, "Post not found")
    return p


def validate_write(data, a, original=None):
    if data.kind == "notice" and a.role != "admin":
        raise HTTPException(403, "Only administrators publish notices")
    if data.kind == "internal" and not a.staff:
        raise HTTPException(403, "Internal board requires staff")
    if not a.staff:
        if original:
            changed_pin = data.pinned != original.pinned
            changed_status = data.status != original.status
            author_transition = {data.status, original.status} <= {"draft", "open"}
            if changed_pin or (changed_status and not author_transition):
                raise HTTPException(403, "Staff controls pinning and workflow status")
        elif data.pinned or data.status not in {"draft", "open"}:
            raise HTTPException(403, "Staff controls pinning and workflow status")
    if original and original.author_id != a.id and not a.staff:
        raise HTTPException(403, "Only author or staff can edit")
    if original and original.kind != data.kind:
        raise HTTPException(422, "Board type cannot change")


@router.get("")
def posts(
    request: Request,
    kind: Literal["notice", "voc", "internal"] = "notice",
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    a: Actor = Depends(actor),
):
    enabled(request)
    a.interactive()
    query = select(Post).where(Post.kind == kind)
    if not a.staff:
        if kind == "internal":
            raise HTTPException(403, "Internal board requires staff")
        query = query.where(
            (Post.visibility == "public") | (Post.author_id == a.id),
            (Post.status != "draft") | (Post.author_id == a.id),
        )
    if q:
        query = query.where(Post.title.contains(q, autoescape=True))
    with request.app.state.db.session() as s:
        total = s.scalar(select(func.count()).select_from(query.subquery()))
        items = []
        for p in s.scalars(
            query.order_by(Post.pinned.desc(), Post.updated_at.desc())
            .offset((page - 1) * 25)
            .limit(25)
        ):
            read = s.get(PostRead, (a.id, p.id))
            items.append(
                {
                    **record(p, ("body",)),
                    "author": s.get(User, p.author_id).name,
                    "unread": not read or read.revision < p.revision,
                }
            )
        return {"items": items, "total": total}


@router.post("", status_code=201)
def create_post(data: PostRequest, request: Request, a: Actor = Depends(actor)):
    enabled(request)
    a.interactive()
    validate_write(data, a)
    with request.app.state.db.session.begin() as s:
        p = Post(**data.model_dump(exclude={"revision"}), author_id=a.id)
        s.add(p)
        s.flush()
        audit(s, a.id, "board.create", p.id, kind=p.kind)
        return record(p)


@router.get("/{post_id}")
def post_detail(post_id: str, request: Request, a: Actor = Depends(actor)):
    enabled(request)
    a.interactive()
    with request.app.state.db.session() as s:
        p = visible_post(s, post_id, a)
        return {**record(p), "body_html": rendered(p.body), "author": s.get(User, p.author_id).name}


@router.post("/{post_id}/read")
def mark_read(post_id: str, request: Request, a: Actor = Depends(actor)):
    enabled(request)
    a.interactive()
    with request.app.state.db.session.begin() as s:
        p = visible_post(s, post_id, a)
        s.merge(PostRead(user_id=a.id, post_id=p.id, revision=p.revision))
    return {"ok": True}


@router.put("/{post_id}")
def edit_post(post_id: str, data: PostRequest, request: Request, a: Actor = Depends(actor)):
    enabled(request)
    a.interactive()
    with request.app.state.db.session.begin() as s:
        p = visible_post(s, post_id, a)
        validate_write(data, a, p)
        if not data.revision:
            raise HTTPException(422, "Revision required")
        changed = s.execute(
            update(Post)
            .where(Post.id == post_id, Post.revision == data.revision)
            .values(
                **data.model_dump(exclude={"revision"}),
                revision=data.revision + 1,
                updated_at=time.time(),
            )
        ).rowcount
        if changed != 1:
            raise HTTPException(409, "Post changed; reload before editing")
        audit(s, a.id, "board.edit", post_id, revision=data.revision + 1)
    return {"ok": True}


@router.get("/{post_id}/comments")
def comments(post_id: str, request: Request, a: Actor = Depends(actor)):
    enabled(request)
    a.interactive()
    with request.app.state.db.session() as s:
        visible_post(s, post_id, a)
        query = select(Comment).where(Comment.target_type == "post", Comment.target_id == post_id)
        if not a.staff:
            query = query.where(Comment.internal.is_(False))
        return [
            {**record(c), "author": s.get(User, c.author_id).name}
            for c in s.scalars(query.order_by(Comment.created_at))
        ]


@router.post("/{post_id}/comments", status_code=201)
def reply(post_id: str, data: CommentRequest, request: Request, a: Actor = Depends(actor)):
    enabled(request)
    a.interactive()
    if data.internal and not a.staff:
        raise HTTPException(403, "Staff required")
    with request.app.state.db.session.begin() as s:
        visible_post(s, post_id, a)
        c = Comment(target_type="post", target_id=post_id, author_id=a.id, **data.model_dump())
        s.add(c)
        s.flush()
        audit(s, a.id, "board.comment", post_id, internal=data.internal)
        return record(c)
