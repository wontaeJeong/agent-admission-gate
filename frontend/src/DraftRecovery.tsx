import { useText } from "./context";
import type { DraftController } from "./useDraft";
export function DraftRecovery({
  draft,
  latest,
}: {
  draft: DraftController;
  latest?: string;
}) {
  const t = useText();
  const labels: Record<string, string> = {
    decision: t("결정", "Decision"),
    reason:
      draft.candidate?.kind === "review_decision"
        ? t("결정 사유", "Decision reason")
        : t("요청 사유", "Request reason"),
    body: t("본문", "Body"),
    title: t("제목", "Title"),
    visibility: t("공개 범위", "Visibility"),
    status: t("상태", "Status"),
    pinned: t("상단 고정", "Pinned"),
    internal: t("내부 공개", "Staff only"),
    type: t("소스 유형", "Source type"),
    url: t("저장소 URL", "Repository URL"),
    ref: t("브랜치 또는 태그", "Branch or tag"),
    profile: t("검사 프로필", "Scan profile"),
    force: t("캐시 건너뛰기", "Skip cache"),
  };
  const choices: Record<string, Record<string, string>> = {
    decision: { rejected: t("반려", "Reject"), approved: t("승인", "Approve") },
    visibility: {
      public: t("전체 공개", "Public"),
      private: t("작성자 · 운영자만", "Author & staff"),
    },
    type: {
      git: t("Git 저장소", "Git repository"),
      upload: t("파일 업로드", "Upload package"),
    },
    profile: { static: "Static", full: "Full" },
    status: {
      draft: t("초안", "Draft"),
      open: t("접수", "Open"),
      triaged: t("분류됨", "Triaged"),
      planned: t("계획됨", "Planned"),
      in_progress: t("진행 중", "In progress"),
      resolved: t("해결됨", "Resolved"),
      closed: t("종료됨", "Closed"),
      pending: t("대기 중", "Pending"),
      approved: t("승인됨", "Approved"),
      rejected: t("반려됨", "Rejected"),
    },
  };
  const displayValue = (name: string, value: string | boolean) =>
    typeof value === "boolean"
      ? value
        ? t("예", "Yes")
        : t("아니요", "No")
      : (choices[name]?.[value] ?? value);
  return (
    <div className="draft-status">
      {draft.error && (
        <div className="error" role="alert">
          {t(
            "초안을 저장하거나 불러오지 못했습니다. 이 탭의 입력을 유지하세요.",
            "Draft was not saved or could not be loaded. Keep your input in this tab.",
          )}{" "}
          <button
            type="button"
            onClick={draft.readError ? draft.discard : draft.flush}
          >
            {draft.readError
              ? t("저장된 초안 버리기", "Discard stored draft")
              : t("임시저장 다시 시도", "Retry draft save")}
          </button>
        </div>
      )}
      {draft.omittedUrl && (
        <p role="status">
          {t(
            "인증 정보·쿼리·fragment가 포함된 URL은 임시저장하지 않습니다. PAT와 ZIP 파일도 다시 입력하거나 선택해야 합니다.",
            "URLs with credentials, query or fragment are not saved. Re-enter PATs and select ZIP files again.",
          )}
        </p>
      )}
      {draft.candidate && (
        <section
          className="notice"
          aria-label={t("이전 초안", "Previous draft")}
        >
          <p>
            {t(
              "이 탭에 이전 작성 내용이 있습니다.",
              "Previous input is available in this tab.",
            )}{" "}
            <time>{new Date(draft.candidate.saved_at).toLocaleString()}</time>
          </p>
          {(draft.conflict || !draft.writable) && (
            <>
              <p>
                {t(
                  "서버 상태가 변경되어 초안은 읽기 전용입니다. 최신 내용을 확인하세요.",
                  "The server state changed. This draft is read-only; check the latest content.",
                )}
              </p>
              <pre
                aria-label={t("읽기 전용 초안", "Read-only draft")}
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >
                {Object.entries(draft.candidate.fields)
                  .map(
                    ([key, value]) =>
                      `${labels[key] ?? t("입력", "Input")}: ${displayValue(key, value)}`,
                  )
                  .join("\n")}
              </pre>
              {latest && (
                <details>
                  <summary>
                    {t("최신 서버 내용", "Latest server content")}
                  </summary>
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {latest}
                  </p>
                </details>
              )}
            </>
          )}
          <div className="toolbar">
            {draft.writable && (
              <button type="button" onClick={draft.restore}>
                {draft.conflict
                  ? t(
                      "최신 내용 기준으로 초안 재편집",
                      "Re-edit draft against latest",
                    )
                  : t("이전 작성 내용 복구", "Restore previous draft")}
              </button>
            )}
            <button type="button" onClick={draft.discard}>
              {t("버리기", "Discard draft")}
            </button>
          </div>
        </section>
      )}
      {draft.savedAt && !draft.error && (
        <small role="status">
          {t("이 탭에 임시저장", "Saved in this tab")} ·{" "}
          {new Date(draft.savedAt).toLocaleTimeString()}
        </small>
      )}
      {draft.dirty && !draft.savedAt && !draft.error && !draft.candidate && (
        <small role="status">
          {t("임시저장 대기 중", "Draft save pending")}
        </small>
      )}
    </div>
  );
}
