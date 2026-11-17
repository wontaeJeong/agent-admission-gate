import { useAccountMutation } from "../accountMutations";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMemorySubmission } from "../useMemorySubmission";
import { sessionCoordinator } from "../session";
import { useSearchParams } from "react-router-dom";
import { api, APIError, timestamp, type User } from "../api";
import {
  Badge,
  Code,
  Empty,
  ErrorMessage,
  PageTitle,
  Pagination,
  State,
  Tabs,
  useLoad,
} from "../components";
import { useApp, useText } from "../context";
import { AdminKeys } from "./AdminKeys";
export function Admin() {
  const { user } = useApp(),
    t = useText(),
    [params, setParams] = useSearchParams(),
    tab = params.get("tab") || "status";
  if (user.role !== "admin")
    return (
      <div className="error">
        403 · {t("관리자 권한이 필요합니다.", "Administrator access required.")}
      </div>
    );
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title={t("관리자", "Administration")}
        description={t(
          "운영 상태, 권한, 정책과 감사 기록을 관리합니다.",
          "Manage operations, permissions, policies and audit history.",
        )}
      />
      <Tabs
        selected={tab}
        onChange={(v) => setParams({ tab: v })}
        values={[
          ["status", t("운영 상태", "Status")],
          ["users", t("사용자", "Users")],
          ["keys", t("전체 API 키", "All API keys")],
          ["audit", t("감사 로그", "Audit")],
          ["allowlist", t("예외 허용", "Exceptions")],
          ["actions", "Actions"],
          ["llm", "LLM"],
        ]}
      />
      {tab === "keys" ? (
        <AdminKeys />
      ) : tab === "users" ? (
        <Users />
      ) : tab === "allowlist" ? (
        <Exceptions />
      ) : (
        <AdminRead tab={tab} />
      )}
    </>
  );
}
function Users() {
  const send = useAccountMutation();
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    load = useLoad("/admin/users", refresh),
    t = useText();
  return (
    <>
      <ErrorMessage value={error} />
      <State {...load}>
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    t("사용자", "User"),
                    t("역할", "Role"),
                    t("검토자", "Reviewer"),
                    t("활성", "Active"),
                    "",
                  ].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {load.data?.map((u: User & { active: boolean }) => (
                  <UserRow
                    key={`${u.id}-${refresh}`}
                    user={u}
                    onSave={async (values) => {
                      try {
                        await send("/admin/users/" + u.id, values, "PATCH");
                        setRefresh((x) => x + 1);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </State>
    </>
  );
}
function UserRow({
  user,
  onSave,
}: {
  user: User & { active: boolean };
  onSave: (v: any) => Promise<void>;
}) {
  const [role, setRole] = useState(user.role),
    [reviewer, setReviewer] = useState(user.reviewer),
    [active, setActive] = useState(user.active),
    [busy, setBusy] = useState(false),
    t = useText();
  return (
    <tr>
      <td>
        {user.name}
        <small className="mono">{user.id.slice(0, 12)}</small>
      </td>
      <td>
        <select
          aria-label={user.name + " role"}
          value={role}
          onChange={(e) => setRole(e.target.value as "user" | "admin")}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td>
        <input
          aria-label={user.name + " reviewer"}
          type="checkbox"
          checked={reviewer}
          onChange={(e) => setReviewer(e.target.checked)}
        />
      </td>
      <td>
        <input
          aria-label={user.name + " active"}
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      </td>
      <td>
        <button
          disabled={
            busy ||
            (role === user.role &&
              reviewer === user.reviewer &&
              active === user.active)
          }
          onClick={async () => {
            setBusy(true);
            await onSave({ role, reviewer, active });
            setBusy(false);
          }}
        >
          {t("저장", "Save")}
        </button>
      </td>
    </tr>
  );
}
function AdminRead({ tab }: { tab: string }) {
  const [page, setPage] = useState(1),
    allowed = ["status", "audit", "actions", "llm"],
    safeTab = allowed.includes(tab) ? tab : "status",
    load = useLoad(
      `/admin/${safeTab}${safeTab === "audit" ? "?page=" + page : ""}`,
    ),
    t = useText(),
    data = load.data;
  return (
    <State {...load}>
      {data &&
        (safeTab === "status" ? (
          <div className="two-columns">
            <section className="panel form-panel">
              <h2>{t("서비스 상태", "Service status")}</h2>
              <dl className="status-list">
                <div>
                  <dt>Database</dt>
                  <dd>
                    <Badge value={data.database} />
                  </dd>
                </div>
                <div>
                  <dt>Active jobs / queue capacity</dt>
                  <dd>
                    {data.active_jobs} / {data.queue_capacity}
                  </dd>
                </div>
                <div>
                  <dt>Runner concurrency</dt>
                  <dd>{data.concurrency}</dd>
                </div>
                <div>
                  <dt>Policy</dt>
                  <dd>{data.policy_version}</dd>
                </div>
                <div>
                  <dt>Boards</dt>
                  <dd>
                    <Badge
                      value={data.boards_enabled ? "enabled" : "disabled"}
                    />
                  </dd>
                </div>
              </dl>
            </section>
            <section className="panel form-panel">
              <h2>{t("검사 엔진", "Scanner engines")}</h2>
              <dl className="status-list">
                {Object.entries(data.engines).map(([name, present]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      <Badge value={present ? "installed" : "unavailable"} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            {data.expiration_reminders && (
              <ExpirationStatus data={data.expiration_reminders} />
            )}
          </div>
        ) : safeTab === "audit" ? (
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r: any) => (
                    <tr key={r.id}>
                      <td>{timestamp(r.created_at)}</td>
                      <td className="mono">{r.actor_id?.slice(0, 12)}</td>
                      <td>{r.action}</td>
                      <td className="mono">{r.target_id.slice(0, 16)}</td>
                      <td>
                        <details>
                          <summary>JSON</summary>
                          <Code>{JSON.stringify(r.details, null, 2)}</Code>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={data.total}
              size={50}
              onChange={setPage}
            />
          </section>
        ) : safeTab === "actions" ? (
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Action</th>
                    <th>Severity</th>
                    <th>Remediation</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.title}</b>
                        <small className="mono">{r.id}</small>
                      </td>
                      <td>{r.action}</td>
                      <td>
                        <Badge value={r.severity} />
                      </td>
                      <td>{r.remediation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="panel form-panel">
            <h2>{t("모델 연결 설정", "Model connection")}</h2>
            <Code>{JSON.stringify(data, null, 2)}</Code>
            <p>
              {t(
                "배포 환경변수와 Secret에서 설정합니다. API는 인증정보를 반환하지 않습니다.",
                "Configure with deployment environment variables and secrets. Credentials are never returned by the API.",
              )}
            </p>
          </section>
        ))}
    </State>
  );
}
function Exceptions() {
  const [params] = useSearchParams();
  const requested = params.has("exception");
  const exceptionId =
    params.getAll("exception").length === 1 &&
    /^[A-Za-z0-9_-]{1,64}$/.test(params.get("exception") || "")
      ? params.get("exception")
      : null;
  const send = useAccountMutation();
  const { user, reconcileSession } = useApp();
  const submission = useMemorySubmission();
  const formRef = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    load = useLoad(
      "/admin/allowlist" +
        (exceptionId ? "?exception=" + encodeURIComponent(exceptionId) : ""),
      refresh,
    ),
    t = useText();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current || uncertain) return;
    const form = e.currentTarget,
      data = new FormData(form);
    const receipt = submission.beginSubmission({
      fingerprint: data.get("fingerprint"),
      content_hash: data.get("content_hash"),
      source: data.get("source"),
      reason: data.get("reason"),
      expires_at: new Date(String(data.get("expiry"))).getTime() / 1000,
    });
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await send("/admin/allowlist", receipt.fields);
      if (!submission.markSubmitted(receipt)) return;
      form.reset();
      setRefresh((x) => x + 1);
    } catch (e) {
      if (!submission.isCurrentSubmission(receipt)) return;
      setError((e as Error).message);
      if (e instanceof TypeError || (e instanceof APIError && e.status >= 500))
        setUncertain(true);
      if (e instanceof APIError && e.status === 403) {
        sessionCoordinator.flush();
        reconcileSession(user.id);
      }
    } finally {
      if (submission.isCurrentSubmission(receipt)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function checkExceptions() {
    const receipt = submission.beginSubmission(null);
    setBusy(true);
    try {
      await api(
        "/admin/allowlist" +
          (exceptionId ? "?exception=" + encodeURIComponent(exceptionId) : ""),
      );
      if (!submission.isCurrentSubmission(receipt)) return;
      setUncertain(false);
      setError("");
      setRefresh((x) => x + 1);
    } catch (e) {
      if (submission.isCurrentSubmission(receipt))
        setError((e as Error).message);
    } finally {
      if (submission.isCurrentSubmission(receipt)) setBusy(false);
    }
  }
  return (
    <>
      <ErrorMessage value={error} />
      {uncertain && (
        <p className="notice" role="status">
          {t(
            "요청 결과가 불명확합니다. 현재 예외를 확인한 뒤 명시적으로 다시 제출하세요.",
            "The request outcome is unknown. Check current exceptions before explicitly submitting again.",
          )}{" "}
          <button disabled={busy} onClick={checkExceptions}>
            {t("현재 예외 확인", "Check current exceptions")}
          </button>
        </p>
      )}
      <section className="panel form-panel">
        <h2>{t("만료되는 예외 등록", "Create an expiring exception")}</h2>
        <p>
          {t(
            "정확한 소스, 내용 SHA256과 발견 지문에만 적용됩니다. 기존 결과를 변경하지 않으며 재검사부터 적용됩니다.",
            "Applies to the exact source, content SHA256 and finding fingerprint on the next scan. Existing results are immutable.",
          )}
        </p>
        <form
          ref={formRef}
          onSubmit={submit}
          onChange={() => submission.touch()}
        >
          <label>
            {t("소스", "Source")}
            <input name="source" required />
          </label>
          <label>
            {t("내용 SHA256", "Content SHA256")}
            <input name="content_hash" pattern="[a-f0-9]{64}" required />
          </label>
          <label>
            {t("발견 지문", "Finding fingerprint")}
            <input name="fingerprint" pattern="[a-f0-9]{64}" required />
          </label>
          <label>
            {t("만료일 · 최대 90일", "Expires · within 90 days")}
            <input name="expiry" type="datetime-local" required />
          </label>
          <label>
            {t("허용 사유", "Reason")}
            <textarea name="reason" minLength={5} required />
          </label>
          <button className="primary" disabled={busy || uncertain}>
            {t("예외 등록", "Create exception")}
          </button>
        </form>
      </section>
      <State {...load}>
        {requested &&
          load.data &&
          !load.data.some((item: any) => item.id === exceptionId) && (
            <p className="notice" role="status">
              {t(
                "선택한 예외를 찾을 수 없습니다.",
                "The selected exception was not found.",
              )}
            </p>
          )}
        <section className="panel">
          {load.data?.length ? (
            load.data.map((e: any) => (
              <div
                className="device-row exception-row"
                key={e.id}
                aria-current={exceptionId === e.id ? "true" : undefined}
              >
                <div>
                  {exceptionId === e.id && (
                    <p className="notice" role="status">
                      {t("선택한 예외", "Selected exception")}
                    </p>
                  )}
                  <h3>{e.source}</h3>
                  <p>{e.reason}</p>
                  <small>{timestamp(e.expires_at)}</small>
                  <dl>
                    <dt>{t("원래 내용 SHA256", "Original content SHA256")}</dt>
                    <dd>
                      <code>{e.content_hash}</code>
                    </dd>
                    <dt>
                      {t("원래 발견 지문", "Original finding fingerprint")}
                    </dt>
                    <dd>
                      <code>{e.fingerprint}</code>
                    </dd>
                  </dl>
                  <p>
                    {t(
                      "소스를 다시 선택하거나 파일을 업로드해 검사한 뒤 새 내용 해시와 발견 지문을 검토하세요. 기존 예외의 범위는 변경되지 않습니다.",
                      "Reselect this source or upload its file for a new scan, then review the new content hash and fingerprint. The original exception scope stays unchanged.",
                    )}
                  </p>
                  <div className="toolbar">
                    <Link className="button" to="/new">
                      {t("소스 재검사", "Rescan source")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        formRef.current?.querySelector("input")?.focus();
                      }}
                    >
                      {t("새 예외 검토", "Review a new exception")}
                    </button>
                  </div>
                </div>
                <Badge
                  value={
                    !e.active
                      ? "revoked"
                      : e.expires_at * 1000 < Date.now()
                        ? "expired"
                        : "active"
                  }
                />
                {e.active && (
                  <button
                    onClick={async () => {
                      try {
                        await send(
                          "/admin/allowlist/" + e.id,
                          undefined,
                          "DELETE",
                        );
                        setRefresh((x) => x + 1);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {t("해제", "Revoke")}
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty>
              {t("등록된 예외가 없습니다.", "No exceptions configured.")}
            </Empty>
          )}
        </section>
      </State>
    </>
  );
}

function ExpirationStatus({ data }: { data: any }) {
  const t = useText();
  const labels: Record<string, string> = {
    disabled: t("비활성", "Disabled"),
    configuration_required: t(
      "활성화 시각 설정 필요",
      "Activation time required",
    ),
    waiting: t("첫 성공 대기", "Waiting for first success"),
    healthy: t("정상", "Healthy"),
    failed: t("실패", "Failed"),
    running: t("실행 중", "Running"),
    delayed: t("지연", "Delayed"),
    success: t("성공", "Success"),
  };
  const latest = data.latest;
  return (
    <section
      className="panel form-panel"
      style={{ gridColumn: "1 / -1" }}
      aria-labelledby="expiration-status-title"
    >
      <h2 id="expiration-status-title">
        {t("만료 알림", "Expiration reminders")}
      </h2>
      <p role="status">
        <strong>
          {labels[data.state] || t("확인 필요", "Needs attention")}
        </strong>
      </p>
      {data.state === "disabled" && (
        <p className="muted">
          {t(
            "새 만료 감지는 중지되어 있습니다. 기존 알림은 계속 확인할 수 있습니다.",
            "New expiration detection is disabled. Existing notifications remain available.",
          )}
        </p>
      )}
      {data.state === "delayed" && (
        <p className="notice">
          {t(
            "최근 기준 시각 이후 2시간 동안 성공한 실행이 없습니다. 예약 작업과 데이터베이스 연결을 확인하세요.",
            "No successful run within two hours of the latest baseline. Check the scheduled job and database connection.",
          )}
        </p>
      )}
      {data.state === "configuration_required" && (
        <p className="notice">
          {t(
            "유효한 활성화 시각 또는 성공 이력이 필요합니다. 운영 설정을 확인하세요.",
            "A valid activation time or successful run history is required. Check the operating configuration.",
          )}
        </p>
      )}
      <div className="two-columns">
        <dl className="status-list">
          <div>
            <dt>{t("활성화 시각", "Activation time")}</dt>
            <dd>{timestamp(data.enabled_at)}</dd>
          </div>
          <div>
            <dt>{t("마지막 성공", "Last successful run")}</dt>
            <dd>{timestamp(data.last_success_at)}</dd>
          </div>
          {latest && (
            <>
              <div>
                <dt>{t("최근 실행", "Latest run")}</dt>
                <dd>{labels[latest.status] || "—"}</dd>
              </div>
              <div>
                <dt>{t("시작", "Started")}</dt>
                <dd>{timestamp(latest.started_at)}</dd>
              </div>
              <div>
                <dt>{t("종료", "Finished")}</dt>
                <dd>{timestamp(latest.finished_at)}</dd>
              </div>
            </>
          )}
        </dl>
        {latest ? (
          <div>
            <dl className="status-list">
              <div>
                <dt>{t("검사한 후보", "Candidates checked")}</dt>
                <dd>{latest.scanned}</dd>
              </div>
              <div>
                <dt>{t("앱 내 저장", "Stored in app")}</dt>
                <dd>{latest.emitted}</dd>
              </div>
              <div>
                <dt>{t("건너뜀", "Skipped")}</dt>
                <dd>{latest.skipped}</dd>
              </div>
            </dl>
            <p className="muted">
              {t(
                "저장 건수는 알림함에 추가된 수이며 사용자의 확인 여부를 뜻하지 않습니다.",
                "Stored counts are inbox additions, not confirmations that users have read them.",
              )}
            </p>
            {latest.error_code && (
              <p className="notice">
                {latest.error_code === "candidate_failed"
                  ? t(
                      "일부 항목을 저장하지 못했습니다. 다음 실행에서 다시 시도할 수 있습니다.",
                      "Some items could not be stored. A later run can retry them.",
                    )
                  : t(
                      "작업을 완료하지 못했습니다. 예약 작업과 데이터베이스 연결을 확인하세요.",
                      "The run could not finish. Check the scheduled job and database connection.",
                    )}
              </p>
            )}
          </div>
        ) : (
          <p className="muted">
            {t("기록된 실행이 없습니다.", "No runs recorded.")}
          </p>
        )}
      </div>
    </section>
  );
}
