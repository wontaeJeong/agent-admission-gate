import { useState } from "react";
import { api, APIError, timestamp } from "../api";
import { useAccountMutation } from "../accountMutations";
import { useApp, useText } from "../context";
import { DraftRecovery } from "../DraftRecovery";
import { ErrorMessage, State, useLoad } from "../components";
import { useDraft } from "../useDraft";
import { sessionCoordinator } from "../session";
import type { DraftKind } from "../drafts";

type Text = (ko: string, en: string) => string;
export function workflowLabel(state: string, t: Text) {
  return (
    (
      {
        waiting: t("미배정 대기", "Waiting"),
        in_review: t("검토 중", "In review"),
        changes_requested: t("보완 대기", "Changes requested"),
        closed: t("종료", "Closed"),
      } as Record<string, string>
    )[state] || "—"
  );
}
export function ReviewActivity({
  reviewId,
  revision,
}: {
  reviewId: string;
  revision: number;
}) {
  const t = useText(),
    [after, setAfter] = useState("");
  const load = useLoad(
    `/reviews/${reviewId}/events${after ? "?after=" + after : ""}`,
    revision,
  );
  const labels: Record<string, string> = {
    claim: t("담당 지정", "Claimed"),
    release: t("담당 해제", "Released"),
    request_changes: t("보완 요청", "Changes requested"),
    respond: t("설명 보충", "Explanation added"),
    withdraw: t("철회", "Withdrawn"),
    approved: t("승인", "Approved"),
    rejected: t("반려", "Rejected"),
  };
  return (
    <section className="panel form-panel">
      <h2>{t("업무 이력", "Workflow activity")}</h2>
      <State {...load}>
        {load.data && (
          <>
            {!load.data.items.length && (
              <p>
                {t(
                  "기록된 업무 이력이 없습니다.",
                  "No workflow activity recorded.",
                )}
              </p>
            )}
            <ol>
              {load.data.items.map((event: any) => (
                <li key={event.id}>
                  <b>{labels[event.kind] || event.kind}</b> · {event.actor_name}{" "}
                  · {timestamp(event.created_at)}
                  <p>
                    {workflowLabel(event.from_state, t)} →{" "}
                    {workflowLabel(event.to_state, t)}
                  </p>
                  {event.reason && <p>{event.reason}</p>}
                </li>
              ))}
            </ol>
            {after && (
              <button onClick={() => setAfter("")}>
                {t("처음부터 보기", "First activity page")}
              </button>
            )}
            {load.data.next_cursor && (
              <button onClick={() => setAfter(load.data.next_cursor)}>
                {t("다음 이력", "Next activity page")}
              </button>
            )}
          </>
        )}
      </State>
    </section>
  );
}

export function ReviewAssignment({
  review: r,
  onChanged,
  readVerified,
}: {
  review: any;
  onChanged: () => void;
  readVerified: boolean;
}) {
  const { user } = useApp(),
    t = useText();
  const stale = r.assignee && (!r.assignee.active || !r.assignee.qualified);
  const pending = r.status === "pending";
  const owner = r.requester_id === user.id;
  const canRelease =
    pending &&
    !!r.assignee &&
    (r.assignee.id === user.id ||
      user.role === "admin" ||
      (user.reviewer && stale));
  const canClaim =
    pending &&
    r.workflow_state === "waiting" &&
    !r.assignee &&
    user.reviewer &&
    !owner;
  const canRequest =
    pending &&
    r.workflow_state === "in_review" &&
    r.assignee_id === user.id &&
    user.reviewer &&
    !owner;
  return (
    <section className="panel form-panel">
      <h2>{t("담당 · 진행", "Assignment · workflow")}</h2>
      <p>
        {t("담당자: ", "Assignee: ")}
        {r.assignee?.name || t("미배정", "Unassigned")}
      </p>
      <p>
        {workflowLabel(r.workflow_state, t)} · {t("버전", "Revision")}{" "}
        {r.revision}
      </p>
      {stale && (
        <p>
          {t(
            "담당자가 비활성 상태이거나 로컬 검토 자격이 없습니다.",
            "The assignee is inactive or lacks local reviewer qualification.",
          )}
        </p>
      )}
      <ReviewAction
        review={r}
        onChanged={onChanged}
        readVerified={readVerified}
        action="release"
        eligible={!!canRelease}
        canClaim={!!canClaim}
      />
      <ReviewAction
        review={r}
        onChanged={onChanged}
        readVerified={readVerified}
        action="request-changes"
        eligible={canRequest}
      />
      <ReviewAction
        review={r}
        onChanged={onChanged}
        readVerified={readVerified}
        action="respond"
        eligible={pending && owner && r.workflow_state === "changes_requested"}
      />
      <ReviewAction
        review={r}
        onChanged={onChanged}
        readVerified={readVerified}
        action="withdraw"
        eligible={pending && owner}
      />
    </section>
  );
}

type Action = "release" | "request-changes" | "respond" | "withdraw";
function ReviewAction({
  review: r,
  onChanged,
  readVerified,
  action,
  eligible,
  canClaim = false,
}: {
  review: any;
  onChanged: () => void;
  readVerified: boolean;
  action: Action;
  eligible: boolean;
  canClaim?: boolean;
}) {
  const { user, reviewWorkflow, reconcileSession } = useApp(),
    t = useText(),
    send = useAccountMutation();
  const labels = {
    release: [
      t("담당 해제", "Release assignment"),
      t("해제 사유", "Release reason"),
      t("해제 확인", "Confirm release"),
    ],
    "request-changes": [
      t("보완 요청", "Request changes"),
      t("보완 요청 사유", "Supplement request reason"),
      t("보완 요청 확인", "Confirm supplement request"),
    ],
    respond: [
      t("설명 보충", "Add explanation"),
      t("보충 설명", "Supplementary explanation"),
      t("설명 보내기", "Send explanation"),
    ],
    withdraw: [
      t("요청 철회", "Withdraw request"),
      t("철회 사유", "Withdrawal reason"),
      t("철회 확인", "Confirm withdrawal"),
    ],
  }[action];
  const kinds: Record<Action, DraftKind> = {
    release: "review_release",
    "request-changes": "review_changes",
    respond: "review_respond",
    withdraw: "review_withdraw",
  };
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflictToken, setConflictToken] = useState<object | null>(null),
    [rejected, setRejected] = useState<number | null>(null),
    [denied, setDenied] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const current =
    readVerified &&
    (rejected === null || r.revision > rejected) &&
    !denied &&
    !uncertain;
  const draft = useDraft({
    kind: kinds[action],
    targetId: r.id,
    enabled: true,
    writable: !!reviewWorkflow && current && (eligible || canClaim),
    initialFields: { reason: "" },
    baseRevision: r.revision,
    conflictToken,
  });
  async function mutate(target: Action | "claim") {
    const submission = draft.beginSubmission();
    setBusy(true);
    setError("");
    try {
      await send("/reviews/" + r.id + "/" + target, {
        expected_revision: submission.baseRevision,
        ...(target !== "claim" && submission.fields.reason
          ? { reason: submission.fields.reason }
          : {}),
      });
      if (!draft.markSubmitted(submission)) return;
      setOpen(false);
      onChanged();
    } catch (e) {
      if (!draft.isCurrentSubmission(submission)) return;
      setError((e as Error).message);
      if (e instanceof APIError && e.status === 409) {
        setConflictToken({});
        setRejected(submission.baseRevision);
        onChanged();
      }
      if (e instanceof APIError && e.status === 403) {
        sessionCoordinator.flush();
        setDenied(true);
        reconcileSession(user.id);
      }
      if (e instanceof TypeError || (e instanceof APIError && e.status >= 500))
        setUncertain(true);
    } finally {
      if (draft.isCurrentSubmission(submission)) setBusy(false);
    }
  }
  async function verifyOutcome() {
    const receipt = draft.beginSubmission();
    setBusy(true);
    try {
      const latest = await api("/reviews/" + r.id);
      if (!draft.isCurrentSubmission(receipt)) return;
      if (latest.revision !== r.revision) {
        setConflictToken({});
        setRejected(receipt.baseRevision);
      }
      setUncertain(false);
      setError("");
      onChanged();
    } catch (e) {
      if (!draft.isCurrentSubmission(receipt)) return;
      setError((e as Error).message);
      if (e instanceof APIError && [401, 403, 404].includes(e.status))
        onChanged();
    } finally {
      if (draft.isCurrentSubmission(receipt)) setBusy(false);
    }
  }
  return (
    <div>
      <ErrorMessage value={error} />
      {(rejected !== null || denied || uncertain) && (
        <p role="status">
          {t(
            "최신 상태를 확인한 뒤 다시 작업하세요. 입력한 사유는 유지됩니다.",
            "Review the latest state before retrying. Your reason is retained.",
          )}{" "}
          <button
            onClick={() => {
              onChanged();
              if (denied) {
                sessionCoordinator.flush();
                reconcileSession(user.id);
              }
            }}
          >
            {t("최신 검토 다시 조회", "Reload review")}
          </button>
        </p>
      )}
      {uncertain && (
        <button disabled={busy} onClick={() => void verifyOutcome()}>
          {t("최신 검토 확인", "Check latest review")}
        </button>
      )}
      <DraftRecovery draft={draft} />
      {reviewWorkflow && (
        <>
          {canClaim && (
            <button
              disabled={busy || !current || draft.locked}
              onClick={() => void mutate("claim")}
            >
              {busy
                ? t("저장 중…", "Saving…")
                : t("내가 검토하기", "Claim review")}
            </button>
          )}
          {eligible && !open && (
            <button disabled={busy || !current} onClick={() => setOpen(true)}>
              {labels[0]}
            </button>
          )}
          {open && eligible && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(action);
              }}
            >
              {action === "withdraw" && (
                <p>
                  {t(
                    "대기 중인 검토 요청만 닫습니다. 검사 판정은 변경하지 않습니다.",
                    "Closes this pending review request. The scan verdict stays unchanged.",
                  )}
                </p>
              )}
              {action === "respond" && (
                <p>
                  {t(
                    "설명만 보충합니다. 검사한 파일과 결과는 변경하지 않습니다.",
                    "Adds an explanation. Scanned files and results stay unchanged.",
                  )}
                </p>
              )}
              <fieldset disabled={busy || draft.locked || !current}>
                <label>
                  {labels[1]}
                  <textarea
                    aria-label={labels[1]}
                    value={String(draft.fields.reason)}
                    onChange={(e) => draft.update("reason", e.target.value)}
                    minLength={5}
                    maxLength={4000}
                    required={
                      action !== "release" || r.assignee?.id !== user.id
                    }
                  />
                </label>
                <button>{busy ? t("저장 중…", "Saving…") : labels[2]}</button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </div>
  );
}
