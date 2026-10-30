import { useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { send, timestamp } from "../api";
import {
  Badge,
  Empty,
  ErrorMessage,
  Markdown,
  PageTitle,
  Pagination,
  State,
  Tabs,
  useLoad,
} from "../components";
import { useApp, useText } from "../context";
import { Comments } from "./Scans";
export function Boards() {
  const [params, setParams] = useSearchParams(),
    [writing, setWriting] = useState(false),
    kind = params.get("kind") || "notice",
    page = Number(params.get("page") || 1),
    { user } = useApp(),
    t = useText(),
    load = useLoad(
      `/boards?kind=${kind}&page=${page}&q=${encodeURIComponent(params.get("q") || "")}`,
    ),
    navigate = useNavigate();
  const staff = user.reviewer || user.role === "admin",
    canWrite =
      kind === "voc" || (kind === "notice" ? user.role === "admin" : staff);
  return (
    <>
      <PageTitle
        eyebrow="COMMUNITY"
        title={t("공지사항 · VOC", "Notices · Feedback")}
        description={t(
          "운영 소식과 개선 제안을 함께 정리합니다.",
          "Operational updates and ideas for improvement.",
        )}
        actions={
          canWrite && (
            <button className="primary" onClick={() => setWriting(!writing)}>
              {writing
                ? t("작성 닫기", "Close editor")
                : t("글 작성", "Write a post")}
            </button>
          )
        }
      />
      <Tabs
        values={[
          ["notice", t("공지사항", "Notices")],
          ["voc", "VOC"],
          ...(staff
            ? [
                ["internal", t("내부 검토", "Internal review")] as [
                  string,
                  string,
                ],
              ]
            : []),
        ]}
        selected={kind}
        onChange={(v) => {
          setWriting(false);
          setParams({ kind: v });
        }}
      />
      {writing && (
        <Editor kind={kind} onSave={(p) => navigate("/boards/" + p.id)} />
      )}
      <div className="filters">
        <input
          aria-label={t("게시글 검색", "Search posts")}
          placeholder={t("제목 검색", "Search titles")}
          value={params.get("q") || ""}
          onChange={(e) => setParams({ kind, q: e.target.value })}
        />
      </div>
      <State {...load}>
        {load.data && (
          <section className="panel">
            {load.data.items.length ? (
              load.data.items.map((p: any) => (
                <Link key={p.id} className="post-row" to={"/boards/" + p.id}>
                  <div>
                    <h3>
                      {p.pinned && "⌖ "}
                      {p.title}
                      {p.unread && (
                        <span className="unread-dot" aria-label="Unread" />
                      )}
                    </h3>
                    <small>
                      {p.author} · {timestamp(p.updated_at)}
                      {p.visibility === "private" ? " · Private" : ""}
                    </small>
                  </div>
                  <Badge value={p.status} />
                </Link>
              ))
            ) : (
              <Empty>{t("게시글이 없습니다.", "No posts yet.")}</Empty>
            )}
            <Pagination
              page={page}
              total={load.data.total}
              onChange={(v) => setParams({ kind, page: String(v) })}
            />
          </section>
        )}
      </State>
    </>
  );
}
export function PostDetail() {
  const { id } = useParams(),
    [refresh, setRefresh] = useState(0),
    [edit, setEdit] = useState(false),
    load = useLoad("/boards/" + id, refresh),
    { user } = useApp(),
    t = useText(),
    post = load.data,
    [error, setError] = useState(""),
    [read, setRead] = useState(false);
  return (
    <State {...load}>
      {post && (
        <>
          <PageTitle
            eyebrow={post.kind.toUpperCase()}
            title={post.title}
            description={`${post.author} · ${timestamp(post.updated_at)}`}
            actions={
              (post.author_id === user.id ||
                user.role === "admin" ||
                (user.reviewer && post.kind !== "notice")) && (
                <button onClick={() => setEdit(!edit)}>
                  {t("수정", "Edit")}
                </button>
              )
            }
          />
          <ErrorMessage value={error} />
          {edit ? (
            <Editor
              kind={post.kind}
              original={post}
              onSave={() => {
                setEdit(false);
                setRefresh((x) => x + 1);
              }}
            />
          ) : (
            <article className="panel post-body">
              <div className="toolbar">
                <Badge value={post.status} />
                {post.visibility === "private" && <Badge value="private" />}
              </div>
              <Markdown>{post.body}</Markdown>
              <button
                disabled={read}
                onClick={async () => {
                  try {
                    await send(`/boards/${id}/read`, {});
                    setRead(true);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {read
                  ? t("읽음 처리됨", "Marked as read")
                  : t("읽음으로 표시", "Mark as read")}
              </button>
            </article>
          )}
          <Comments endpoint={`/boards/${id}/comments`} />
        </>
      )}
    </State>
  );
}
function Editor({
  kind,
  original,
  onSave,
}: {
  kind: string;
  original?: any;
  onSave: (p: any) => void;
}) {
  const [body, setBody] = useState(original?.body || ""),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    { user } = useApp(),
    t = useText(),
    staff = user.role === "admin" || user.reviewer;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      const result = await send(
        original ? "/boards/" + original.id : "/boards",
        {
          kind,
          title: data.get("title"),
          body,
          visibility: data.get("visibility") || "public",
          status: data.get("status") || original?.status || "open",
          pinned: staff ? data.has("pinned") : Boolean(original?.pinned),
          revision: original?.revision,
        },
        original ? "PUT" : "POST",
      );
      onSave(original || result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel">
      <form onSubmit={submit}>
        <ErrorMessage value={error} />
        <label>
          {t("제목", "Title")}
          <input
            name="title"
            defaultValue={original?.title}
            maxLength={200}
            required
          />
        </label>
        <div className="toolbar">
          <button type="button" onClick={() => setPreview(false)}>
            {t("작성", "Write")}
          </button>
          <button type="button" onClick={() => setPreview(true)}>
            {t("미리보기", "Preview")}
          </button>
        </div>
        {preview ? (
          <div className="markdown-preview">
            <Markdown>{body}</Markdown>
          </div>
        ) : (
          <label>
            {t("본문", "Body")}
            <textarea
              className="editor"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={50000}
              required
            />
          </label>
        )}
        <div className="inline-form">
          <label>
            {t("공개 범위", "Visibility")}
            <select
              name="visibility"
              defaultValue={original?.visibility || "public"}
            >
              <option value="public">{t("전체 공개", "Public")}</option>
              <option value="private">
                {t("작성자 · 운영자만", "Author & staff")}
              </option>
            </select>
          </label>
          <label>
            {t("상태", "Status")}
            <select
              name="status"
              disabled={
                !staff &&
                original &&
                !["draft", "open"].includes(original.status)
              }
              defaultValue={original?.status || "open"}
            >
              {(staff
                ? [
                    "draft",
                    "open",
                    "triaged",
                    "planned",
                    "in_progress",
                    "resolved",
                    "closed",
                  ]
                : Array.from(
                    new Set(
                      ["draft", "open", original?.status].filter(Boolean),
                    ),
                  )
              ).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {staff && (
            <label className="check">
              <input
                name="pinned"
                type="checkbox"
                defaultChecked={original?.pinned}
              />
              {t("상단 고정", "Pin post")}
            </label>
          )}
        </div>
        <button className="primary" disabled={busy || !body.trim()}>
          {t("저장", "Save")}
        </button>
      </form>
    </section>
  );
}
