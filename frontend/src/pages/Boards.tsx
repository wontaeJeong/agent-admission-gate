import { useDraft } from "../useDraft";
import { DraftRecovery } from "../DraftRecovery";
import { useDirtyForms } from "../DirtyForms";
import { useAccountMutation } from "../accountMutations";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  api,
  APIError,
  APIResponseError,
  requireResourceIdentity,
  timestamp,
} from "../api";
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
    { user, boards } = useApp(),
    t = useText(),
    load = useLoad(
      `/boards?kind=${kind}&page=${page}&q=${encodeURIComponent(params.get("q") || "")}`,
    ),
    navigate = useNavigate();
  const { confirmLeave } = useDirtyForms();
  useEffect(() => setWriting(false), [kind]);
  const staff = user.reviewer || user.role === "admin",
    canWrite =
      boards &&
      !!load.data &&
      (!load.error || load.retryable) &&
      (kind === "voc" || (kind === "notice" ? user.role === "admin" : staff));
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
            <button
              className="primary"
              onClick={() => {
                if (confirmLeave()) setWriting(!writing);
              }}
            >
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
          setParams({ kind: v });
        }}
      />
      {writing && canWrite && (
        <Editor
          key={kind}
          kind={kind}
          onVerified={load.retry}
          onSave={(p) => navigate("/boards/" + p.id)}
        />
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
  const send = useAccountMutation();
  const { id } = useParams(),
    [refresh, setRefresh] = useState(0),
    [edit, setEdit] = useState(false),
    [conflictSnapshot, setConflictSnapshot] = useState<{
      revision: number | null;
    } | null>(null),
    load = useLoad("/boards/" + id, refresh, 4000),
    { user } = useApp(),
    t = useText(),
    post = load.data,
    [error, setError] = useState(""),
    [read, setRead] = useState(false);
  const { confirmLeave } = useDirtyForms();
  const staff = user.role === "admin" || user.reviewer;
  const canEdit =
    post &&
    (post.kind === "notice"
      ? user.role === "admin"
      : post.kind === "internal"
        ? staff
        : post.author_id === user.id || staff);
  return (
    <State
      {...load}
      preserveContent={!!post && (!load.error || load.retryable)}
    >
      {post && (
        <>
          <PageTitle
            eyebrow={post.kind.toUpperCase()}
            title={post.title}
            description={`${post.author} · ${timestamp(post.updated_at)}`}
            actions={
              canEdit && (
                <button
                  onClick={() => {
                    if (confirmLeave()) setEdit(!edit);
                  }}
                >
                  {t("수정", "Edit")}
                </button>
              )
            }
          />
          <ErrorMessage value={error} />
          {edit && canEdit ? (
            <Editor
              key={post.id}
              kind={post.kind}
              original={post}
              readVerified={
                !conflictSnapshot ||
                (conflictSnapshot.revision !== null &&
                  post.revision > conflictSnapshot.revision)
              }
              conflictToken={conflictSnapshot}
              onConflict={(revision) => {
                setConflictSnapshot({ revision });
                setRefresh((value) => value + 1);
              }}
              onSave={() => {
                setConflictSnapshot(null);
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
  onConflict,
  onVerified,
  readVerified = true,
  conflictToken,
}: {
  kind: string;
  original?: any;
  onSave: (p: any) => void;
  onConflict?: (rejectedRevision: number | null) => void;
  onVerified?: () => void;
  readVerified?: boolean;
  conflictToken?: object | null;
}) {
  const send = useAccountMutation();
  const [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    { user, boards } = useApp(),
    t = useText(),
    staff = user.role === "admin" || user.reviewer;
  const draft = useDraft({
    kind: "board_post",
    targetId: original?.id ?? `new:${kind}`,
    enabled: boards,
    conflictToken,
    writable:
      boards &&
      readVerified &&
      (kind === "notice"
        ? user.role === "admin"
        : kind === "internal"
          ? staff
          : !original || original.author_id === user.id || staff),
    initialFields: {
      title: original?.title ?? "",
      body: original?.body ?? "",
      visibility: original?.visibility ?? "public",
      status: original?.status ?? "open",
      pinned: !!original?.pinned,
    },
    baseRevision: original?.revision ?? null,
    baseState: { status: original?.status ?? null },
  });
  const body = String(draft.fields.body);
  const pending = useRef(false);
  const receipt = useRef<ReturnType<typeof draft.beginSubmission> | null>(null);
  const [uncertain, setUncertain] = useState(false),
    [checking, setChecking] = useState(false),
    [checked, setChecked] = useState<{ id: string; title: string }[] | null>(
      null,
    );
  async function checkLatest() {
    const submission = receipt.current;
    if (!submission || checking) return;
    setChecking(true);
    try {
      const latest = await api(
        "/boards?kind=" + encodeURIComponent(kind) + "&page=1",
      );
      if (!draft.isCurrentSubmission(submission)) return;
      if (!Array.isArray(latest.items)) throw new APIResponseError();
      latest.items.forEach(requireResourceIdentity);
      setChecked(latest.items);
      // Refresh the current list under the weak receipt guard; keep newer edits.
      onVerified?.();
      setUncertain(false);
      setError("");
    } catch (e) {
      if (draft.isCurrentSubmission(submission)) setError((e as Error).message);
    } finally {
      if (draft.isCurrentSubmission(submission)) setChecking(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current || draft.locked || uncertain) return;
    pending.current = true;
    const submission = draft.beginSubmission();
    receipt.current = submission;
    setBusy(true);
    setError("");
    setChecked(null);
    try {
      const result = await send(
        original ? "/boards/" + original.id : "/boards",
        {
          kind,
          title: submission.fields.title,
          body: submission.fields.body,
          visibility: submission.fields.visibility,
          status: submission.fields.status,
          pinned: staff ? submission.fields.pinned : Boolean(original?.pinned),
          revision: submission.baseRevision,
        },
        original ? "PUT" : "POST",
      );
      if (!original) requireResourceIdentity(result);
      if (!draft.markSubmitted(submission)) return;
      onSave(original || result);
    } catch (e) {
      if (!draft.isCurrentSubmission(submission)) return;
      setError((e as Error).message);
      if (!original && (!(e instanceof APIError) || e.status >= 500))
        setUncertain(true);
      if (e instanceof APIError && e.status === 409)
        onConflict?.(submission.baseRevision);
    } finally {
      if (draft.isCurrentSubmission(submission)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="panel form-panel">
      <DraftRecovery
        draft={draft}
        latest={original ? `${original.title}\n${original.body}` : undefined}
      />
      {uncertain && (
        <section className="notice" role="status">
          <p>
            {t(
              "저장 여부를 확인하지 못했습니다. 최신 게시글을 확인한 뒤 재제출 여부를 결정하세요.",
              "Submission outcome is unknown. Check latest posts before deciding whether to submit again.",
            )}
          </p>
          <button type="button" disabled={checking} onClick={checkLatest}>
            {t("최신 게시글 확인", "Check latest posts")}
          </button>
        </section>
      )}
      {checked && (
        <section className="notice" role="status">
          <p>
            {t(
              "최신 게시글을 확인했습니다. 다시 제출하기 전에 목록을 검토하세요.",
              "Latest posts checked. Review the list before submitting again.",
            )}
          </p>
          {checked.map((post) => (
            <p key={post.id}>
              <Link to={"/boards/" + post.id}>{post.title}</Link>
            </p>
          ))}
          <Link to={"/boards?kind=" + encodeURIComponent(kind)}>
            {t("게시글 목록 보기", "View posts")}
          </Link>
        </section>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={draft.locked}>
          <ErrorMessage value={error} />
          <label>
            {t("제목", "Title")}
            <input
              name="title"
              value={String(draft.fields.title)}
              onChange={(e) => draft.update("title", e.target.value)}
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
                aria-label={t("본문", "Body")}
                value={body}
                onChange={(e) => draft.update("body", e.target.value)}
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
                value={String(draft.fields.visibility)}
                onChange={(e) => draft.update("visibility", e.target.value)}
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
                value={String(draft.fields.status)}
                onChange={(e) => draft.update("status", e.target.value)}
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
                  checked={!!draft.fields.pinned}
                  onChange={(e) => draft.update("pinned", e.target.checked)}
                />
                {t("상단 고정", "Pin post")}
              </label>
            )}
          </div>
          <button
            className="primary"
            disabled={busy || uncertain || !body.trim()}
          >
            {t("저장", "Save")}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
