import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { send, timestamp } from "../api";
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
    t = useText(),
    tab = params.get("tab") || "pending",
    page = Number(params.get("page") || 1),
    load = useLoad(`/reviews?tab=${tab}&page=${page}`);
  return (
    <>
      <PageTitle
        eyebrow="HUMAN REVIEW"
        title={t("검토", "Reviews")}
        description={t(
          "위험 근거와 요청 사유를 확인하고 반입 여부를 결정합니다.",
          "Review evidence and requests before deciding admission.",
        )}
      />
      <Tabs
        values={[
          ["pending", t("검토 필요", "Needs review")],
          ["mine", t("내 요청", "My requests")],
          ["approved", t("승인됨", "Approved")],
          ["all", t("전체", "All")],
        ]}
        selected={tab}
        onChange={(v) => setParams({ tab: v, page: "1" })}
      />
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
                          <Link to={"/reviews/" + r.id}>{r.source}</Link>
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
              onChange={(v) => setParams({ tab, page: String(v) })}
            />
          </section>
        )}
      </State>
    </>
  );
}
export function ReviewDetail() {
  const { id } = useParams(),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    load = useLoad("/reviews/" + id, refresh),
    { user } = useApp(),
    t = useText(),
    r = load.data;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      await send(`/reviews/${id}/decision`, {
        decision: data.get("decision"),
        reason: data.get("reason"),
      });
      setRefresh((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <State {...load}>
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
          {r.status === "pending" &&
            user.reviewer &&
            r.requester_id !== user.id && (
              <section className="panel form-panel">
                <h2>{t("검토 결정", "Review decision")}</h2>
                <form onSubmit={submit}>
                  <ErrorMessage value={error} />
                  <label>
                    {t("결정", "Decision")}
                    <select name="decision">
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
                      minLength={5}
                      maxLength={4000}
                      required
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {t("결정 저장", "Save decision")}
                  </button>
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
  );
}
