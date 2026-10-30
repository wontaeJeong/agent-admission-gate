import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, send, timestamp, type User } from "../api";
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
import { Keys } from "./Integrations";
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
        <Keys admin />
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
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    load = useLoad("/admin/allowlist", refresh),
    t = useText();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    try {
      await send("/admin/allowlist", {
        fingerprint: data.get("fingerprint"),
        content_hash: data.get("content_hash"),
        source: data.get("source"),
        reason: data.get("reason"),
        expires_at: new Date(String(data.get("expiry"))).getTime() / 1000,
      });
      form.reset();
      setRefresh((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <ErrorMessage value={error} />
      <section className="panel form-panel">
        <h2>{t("만료되는 예외 등록", "Create an expiring exception")}</h2>
        <p>
          {t(
            "정확한 소스와 발견 지문에만 적용됩니다. 기존 결과를 변경하지 않으며 재검사부터 적용됩니다.",
            "Applies to one exact source and finding fingerprint on the next scan. Existing results are immutable.",
          )}
        </p>
        <form onSubmit={submit}>
          <label>
            Source
            <input name="source" required />
          </label>
          <label>
            Content SHA256
            <input name="content_hash" pattern="[a-f0-9]{64}" required />
          </label>
          <label>
            Finding fingerprint
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
          <button className="primary">
            {t("예외 등록", "Create exception")}
          </button>
        </form>
      </section>
      <State {...load}>
        <section className="panel">
          {load.data?.length ? (
            load.data.map((e: any) => (
              <div className="device-row" key={e.id}>
                <div>
                  <h3>{e.source}</h3>
                  <p>{e.reason}</p>
                  <small>{timestamp(e.expires_at)}</small>
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
                        await api("/admin/allowlist/" + e.id, {
                          method: "DELETE",
                        });
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
