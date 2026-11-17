import {
  SavedViews,
  ListLink,
  ListBackLink,
  useListContext,
} from "../SavedViews";
import { useDraft } from "../useDraft";
import { DraftRecovery } from "../DraftRecovery";
import { useAccountMutation } from "../accountMutations";
import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { timestamp } from "../api";
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
export function Reviews() {
  const [params, setParams] = useSearchParams(),
    { user } = useApp(),
    staff = user.role === "admin" || user.reviewer,
    t = useText(),
    tab = params.get("tab") || (staff ? "pending" : "mine"),
    unavailable = !staff && tab !== "mine",
    pendingOnly = tab === "mine" && params.get("status") === "pending",
    page = Number(params.get("page") || 1),
    load = useLoad(
      `/reviews?tab=${tab}&page=${page}${params.get("status") ? "&status=" + encodeURIComponent(params.get("status")!) : ""}`,
    );
  const rememberPosition = useListContext(
    "reviews",
    load.loading || unavailable ? null : load.data,
    page,
  );
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
    load = useLoad("/reviews/" + id, refresh, 4000),
    { user } = useApp(),
    t = useText(),
    r = load.data;
  const draft = useDraft({
    kind: "review_decision",
    targetId: id!,
    enabled:
      !!r && (!load.error || load.retryable) && r.requester_id !== user.id,
    writable:
      r?.status === "pending" && user.reviewer && r?.requester_id !== user.id,
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
      });
      if (!draft.markSubmitted(submission)) return;
      setRefresh((x) => x + 1);
    } catch (e) {
      if (!draft.isCurrentSubmission(submission)) return;
      setError((e as Error).message);
    } finally {
      if (draft.isCurrentSubmission(submission)) setBusy(false);
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
            <Admission job={r.job} />
            <Findings findings={r.job.result.findings || []} />
            <DraftRecovery
              draft={draft}
              latest={r.decision_reason || r.reason}
            />
            {r.status === "pending" &&
              user.reviewer &&
              r.requester_id !== user.id && (
                <section className="panel form-panel">
                  <h2>{t("검토 결정", "Review decision")}</h2>
                  <form onSubmit={submit}>
                    <fieldset disabled={draft.locked}>
                      <ErrorMessage value={error} />
                      <label>
                        {t("결정", "Decision")}
                        <select
                          name="decision"
                          value={String(draft.fields.decision)}
                          onChange={(e) =>
                            draft.update("decision", e.target.value)
                          }
                        >
                          <option value="rejected">
                            {t("반려", "Reject")}
                          </option>
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
                          onChange={(e) =>
                            draft.update("reason", e.target.value)
                          }
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
            <Comments endpoint={`/scans/${r.job_id}/comments`} />
          </>
        )}
      </State>
    </>
  );
}
