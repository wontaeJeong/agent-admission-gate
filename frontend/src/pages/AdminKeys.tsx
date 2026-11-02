import { useEffect, useRef, useState, type FormEvent } from "react";
import { send, timestamp } from "../api";
import {
  Badge,
  Empty,
  ErrorMessage,
  Pagination,
  State,
  useLoad,
} from "../components";
import { useText } from "../context";

type Key = {
  id: string;
  name: string;
  display_key: string;
  issuer: string;
  state: "active" | "expired" | "revoked";
  scopes: string[];
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};
type Page<T> = { items: T[]; total: number; page_size: number };
type EventUnit = "rest_http" | "mcp_http" | "legacy_mcp_tool";
type Call = {
  id: string;
  unit: EventUnit;
  created_at: number;
  route: string | null;
  status: number;
  latency_ms: number;
};
type AuditEntry = {
  id: string;
  created_at: number;
  action: string;
  actor: string | null;
  reason: string | null;
};
type KeyDetail = {
  key: Key;
  usage: Page<Call> & {
    summary: {
      rest_http: {
        requests_30d: number;
        active_days_30d: number;
        errors_30d: number;
      };
      mcp_http: {
        observed_requests_30d: number;
        active_days_30d: number;
        transport_errors_30d: number;
        coverage: "unknown" | "partial" | "possibly_partial";
        collection_started_at: number | null;
      };
      legacy_mcp_tool: { events_30d: number };
      routes_30d: { unit: EventUnit; route: string | null; count: number }[];
    };
  };
  audit: Page<AuditEntry>;
};

export function AdminKeys() {
  const t = useText(),
    [input, setInput] = useState(""),
    [state, setState] = useState("all"),
    [query, setQuery] = useState({ q: "", state: "all" }),
    [page, setPage] = useState(1),
    [listVersion, setListVersion] = useState(0),
    [selected, setSelected] = useState("");
  const params = new URLSearchParams({
    q: query.q,
    state: query.state,
    page: String(page),
  });
  const load = useLoad<Page<Key>>(
    `/admin/api-keys/search?${params}`,
    listVersion,
  );
  useEffect(() => {
    if (
      load.data &&
      page > 1 &&
      (page - 1) * load.data.page_size >= load.data.total
    )
      setPage(Math.max(1, Math.ceil(load.data.total / load.data.page_size)));
  }, [load.data, page]);
  function search(e: FormEvent) {
    e.preventDefault();
    setQuery({ q: input.trim(), state });
    setPage(1);
  }
  if (selected)
    return (
      <AdminKeyDetail
        id={selected}
        onBack={() => {
          setSelected("");
          setListVersion((n) => n + 1);
        }}
      />
    );
  return (
    <>
      <p className="admin-key-intro">
        {t(
          "전체 키를 이름, 발급자, 키 ID 또는 끝 네 자리로 검색합니다.",
          "Search all keys by name, issuer, key ID or last four characters.",
        )}
      </p>
      <form className="filters admin-key-filters" onSubmit={search}>
        <label>
          {t("키 검색", "Search keys")}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={120}
          />
        </label>
        <label>
          {t("상태", "State")}
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="all">{t("전체", "All")}</option>
            <option value="active">{t("활성", "Active")}</option>
            <option value="expired">{t("만료", "Expired")}</option>
            <option value="revoked">{t("폐기", "Revoked")}</option>
          </select>
        </label>
        <button type="submit">{t("검색", "Search")}</button>
      </form>
      <State {...load}>
        <section
          className="panel"
          aria-label={t("API 키 결과", "API key results")}
        >
          {load.data?.items.length ? (
            <div
              className="table-scroll"
              role="region"
              aria-label={t("키 결과 표", "Key results table")}
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>{t("키", "Key")}</th>
                    <th>{t("발급자", "Issuer")}</th>
                    <th>{t("상태", "State")}</th>
                    <th>{t("마지막 사용", "Last used")}</th>
                    <th>{t("만료", "Expires")}</th>
                    <th>
                      <span className="sr-only">{t("작업", "Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {load.data.items.map((key) => (
                    <tr key={key.id}>
                      <td>
                        <strong>{key.name}</strong>
                        <small className="mono">{key.display_key}</small>
                      </td>
                      <td>{key.issuer}</td>
                      <td>
                        <Badge value={key.state} />
                      </td>
                      <td>{timestamp(key.last_used_at)}</td>
                      <td>{timestamp(key.expires_at)}</td>
                      <td>
                        <button
                          onClick={() => setSelected(key.id)}
                          aria-label={t(
                            `${key.name} 상세 보기`,
                            `View details for ${key.name}`,
                          )}
                        >
                          {t("상세 보기", "View details")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              {t(
                "조건에 맞는 API 키가 없습니다.",
                "No API keys match these filters.",
              )}
            </Empty>
          )}
          {load.data && (
            <Pagination
              page={page}
              total={load.data.total}
              size={load.data.page_size}
              onChange={setPage}
            />
          )}
        </section>
      </State>
    </>
  );
}

function AdminKeyDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useText(),
    [usagePage, setUsagePage] = useState(1),
    [auditPage, setAuditPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [confirming, setConfirming] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    heading = useRef<HTMLHeadingElement>(null),
    focused = useRef(false),
    load = useLoad<KeyDetail>(
      `/admin/api-keys/${encodeURIComponent(id)}?usage_page=${usagePage}&audit_page=${auditPage}`,
      refresh,
    );
  useEffect(() => {
    if (load.data && !focused.current) {
      heading.current?.focus();
      focused.current = true;
    }
  }, [load.data]);
  async function revoke(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await send(`/admin/api-keys/${encodeURIComponent(id)}/revoke`, {
        reason: reason.trim(),
      });
      setConfirming(false);
      setReason("");
      setNotice(t("키를 폐기했습니다.", "Key revoked."));
      setAuditPage(1);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const detail = load.data;
  const unitLabel = (unit: EventUnit) =>
    unit === "rest_http"
      ? "REST HTTP"
      : unit === "mcp_http"
        ? "MCP HTTP"
        : t("이전 MCP 도구 이벤트", "Legacy MCP tool event");
  return (
    <>
      <button className="admin-key-back" onClick={onBack}>
        {t("← 키 목록", "Back to keys")}
      </button>
      <ErrorMessage value={error} />
      {notice && (
        <p role="status" className="admin-key-note">
          {notice}
        </p>
      )}
      <State {...load}>
        {detail && (
          <>
            <section
              className="panel key-card"
              aria-labelledby="admin-key-heading"
            >
              <header>
                <div>
                  <h2 id="admin-key-heading" ref={heading} tabIndex={-1}>
                    {detail.key.name}
                  </h2>
                  <code>{detail.key.display_key}</code>
                </div>
                <Badge value={detail.key.state} />
                {detail.key.state !== "revoked" && (
                  <button
                    className="danger-button"
                    onClick={() => setConfirming(true)}
                  >
                    {t("키 폐기", "Revoke key")}
                  </button>
                )}
              </header>
              <dl>
                <div>
                  <dt>{t("발급자", "Issuer")}</dt>
                  <dd>{detail.key.issuer}</dd>
                </div>
                <div>
                  <dt>{t("키 ID", "Key ID")}</dt>
                  <dd className="mono">{detail.key.id}</dd>
                </div>
                <div>
                  <dt>{t("권한", "Scopes")}</dt>
                  <dd>{detail.key.scopes.join(", ")}</dd>
                </div>
                <div>
                  <dt>{t("발급일", "Created")}</dt>
                  <dd>{timestamp(detail.key.created_at)}</dd>
                </div>
                <div>
                  <dt>{t("만료일", "Expires")}</dt>
                  <dd>{timestamp(detail.key.expires_at)}</dd>
                </div>
                <div>
                  <dt>{t("마지막 사용", "Last used")}</dt>
                  <dd>{timestamp(detail.key.last_used_at)}</dd>
                </div>
                {detail.key.revoked_at && (
                  <div>
                    <dt>{t("폐기일", "Revoked")}</dt>
                    <dd>{timestamp(detail.key.revoked_at)}</dd>
                  </div>
                )}
              </dl>
              {confirming && (
                <form className="revoke-form" onSubmit={revoke}>
                  <p>
                    {t(
                      "이 키를 사용하는 연결이 중단됩니다. 폐기는 되돌릴 수 없습니다.",
                      "Connections using this key will stop working. Revocation cannot be undone.",
                    )}
                  </p>
                  <label>
                    {t("폐기 사유", "Revocation reason")}
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={5}
                      maxLength={4000}
                      required
                    />
                  </label>
                  <div className="toolbar">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(false);
                        setReason("");
                        setError("");
                      }}
                    >
                      {t("취소", "Cancel")}
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy || reason.trim().length < 5}
                    >
                      {t("키 폐기 확인", "Confirm revocation")}
                    </button>
                  </div>
                </form>
              )}
            </section>
            <section aria-labelledby="key-usage-heading">
              <h2 id="key-usage-heading">
                {t(
                  "기록된 사용 분석 · 최근 30일",
                  "Recorded usage · last 30 days",
                )}
              </h2>
              <p className="admin-key-note">
                {t(
                  "REST HTTP 요청, MCP HTTP 요청, 과거 MCP 도구 이벤트는 서로 다른 단위입니다. 인증 실패는 키에 연결되지 않습니다. MCP HTTP 상태는 전송 결과이며 도구 성공 여부가 아닙니다. 과거 도구 이벤트는 일부 도구만 포함합니다. 사용 일수는 UTC 기준입니다.",
                  "REST HTTP requests, MCP HTTP requests, and legacy MCP tool events are separate units. Authentication failures are not attributed to a key. MCP HTTP status describes transport, not tool success. Legacy tool events cover selected tools only. Active days use UTC.",
                )}
              </p>
              <p className="admin-key-note">
                {detail.usage.summary.mcp_http.coverage === "possibly_partial"
                  ? t(
                      "MCP HTTP 수집은 이 기간 전에 시작되었지만 중단이나 롤백으로 누락이 있을 수 있습니다.",
                      "MCP HTTP collection began before this window; outages or rollbacks may leave gaps.",
                    )
                  : detail.usage.summary.mcp_http.coverage === "partial"
                    ? t(
                        `MCP HTTP 수집은 ${timestamp(detail.usage.summary.mcp_http.collection_started_at)}에 시작되었습니다. 그 이전은 알 수 없습니다.`,
                        `MCP HTTP collection began ${timestamp(detail.usage.summary.mcp_http.collection_started_at)}; earlier traffic is unknown and interruptions may leave gaps.`,
                      )
                    : t(
                        "MCP HTTP 수집 시작 시점을 알 수 없어 이전 트래픽을 추정할 수 없습니다.",
                        "MCP HTTP collection start is unknown; earlier traffic cannot be inferred.",
                      )}
              </p>
              <div className="stats-grid admin-key-stats">
                <div className="stat">
                  <div>
                    {t("기록된 REST HTTP 요청", "Recorded REST HTTP requests")}
                  </div>
                  <strong>{detail.usage.summary.rest_http.requests_30d}</strong>
                  <small>
                    {detail.usage.summary.rest_http.active_days_30d}{" "}
                    {t(
                      "UTC 사용 일수 · 오류 응답",
                      "UTC active days · error responses",
                    )}{" "}
                    {detail.usage.summary.rest_http.errors_30d}
                  </small>
                </div>
                <div className="stat">
                  <div>
                    {t("기록된 MCP HTTP 요청", "Recorded MCP HTTP requests")}
                  </div>
                  <strong>
                    {detail.usage.summary.mcp_http.coverage === "unknown" &&
                    !detail.usage.summary.mcp_http.observed_requests_30d
                      ? "—"
                      : detail.usage.summary.mcp_http.observed_requests_30d}
                  </strong>
                  <small>
                    {detail.usage.summary.mcp_http.coverage === "unknown" &&
                    !detail.usage.summary.mcp_http.observed_requests_30d
                      ? t("수집 범위 알 수 없음", "Coverage unknown")
                      : t(
                          `UTC 사용 ${detail.usage.summary.mcp_http.active_days_30d}일 · 전송 오류 ${detail.usage.summary.mcp_http.transport_errors_30d}`,
                          `${detail.usage.summary.mcp_http.active_days_30d} UTC active days · transport errors ${detail.usage.summary.mcp_http.transport_errors_30d}`,
                        )}
                  </small>
                </div>
                <div className="stat">
                  <div>
                    {t("이전 MCP 도구 이벤트", "Legacy MCP tool events")}
                  </div>
                  <strong>
                    {detail.usage.summary.legacy_mcp_tool.events_30d}
                  </strong>
                  <small>
                    {t(
                      "일부 도구만 · HTTP 요청 수 아님",
                      "Selected tools only · not HTTP requests",
                    )}
                  </small>
                </div>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h3>
                    {t(
                      "경로별 기록 · 최근 30일",
                      "Recorded routes · last 30 days",
                    )}
                  </h3>
                </div>
                {detail.usage.summary.routes_30d.length ? (
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label={t("호출 경로 표", "Routes table")}
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>{t("유형", "Type")}</th>
                          <th>{t("경로", "Route")}</th>
                          <th>{t("기록", "Records")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.usage.summary.routes_30d.map((route, i) => (
                          <tr key={i}>
                            <td>{unitLabel(route.unit)}</td>
                            <td className="mono">{route.route || "—"}</td>
                            <td>{route.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    {t(
                      "최근 30일에 기록이 없습니다.",
                      "No records in the last 30 days.",
                    )}
                  </Empty>
                )}
              </section>
              <section className="panel" aria-labelledby="key-calls-heading">
                <div className="panel-heading">
                  <h3 id="key-calls-heading">
                    {t(
                      "기록된 이벤트 · 전체 기간",
                      "Recorded events · all time",
                    )}
                  </h3>
                </div>
                {detail.usage.items.length ? (
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label={t("기록된 이벤트 표", "Recorded events table")}
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>{t("시간", "Time")}</th>
                          <th>{t("유형", "Type")}</th>
                          <th>{t("경로", "Route")}</th>
                          <th>{t("상태", "Status")}</th>
                          <th>{t("지연", "Latency")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.usage.items.map((call) => (
                          <tr key={call.id}>
                            <td>{timestamp(call.created_at)}</td>
                            <td>{unitLabel(call.unit)}</td>
                            <td className="mono">{call.route || "—"}</td>
                            <td>{call.status}</td>
                            <td>{Math.round(call.latency_ms)} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    {t("기록된 이벤트가 없습니다.", "No recorded events.")}
                  </Empty>
                )}
                <Pagination
                  page={usagePage}
                  total={detail.usage.total}
                  size={detail.usage.page_size}
                  onChange={setUsagePage}
                />
              </section>
            </section>
            <section className="panel" aria-labelledby="key-audit-heading">
              <div className="panel-heading">
                <h2 id="key-audit-heading">
                  {t("키 감사 이력", "Key audit history")}
                </h2>
              </div>
              {detail.audit.items.length ? (
                <div
                  className="table-scroll"
                  role="region"
                  aria-label={t("키 감사 이력 표", "Key audit history table")}
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>{t("시간", "Time")}</th>
                        <th>{t("작업", "Action")}</th>
                        <th>{t("수행자", "Actor")}</th>
                        <th>{t("사유", "Reason")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.audit.items.map((event) => (
                        <tr key={event.id}>
                          <td>{timestamp(event.created_at)}</td>
                          <td>
                            {event.action === "key.create"
                              ? t("키 발급", "Key created")
                              : event.action === "key.admin_revoke"
                                ? t("관리자 폐기", "Admin revocation")
                                : t("본인 폐기", "Owner revocation")}
                          </td>
                          <td>{event.actor || "—"}</td>
                          <td>{event.reason || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  {t("키 감사 이력이 없습니다.", "No key audit events.")}
                </Empty>
              )}
              <Pagination
                page={auditPage}
                total={detail.audit.total}
                size={detail.audit.page_size}
                onChange={setAuditPage}
              />
            </section>
          </>
        )}
      </State>
    </>
  );
}
