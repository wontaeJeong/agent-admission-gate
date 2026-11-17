import { useState } from "react";
import { workflowLabel } from "./ReviewActivity";
import { useParams, useSearchParams } from "react-router-dom";
import { type Job, timestamp } from "../api";
import {
  Badge,
  Empty,
  PageTitle,
  Pagination,
  State,
  useLoad,
} from "../components";
import { ListBackLink, ListLink } from "../SavedViews";
import { useApp, useText } from "../context";

type HistoryItem = Pick<
  Job,
  | "id"
  | "source"
  | "source_type"
  | "ref"
  | "resolved_commit"
  | "target_commit"
  | "profile"
  | "status"
  | "verdict"
  | "effective_verdict"
  | "created_at"
> & {
  coverage_complete: boolean;
  cached: boolean;
  engines: { name: string; status: string }[];
  review?: { id: string; status: string; workflow_state: string };
};
type HistoryPage = {
  items: HistoryItem[];
  total: number;
  page: number;
  page_size: number;
};
const filterKeys = ["ref", "profile", "status", "page", "page_size"];

export function ScanHistory({ job }: { job: Job }) {
  const t = useText(),
    { user } = useApp(),
    [params, setParams] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of filterKeys)
    if (params.has(key)) query.set(key, params.get(key)!);
  const load = useLoad<HistoryPage>(
    "/scans/" + encodeURIComponent(job.id) + "/history?" + query,
  );
  const [selected, setSelected] = useState<HistoryItem[]>([]);
  const reviewLabels: Record<string, string> = {
    pending: t("대기", "Pending"),
    approved: t("승인", "Approved"),
    rejected: t("반려", "Rejected"),
    withdrawn: t("철회", "Withdrawn"),
  };
  function change(key: string, value: string) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.set("page", "1");
      return next;
    });
  }
  function select(item: HistoryItem, checked: boolean) {
    setSelected((old) =>
      checked
        ? old.length >= 2
          ? old
          : [...old, item].sort(
              (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
            )
        : old.filter((row) => row.id !== item.id),
    );
  }
  return (
    <section className="panel scan-history">
      <div className="panel-heading">
        <h2>{t("동일 대상 검사 이력", "Source scan history")}</h2>
      </div>
      <p className="panel-note">
        {t(
          "같은 소유자의 Git 저장소 또는 명시적으로 연결한 ZIP 계보입니다.",
          "Scans of the same owner's Git repository or explicitly linked ZIP lineage.",
        )}
      </p>
      <div className="filters">
        <label>
          {t("ref", "Ref")}
          <input
            aria-label={t("이력 ref", "History ref")}
            maxLength={200}
            value={params.get("ref") || ""}
            onChange={(e) => change("ref", e.target.value)}
          />
        </label>
        <label>
          {t("프로필", "Profile")}
          <select
            aria-label={t("이력 프로필", "History profile")}
            value={params.get("profile") || ""}
            onChange={(e) => change("profile", e.target.value)}
          >
            <option value="">{t("모든 프로필", "All profiles")}</option>
            <option value="static">static</option>
            <option value="full">full</option>
          </select>
        </label>
        <label>
          {t("실행 상태", "Execution status")}
          <select
            aria-label={t("이력 실행 상태", "History execution status")}
            value={params.get("status") || ""}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">{t("모든 상태", "All statuses")}</option>
            {["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map(
              (status) => (
                <option key={status}>{status}</option>
              ),
            )}
          </select>
        </label>
      </div>
      <State {...load}>
        {load.data && (
          <>
            <div className="toolbar" aria-live="polite">
              <span>
                {t("선택", "Selected")}: {selected.length} / 2
              </span>
              {selected[0] && (
                <span>
                  {t("기준", "Baseline")}: {selected[0].id}
                </span>
              )}
              {selected[1] && (
                <>
                  <span>
                    {t("현재", "Current")}: {selected[1].id}
                  </span>
                  <button
                    onClick={() => setSelected((old) => [old[1], old[0]])}
                  >
                    {t("기준과 현재 바꾸기", "Swap baseline and current")}
                  </button>
                  <ListLink
                    resource="jobs"
                    to={
                      "/jobs/" +
                      selected[1].id +
                      "/compare?baseline=" +
                      selected[0].id
                    }
                  >
                    {t("선택한 검사 열기", "Open selected scans")}
                  </ListLink>
                </>
              )}
              {!!selected.length && (
                <button onClick={() => setSelected([])}>
                  {t("선택 해제", "Clear selection")}
                </button>
              )}
            </div>
            {load.data.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        t("선택", "Select"),
                        t("검사 / 시각", "Scan / time"),
                        t("ref / commit", "Ref / commit"),
                        t("프로필 / 실행", "Profile / execution"),
                        t("원래 / 최종 판정", "Original / final verdict"),
                        t("엔진 범위", "Engine coverage"),
                        t("캐시", "Cache"),
                        t("검토", "Review"),
                      ].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {load.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={
                              t("검사 선택 ", "Select scan ") + item.id
                            }
                            checked={selected.some((row) => row.id === item.id)}
                            disabled={
                              selected.length === 2 &&
                              !selected.some((row) => row.id === item.id)
                            }
                            onChange={(e) => select(item, e.target.checked)}
                          />
                        </td>
                        <td>
                          <ListLink resource="jobs" to={"/jobs/" + item.id}>
                            {item.id}
                          </ListLink>
                          <small>{item.source}</small>
                          <small>{timestamp(item.created_at)}</small>
                        </td>
                        <td>
                          {item.ref || "—"}
                          <small className="mono">
                            {item.resolved_commit
                              ? t("확정: ", "Resolved: ") + item.resolved_commit
                              : item.target_commit
                                ? t("요청: ", "Requested: ") +
                                  item.target_commit
                                : "—"}
                          </small>
                        </td>
                        <td>
                          {item.profile}
                          <small>
                            <Badge value={item.status} />
                          </small>
                        </td>
                        <td>
                          <Badge value={item.verdict} />
                          <span aria-hidden="true"> → </span>
                          <Badge value={item.effective_verdict} />
                        </td>
                        <td>
                          {item.coverage_complete
                            ? t("완전", "Complete")
                            : t("불완전", "Incomplete")}
                          {item.engines.map((engine, index) => (
                            <small key={index}>
                              {engine.name}: {engine.status}
                            </small>
                          ))}
                        </td>
                        <td>
                          {item.cached
                            ? t("사용", "Used")
                            : t("미사용", "Not used")}
                        </td>
                        <td>
                          {item.review ? (
                            <ListLink
                              resource="jobs"
                              to={"/reviews/" + item.review.id}
                            >
                              {reviewLabels[item.review.status] || "—"} ·{" "}
                              {workflowLabel(item.review.workflow_state, t)}
                            </ListLink>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>
                {t(
                  "조건에 맞는 검사 이력이 없습니다.",
                  "No scans match these history filters.",
                )}{" "}
                {job.owner_id === user.id && (
                  <ListLink
                    resource="jobs"
                    to={"/new?from=" + job.id + "&mode=latest"}
                  >
                    {t("다시 검사", "Run another scan")}
                  </ListLink>
                )}
              </Empty>
            )}
            <Pagination
              page={load.data.page}
              total={load.data.total}
              size={load.data.page_size}
              onChange={(page) => change("page", String(page))}
            />
          </>
        )}
      </State>
    </section>
  );
}

/** A handled, read-only pair entry; findings comparison has its own API contract. */
export function SelectedScans() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    t = useText();
  const baseline = params.get("baseline");
  const valid =
    !!id &&
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
      <PageTitle eyebrow="SCAN" title={t("선택한 검사", "Selected scans")} />
      {valid ? (
        <SelectedPair
          key={id + ":" + baseline}
          currentId={id}
          baselineId={baseline}
        />
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
function SelectedPair({
  currentId,
  baselineId,
}: {
  currentId: string;
  baselineId: string;
}) {
  const t = useText(),
    baseline = useLoad<Job>("/scans/" + encodeURIComponent(baselineId)),
    current = useLoad<Job>("/scans/" + encodeURIComponent(currentId));
  return (
    <State {...baseline}>
      <State {...current}>
        {baseline.data && current.data && (
          <>
            <p className="notice">
              {t(
                "메타데이터만 표시합니다. 발견 사항은 비교하지 않습니다.",
                "Metadata only. Findings are not compared.",
              )}
            </p>
            <section className="panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("구분", "Role")}</th>
                      <th>{t("검사", "Scan")}</th>
                      <th>{t("ref / commit", "Ref / commit")}</th>
                      <th>{t("프로필 / 실행", "Profile / execution")}</th>
                      <th>
                        {t("원래 / 최종 판정", "Original / final verdict")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        [t("기준", "Baseline"), baseline.data],
                        [t("현재", "Current"), current.data],
                      ] as [string, Job][]
                    ).map(([role, job]) => (
                      <tr key={role}>
                        <td>{role}</td>
                        <td>
                          <ListLink resource="jobs" to={"/jobs/" + job.id}>
                            {job.id}
                          </ListLink>
                          <small>{job.source}</small>
                          <small>{timestamp(job.created_at)}</small>
                        </td>
                        <td>
                          {job.ref || "—"}
                          <small className="mono">
                            {job.resolved_commit
                              ? t("확정: ", "Resolved: ") + job.resolved_commit
                              : job.target_commit
                                ? t("요청: ", "Requested: ") + job.target_commit
                                : "—"}
                          </small>
                        </td>
                        <td>
                          {job.profile}
                          <small>
                            <Badge value={job.status} />
                          </small>
                        </td>
                        <td>
                          <Badge value={job.verdict} />
                          <span aria-hidden="true"> → </span>
                          <Badge value={job.effective_verdict} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <ListLink
              resource="jobs"
              to={"/jobs/" + currentId + "?tab=history"}
            >
              {t("대상 이력으로", "Back to source history")}
            </ListLink>
          </>
        )}
      </State>
    </State>
  );
}
