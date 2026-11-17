import {
  SavedViews,
  ListLink,
  ListBackLink,
  useListContext,
} from "../SavedViews";
import { useDraft } from "../useDraft";
import { sessionCoordinator } from "../session";
import { DraftRecovery } from "../DraftRecovery";
import { useAccountMutation } from "../accountMutations";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, APIError, timestamp } from "../api";
import {
  Badge,
  Empty,
  ErrorMessage,
  PageTitle,
  Pagination,
  State,
  Tabs,
  useLoad,
} from "../components";
import { useApp, useText } from "../context";
import { Admission, Comments, Findings } from "./Scans";
import {
  ReviewActivity,
  ReviewAssignment,
  workflowLabel,
} from "./ReviewActivity";
export function Reviews() {
  const [params, setParams] = useSearchParams(),
    { user, reviewWorkflow } = useApp(),
    staff = user.role === "admin" || user.reviewer,
    t = useText(),
    tab = params.get("tab") || (staff ? "pending" : "mine"),
    unavailable =
      (!staff && tab !== "mine") || (tab === "actionable" && !user.reviewer),
    pendingOnly = tab === "mine" && params.get("status") === "pending",
    page = Number(params.get("page") || 1),
    load = useLoad(
      `/reviews?${new URLSearchParams({ ...Object.fromEntries([...params].filter(([key]) => ["status", "stage", "assignee", "q", "sort"].includes(key))), tab, page: String(page) })}`,
    );
  const rememberPosition = useListContext(
    "reviews",
    load.loading || unavailable ? null : load.data,
    page,
  );
  const [search, setSearch] = useState(params.get("q") || "");
  useEffect(() => setSearch(params.get("q") || ""), [params.get("q")]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("tab", tab);
    next.set("page", "1");
    rememberPosition();
    setParams(next);
  }
  useEffect(() => {
    if (search === (params.get("q") || "")) return;
    const timer = setTimeout(() => filter("q", search), 250);
    return () => clearTimeout(timer);
  }, [search, params]);
  return (
    <>
      <PageTitle
        eyebrow="HUMAN REVIEW"
        title={t("검토", "Reviews")}
        description={t(
          user.reviewer
            ? "위험 근거와 요청 사유를 확인하고 반입 여부를 결정합니다."
            : staff
              ? "검토 요청과 진행 상황을 확인합니다."
              : "내가 요청한 검토의 진행 상황과 결정을 확인합니다.",
          user.reviewer
            ? "Review evidence and requests before deciding admission."
            : staff
              ? "View review requests and their progress."
              : "Track your review requests and decisions.",
        )}
      />
      <SavedViews resource="reviews" beforeNavigate={rememberPosition} />
      {unavailable && (
        <ErrorMessage
          value={t(
            "직원 권한이 필요합니다. 내 요청 탭으로 변경하세요.",
            "Staff access required; select My requests.",
          )}
        />
      )}
      <Tabs
        values={
          staff
            ? [
                ["pending", t("검토 필요", "Needs review")],
                ...(reviewWorkflow && user.reviewer
                  ? [
                      [
                        "actionable",
                        t("내가 처리할 요청", "My actionable reviews"),
                      ] as [string, string],
                    ]
                  : []),
                ["mine", t("내 요청", "My requests")],
                ["approved", t("승인됨", "Approved")],
                ["all", t("전체", "All")],
              ]
            : [["mine", t("내 요청", "My requests")]]
        }
        selected={tab}
        onChange={(v) => {
          rememberPosition();
          setParams({ tab: v, page: "1" });
        }}
      />
      {reviewWorkflow && (
        <section
          className="filters"
          aria-label={t("검토 필터", "Review filters")}
        >
          <label>
            {t("검색", "Search")}
            <input
              aria-label={t("검토 검색", "Search reviews")}
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            {t("진행 단계", "Workflow stage")}
            <select
              aria-label={t("진행 단계", "Workflow stage")}
              value={params.get("stage") || ""}
              onChange={(e) => filter("stage", e.target.value)}
            >
              <option value="">{t("모든 단계", "All stages")}</option>
              {["waiting", "in_review", "changes_requested", "closed"].map(
                (value) => (
                  <option key={value} value={value}>
                    {workflowLabel(value, t)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            {t("담당자", "Assignee")}
            <select
              aria-label={t("담당자", "Assignee")}
              value={params.get("assignee") || "any"}
              onChange={(e) => filter("assignee", e.target.value)}
            >
              <option value="any">{t("모든 담당", "Any assignee")}</option>
              <option value="me">{t("내 담당", "Assigned to me")}</option>
              <option value="unassigned">{t("미배정", "Unassigned")}</option>
            </select>
          </label>
          <label>
            {t("정렬", "Sort")}
            <select
              aria-label={t("정렬", "Sort")}
              value={params.get("sort") || "newest"}
              onChange={(e) => filter("sort", e.target.value)}
            >
              <option value="newest">{t("최신순", "Newest first")}</option>
              <option value="oldest">{t("오래된 순", "Oldest first")}</option>
            </select>
          </label>
        </section>
      )}
      {pendingOnly && (
        <p className="panel-note">
          {t(
            "대기 중인 내 요청만 표시합니다.",
            "Showing only your pending requests.",
          )}{" "}
          <button
            onClick={() => {
              rememberPosition();
              setParams({ tab: "mine" });
            }}
          >
            {t("전체 보기", "Show all")}
          </button>
        </p>
      )}
      {!unavailable && (
        <State {...load}>
          {load.data && (
            <section className="panel">
              {load.data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("검토 대상", "Source")}</th>
                        <th>{t("요청 사유", "Reason")}</th>
                        <th>{t("상태", "Status")}</th>
                        <th>{t("요청 시각", "Requested")}</th>
                        <th>{t("담당 · 진행", "Assignment · workflow")}</th>
                        <th>{t("대기시간", "Waiting time")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {load.data.items.map((r: any) => (
                        <tr key={r.id}>
                          <td>
                            <ListLink
                              resource="reviews"
                              to={"/reviews/" + r.id}
                            >
                              {r.source}
                            </ListLink>
                          </td>
                          <td>{r.reason}</td>
                          <td>
                            <Badge value={r.status} />
                          </td>
                          <td>{timestamp(r.created_at)}</td>
                          <td>
                            {r.assignee?.name || t("미배정", "Unassigned")} ·{" "}
                            {workflowLabel(r.workflow_state, t)}
                          </td>
                          <td>
                            {r.status === "pending"
                              ? `${Math.max(0, Math.floor((Date.now() / 1000 - r.created_at) / 60))} ${t("분", "min")}`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  {t("해당 검토 요청이 없습니다.", "No reviews in this queue.")}
                </Empty>
              )}
              <Pagination
                page={page}
                total={load.data.total}
                onChange={(v) => {
                  const next = new URLSearchParams(params);
                  next.set("tab", tab);
                  next.set("page", String(v));
                  rememberPosition();
                  setParams(next);
                }}
              />
            </section>
          )}
        </State>
      )}
    </>
  );
}
export function ReviewDetail() {
  const send = useAccountMutation();
  const { id } = useParams(),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [conflictToken, setConflictToken] = useState<object | null>(null),
    [rejectedRevision, setRejectedRevision] = useState<number | null>(null),
    [denied, setDenied] = useState(false),
    [uncertain, setUncertain] = useState(false),
    load = useLoad("/reviews/" + id, refresh, 4000),
    { user, reconcileSession } = useApp(),
    t = useText(),
    r = load.data;
  const readVerified =
    rejectedRevision === null ||
    (!!r && !load.error && r.revision > rejectedRevision);
  const canDecide =
    !denied &&
    !uncertain &&
    readVerified &&
    r?.status === "pending" &&
    user.reviewer &&
    r?.requester_id !== user.id &&
    ((!r?.assignee_id &&
      (!r?.workflow_state || r.workflow_state === "waiting")) ||
      (r?.assignee_id === user.id && r?.workflow_state === "in_review"));
  const draft = useDraft({
    kind: "review_decision",
    targetId: id!,
    enabled:
      !!r && (!load.error || load.retryable) && r.requester_id !== user.id,
    writable: canDecide,
    conflictToken,
    initialFields: { decision: "rejected", reason: "" },
    baseRevision: r?.revision ?? null,
    baseState: {
      status: r?.status,
      decided_at: r?.decided_at == null ? null : String(r.decided_at),
      review_id: r?.id,
    },
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submission = draft.beginSubmission();
    setBusy(true);
    try {
      await send(`/reviews/${id}/decision`, {
        decision: submission.fields.decision,
        reason: submission.fields.reason,
        ...(submission.baseRevision !== null
          ? { expected_revision: submission.baseRevision }
          : {}),
      });
      if (!draft.markSubmitted(submission)) return;
      setRefresh((x) => x + 1);
    } catch (e) {
      if (!draft.isCurrentSubmission(submission)) return;
      setError((e as Error).message);
      if (e instanceof APIError && e.status === 409) {
        setConflictToken({});
        setRejectedRevision(submission.baseRevision);
        setRefresh((x) => x + 1);
      }
      if (e instanceof TypeError || (e instanceof APIError && e.status >= 500))
        setUncertain(true);
      if (e instanceof APIError && e.status === 403) {
        sessionCoordinator.flush();
        setDenied(true);
        reconcileSession(user.id);
      }
    } finally {
      if (draft.isCurrentSubmission(submission)) setBusy(false);
    }
  }
  async function verifyOutcome() {
    const receipt = draft.beginSubmission();
    setBusy(true);
    try {
      const latest = await api(`/reviews/${id}`);
      if (!draft.isCurrentSubmission(receipt)) return;
      if (latest.revision !== r?.revision) {
        setConflictToken({});
        setRejectedRevision(receipt.baseRevision);
      }
      setUncertain(false);
      setError("");
      setRefresh((x) => x + 1);
    } catch (e) {
      if (draft.isCurrentSubmission(receipt)) setError((e as Error).message);
    } finally {
      if (draft.isCurrentSubmission(receipt)) setBusy(false);
    }
  }
  return (
    <>
      <ListBackLink resource="reviews" className="back">
        {t("검토 목록", "Reviews list")}
      </ListBackLink>
      <State {...load} preserveContent={!!r && (!load.error || load.retryable)}>
        {r && (
          <>
            <PageTitle
              eyebrow="REVIEW REQUEST"
              title={t("검토 상세", "Review details")}
              actions={
                <Link to={"/jobs/" + r.job_id}>
                  {t("원본 검사", "Original scan")} ↗
                </Link>
              }
            />
            <section className="panel review-reason">
              <Badge value={r.status} />
              {r.status === "withdrawn" && <p>{t("철회됨", "Withdrawn")}</p>}
              {r.closed_reason && (
                <>
                  <h3>{t("종료 사유", "Closure reason")}</h3>
                  <p>{r.closed_reason}</p>
                </>
              )}
              <h2>{t("요청 사유", "Request reason")}</h2>
              <p>{r.reason}</p>
              {r.decision_reason && (
                <>
                  <h3>{t("결정 사유", "Decision reason")}</h3>
                  <p>{r.decision_reason}</p>
                  <small>{timestamp(r.decided_at)}</small>
                </>
              )}
            </section>
            <ReviewAssignment
              review={r}
              onChanged={() => setRefresh((x) => x + 1)}
              readVerified={!load.error || load.retryable}
            />
            <Admission job={r.job} />
            <Findings findings={r.job.result.findings || []} />
            <DraftRecovery
              draft={draft}
              latest={r.decision_reason || r.reason}
            />
            <ErrorMessage value={error} />
            {(rejectedRevision !== null || denied) && (
              <button
                onClick={() => {
                  setRefresh((x) => x + 1);
                  if (denied) {
                    sessionCoordinator.flush();
                    reconcileSession(user.id);
                  }
                }}
              >
                {t("최신 검토 다시 조회", "Reload review")}
              </button>
            )}
            {uncertain && (
              <p role="status">
                {t(
                  "저장 여부가 불명확합니다. 최신 검토를 확인한 뒤 직접 재시도하세요.",
                  "The write outcome is unknown. Check the latest review before retrying.",
                )}{" "}
                <button disabled={busy} onClick={() => void verifyOutcome()}>
                  {t("최신 검토 확인", "Check latest review")}
                </button>
              </p>
            )}
            {canDecide && (
              <section className="panel form-panel">
                <h2>{t("검토 결정", "Review decision")}</h2>
                <form onSubmit={submit}>
                  <fieldset disabled={draft.locked}>
                    <label>
                      {t("결정", "Decision")}
                      <select
                        name="decision"
                        value={String(draft.fields.decision)}
                        onChange={(e) =>
                          draft.update("decision", e.target.value)
                        }
                      >
                        <option value="rejected">{t("반려", "Reject")}</option>
                        <option
                          value="approved"
                          disabled={!r.job.result.coverage_complete}
                        >
                          {t("승인", "Approve")}
                        </option>
                      </select>
                    </label>
                    {!r.job.result.coverage_complete && (
                      <p className="muted">
                        {t(
                          "필수 검사가 완료되어야 승인할 수 있습니다.",
                          "Required scan coverage must complete before approval.",
                        )}
                      </p>
                    )}
                    <label>
                      {t("결정 사유", "Decision reason")}
                      <textarea
                        name="reason"
                        aria-label={t("결정 사유", "Decision reason")}
                        value={String(draft.fields.reason)}
                        onChange={(e) => draft.update("reason", e.target.value)}
                        minLength={5}
                        maxLength={4000}
                        required
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      {t("결정 저장", "Save decision")}
                    </button>
                  </fieldset>
                </form>
              </section>
            )}
            {r.requester_id === user.id && r.status === "pending" && (
              <p className="panel-note">
                {t(
                  "본인이 요청한 검사는 다른 검토자가 결정해야 합니다.",
                  "Another reviewer must decide your request.",
                )}
              </p>
            )}
            <ReviewActivity reviewId={r.id} revision={r.revision} />
            <Comments endpoint={`/scans/${r.job_id}/comments`} />
          </>
        )}
      </State>
    </>
  );
}
