import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  type ComparisonDTO,
  type ComparisonFinding,
  type ComparisonMetadata,
  timestamp,
} from "../api";
import { Empty, PageTitle, Pagination, State, useLoad } from "../components";
import { ListBackLink, ListLink } from "../SavedViews";
import { useText } from "../context";

export function ScanCompare() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    t = useText();
  const baseline = params.get("baseline");
  const valid =
    !!id &&
    /^[A-Za-z0-9_-]{1,64}$/.test(id) &&
    !!baseline &&
    /^[A-Za-z0-9_-]{1,64}$/.test(baseline) &&
    params.getAll("baseline").length === 1 &&
    [...params.keys()].every((key) => key === "baseline") &&
    baseline !== id;
  return (
    <>
      <ListBackLink resource="jobs" className="back">
        {t("검사 목록으로", "Back to scans")}
      </ListBackLink>
      <PageTitle
        eyebrow="SCAN"
        title={t("검사 결과 비교", "Scan comparison")}
        description={t(
          "저장된 검사 근거를 비교합니다. 새 판정이나 승인 효력을 만들지 않습니다.",
          "Compare stored scan evidence. This creates no new verdict or approval.",
        )}
      />
      {valid ? (
        <Pair key={id + ":" + baseline} currentId={id} baselineId={baseline} />
      ) : (
        <p role="alert">
          {t(
            "서로 다른 검사 두 건을 선택하세요.",
            "Select two different scans.",
          )}
        </p>
      )}
    </>
  );
}
function Pair({
  currentId,
  baselineId,
}: {
  currentId: string;
  baselineId: string;
}) {
  const t = useText(),
    [confirmed, setConfirmed] = useState(false);
  const load = useLoad<ComparisonDTO>(
    "/scans/" +
      encodeURIComponent(currentId) +
      "/compare?baseline_id=" +
      encodeURIComponent(baselineId) +
      (confirmed ? "&allow_unlinked=true" : ""),
  );
  const error = load.error
    ? load.errorStatus === 404 || load.errorStatus === 403
      ? t(
          "한쪽 또는 양쪽 검사를 조회할 수 없습니다.",
          "One or both scans are unavailable.",
        )
      : load.errorStatus === 409
        ? t(
            "두 검사 모두 완료된 뒤 비교할 수 있습니다.",
            "Both scans must finish before comparison.",
          )
        : load.errorStatus === 422
          ? t(
              "검사 소유자·대상·연결 조건을 확인하세요. 연결되지 않은 ZIP만 별도 확인 후 비교할 수 있습니다.",
              "Check scan ownership, source and linkage. Unlinked ZIP uploads require separate confirmation.",
            )
          : t(
              "비교 결과를 불러오지 못했습니다.",
              "Comparison could not be loaded",
            )
    : "";
  return (
    <>
      <State {...load} error={error}>
        {load.data && <Comparison data={load.data} />}
      </State>
      {load.errorStatus === 422 && !confirmed && (
        <div className="notice">
          <p>
            {t(
              "두 ZIP의 대상 동일성을 확인할 수 없어도 저장 결과를 비교하겠습니까? 이 확인은 소유자나 Git 저장소 제한을 해제하지 않습니다.",
              "Compare stored results even though the two ZIP uploads may represent different sources? This confirmation does not bypass owner or Git repository checks.",
            )}
          </p>
          <button type="button" onClick={() => setConfirmed(true)}>
            {t("미연결 ZIP 비교", "Compare unlinked ZIP uploads")}
          </button>
        </div>
      )}
      <ListLink resource="jobs" to={"/jobs/" + currentId + "?tab=history"}>
        {t("대상 이력으로", "Back to source history")}
      </ListLink>
    </>
  );
}
function Comparison({ data }: { data: ComparisonDTO }) {
  const t = useText(),
    [page, setPage] = useState(1),
    c = data.comparability;
  const labels = {
    persisting: t("계속 관측", "Persisting"),
    moved_candidate: t("이동 후보", "Moved candidate"),
    new: t("새로 관측", "Newly observed"),
    not_observed: t(
      "미검출 · 해소 확인 필요",
      "Not observed · remediation requires confirmation",
    ),
    unmatched: t("일치 여부 불명", "Unmatched"),
  };
  const limits = [
    !c.same_source &&
      t(
        "대상 동일성 미확인: 연결되지 않은 ZIP입니다.",
        "Source identity is unconfirmed: these ZIP uploads are unlinked.",
      ),
    !c.same_profile && t("검사 프로필이 다릅니다.", "Scan profiles differ."),
    c.same_policy !== true &&
      t(
        "정책 버전이 다르거나 미보고입니다.",
        "Policy versions differ or are unreported.",
      ),
    c.same_scanner_revision !== true &&
      t(
        "스캐너 리비전이 다르거나 미보고입니다.",
        "Scanner revisions differ or are unreported.",
      ),
    !c.coverage_complete &&
      t(
        "필수 엔진 범위가 불완전하거나 다릅니다.",
        "Engine coverage is incomplete or differs.",
      ),
    !c.provenance_known &&
      t(
        "엔진 또는 취약점 DB 출처가 미보고입니다.",
        "Engine or vulnerability database provenance is unreported.",
      ),
  ].filter(Boolean);
  return (
    <>
      <section
        className="panel scan-comparison"
        aria-label={t("비교 한계", "Comparison limitations")}
      >
        <div className="panel-heading">
          <h2>{t("비교 한계", "Comparison limitations")}</h2>
        </div>
        <div className="panel-note">
          {limits.length ? (
            <ul>
              {limits.map((limit, i) => (
                <li key={i}>{limit}</li>
              ))}
            </ul>
          ) : (
            <p>
              {t(
                "저장된 비교 조건이 일치합니다.",
                "Stored comparison conditions match.",
              )}
            </p>
          )}
          <p>
            {t(
              "미검출은 해소 확인이 아닙니다. 예외 적용과 이동 후보는 별도로 표시합니다.",
              "Not observed does not confirm remediation. Suppression changes and moved candidates are shown separately.",
            )}
          </p>
        </div>
      </section>
      <section className="panel scan-comparison">
        <div className="panel-heading">
          <h2>{t("저장된 검사 정보", "Stored scan metadata")}</h2>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          aria-label={t(
            "비교 표 가로 스크롤",
            "Scroll comparison table horizontally",
          )}
        >
          <table aria-label={t("검사 메타데이터", "Scan metadata")}>
            <thead>
              <tr>
                <th>{t("구분", "Role")}</th>
                <th>{t("검사 / 대상", "Scan / source")}</th>
                <th>{t("실행 / 판정", "Execution / verdict")}</th>
                <th>{t("조건 / 출처", "Conditions / provenance")}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [t("기준", "Baseline"), data.baseline],
                  [t("현재", "Current"), data.current],
                ] as [string, ComparisonMetadata][]
              ).map(([role, j]) => (
                <tr key={role}>
                  <td>{role}</td>
                  <td>
                    <ListLink resource="jobs" to={"/jobs/" + j.id}>
                      {j.id}
                    </ListLink>
                    <small>{j.source}</small>
                    <small>{timestamp(j.created_at)}</small>
                    <small>
                      {t("ref", "Ref")}: {j.ref || "—"}
                    </small>
                    <small>
                      {t("확정 commit", "Resolved commit")}:{" "}
                      {j.resolved_commit || "—"}
                    </small>
                    <small>
                      {t("요청 commit", "Requested commit")}:{" "}
                      {j.target_commit || "—"}
                    </small>
                    <small>
                      {t("콘텐츠 해시", "Content hash")}:{" "}
                      {j.content_hash || "—"}
                    </small>
                  </td>
                  <td>
                    {(
                      {
                        COMPLETED: t("완료", "Completed"),
                        FAILED: t("실패", "Failed"),
                        CANCELLED: t("취소", "Cancelled"),
                      } as Record<string, string>
                    )[j.status] || t("미보고", "Unreported")}
                    <small>
                      {t("원래 판정", "Original verdict")}:{" "}
                      {verdict(j.verdict, t)}
                    </small>
                    <small>
                      {t("최종 판정", "Final verdict")}:{" "}
                      {verdict(j.effective_verdict, t)}
                    </small>
                  </td>
                  <td>
                    {t("프로필", "Profile")}:{" "}
                    {j.profile === "full"
                      ? t("전체", "Full")
                      : j.profile === "static"
                        ? t("정적", "Static")
                        : t("미보고", "Unreported")}
                    <small>
                      {t("정책", "Policy")}:{" "}
                      {j.policy_version || t("미보고", "Unreported")}
                    </small>
                    <small>
                      {t("리비전", "Revision")}:{" "}
                      {j.scanner_revision || t("미보고", "Unreported")}
                    </small>
                    <small>
                      {t("엔진 범위", "Engine coverage")}:{" "}
                      {j.coverage_complete
                        ? t("완전", "Complete")
                        : t("불완전", "Incomplete")}
                    </small>
                    {j.engines.map((e, i) => (
                      <small key={i}>
                        {e.name || t("미보고", "Unreported")} ·{" "}
                        {(
                          {
                            completed: t("완료", "Completed"),
                            partial: t("부분 완료", "Partial"),
                            failed: t("실패", "Failed"),
                            unavailable: t("사용 불가", "Unavailable"),
                            skipped: t("생략", "Skipped"),
                          } as Record<string, string>
                        )[e.status || ""] || t("미보고", "Unreported")}{" "}
                        · {t("엔진 버전", "Engine version")}:{" "}
                        {e.engine_version || t("미보고", "Unreported")} ·{" "}
                        {t("DB 버전", "DB version")}:{" "}
                        {e.database_version || t("미보고", "Unreported")}
                      </small>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {data.summary === null ? (
        <p className="notice">
          {t(
            "실패하거나 취소된 검사가 있습니다. 저장된 메타데이터만 표시합니다.",
            "A scan failed or was cancelled. Only stored metadata is shown.",
          )}
        </p>
      ) : (
        <>
          <section className="panel scan-comparison">
            <div className="panel-heading">
              <h2>{t("관측 변화", "Observed changes")}</h2>
            </div>
            <div className="panel-note">
              {Object.entries(data.summary).map(([key, count]) => (
                <p key={key}>
                  {labels[key as keyof typeof labels]}: {count}
                </p>
              ))}
            </div>
          </section>
          {data.items.length === 0 ? (
            <Empty>
              {t(
                "비교할 저장된 발견 사항이 없습니다.",
                "No stored findings to compare",
              )}
            </Empty>
          ) : (
            <section className="panel scan-comparison">
              <div className="panel-heading">
                <h2>{t("발견 사항 비교", "Finding comparison")}</h2>
              </div>
              <div
                className="table-scroll"
                tabIndex={0}
                aria-label={t(
                  "비교 표 가로 스크롤",
                  "Scroll comparison table horizontally",
                )}
              >
                <table aria-label={t("발견 사항 비교", "Finding comparison")}>
                  <thead>
                    <tr>
                      <th>
                        {t("분류 / 신뢰도", "Classification / confidence")}
                      </th>
                      <th>{t("기준", "Baseline")}</th>
                      <th>{t("현재", "Current")}</th>
                      <th>{t("별도 변경", "Separate changes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items
                      .slice((page - 1) * 50, page * 50)
                      .map((item, i) => (
                        <tr key={i}>
                          <td>
                            {labels[item.classification]}
                            <small>
                              {item.confidence === "exact"
                                ? t("동일 fingerprint", "Exact fingerprint")
                                : item.confidence === "candidate"
                                  ? t(
                                      "후보 · 확정 일치 아님",
                                      "Candidate · not a confirmed match",
                                    )
                                  : t("일치 미확인", "Match unconfirmed")}
                            </small>
                          </td>
                          <td>
                            <Finding value={item.baseline_finding} />
                          </td>
                          <td>
                            <Finding value={item.current_finding} />
                          </td>
                          <td>
                            {item.change_flags.length
                              ? item.change_flags.map((flag) => (
                                  <p key={flag}>
                                    {flag === "severity_changed"
                                      ? t("심각도 변경", "Severity changed")
                                      : t(
                                          "예외 적용 변경",
                                          "Suppression changed",
                                        )}
                                  </p>
                                ))
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                total={data.items.length}
                size={50}
                onChange={setPage}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
function verdict(value: string | null, t: ReturnType<typeof useText>) {
  return (
    (
      {
        ALLOW: t("허용", "Allow"),
        REVIEW: t("검토 필요", "Review required"),
        BLOCK: t("차단", "Block"),
      } as Record<string, string>
    )[value || ""] || t("미보고", "Unreported")
  );
}
function Finding({ value }: { value: ComparisonFinding | null }) {
  const t = useText();
  if (!value) return <>—</>;
  const severity =
    (
      {
        critical: t("치명적", "Critical"),
        high: t("높음", "High"),
        medium: t("중간", "Medium"),
        low: t("낮음", "Low"),
        info: t("정보", "Informational"),
      } as Record<string, string>
    )[value.severity] || t("미보고", "Unreported");
  return (
    <>
      {value.title}
      <small>
        {value.engine} · {value.rule}
      </small>
      <small>
        {value.path || "—"}:{value.line ?? "—"}
      </small>
      <small>
        {severity} ·{" "}
        {value.suppressed === true
          ? t("예외 적용", "Suppressed")
          : value.suppressed === false
            ? t("예외 미적용", "Not suppressed")
            : t("예외 상태 미보고", "Suppression unreported")}
      </small>
    </>
  );
}
