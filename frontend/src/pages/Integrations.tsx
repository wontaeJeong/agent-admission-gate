import { useAccountMutation } from "../accountMutations";
import { useRef, useState, type FormEvent } from "react";
import { useMemorySubmission } from "../useMemorySubmission";
import { sessionCoordinator } from "../session";
import { useSearchParams } from "react-router-dom";
import {
  CopyButton,
  Badge,
  Code,
  Empty,
  ErrorMessage,
  PageTitle,
  State,
  Tabs,
  useLoad,
} from "../components";
import { api, APIError, timestamp } from "../api";
import { useApp, useText } from "../context";

function KeysUnavailable({ state }: { state?: string }) {
  const { apiKeysState } = useApp(),
    t = useText();
  const availability = state ?? apiKeysState;
  if (availability === "available") return null;
  return (
    <div className="notice" role="status">
      {availability === "identity_unconfigured"
        ? t(
            "SSO 계정·그룹 확인이 구성되지 않아 API 키와 도구 연결이 차단되었습니다.",
            "API keys and tool connections are blocked because SSO account and group checks are not configured.",
          )
        : t(
            "API 키와 도구 연결이 비활성화되어 있습니다.",
            "API keys and tool connections are disabled.",
          )}{" "}
      {t("관리자에게 문의하세요.", "Contact your administrator.")}
    </div>
  );
}

export function Keys({ admin = false }: { admin?: boolean }) {
  const [params] = useSearchParams();
  const requested = !admin && params.has("key");
  const keyId =
    requested &&
    params.getAll("key").length === 1 &&
    /^[A-Za-z0-9_-]{1,64}$/.test(params.get("key") || "")
      ? params.get("key")
      : null;
  const send = useAccountMutation();
  const { apiKeysState, user, reconcileSession } = useApp();
  const issuance = useMemorySubmission(),
    revocation = useMemorySubmission();
  const createForm = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const [refresh, setRefresh] = useState(0),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [reason, setReason] = useState(""),
    [replacement, setReplacement] = useState(""),
    [name, setName] = useState(""),
    [scopes, setScopes] = useState(["scan:read", "scan:write"]),
    [days, setDays] = useState("90"),
    [availability, setAvailability] = useState(apiKeysState),
    [uncertain, setUncertain] = useState(false),
    [busy, setBusy] = useState(false),
    t = useText(),
    base = admin ? "/admin/api-keys" : "/api-keys",
    load = useLoad(
      base + (keyId ? "?key=" + encodeURIComponent(keyId) : ""),
      refresh,
    );
  const canIssue = apiKeysState === "available" && availability === "available";
  const scope = scopes.includes("scan:write")
    ? scopes.includes("scan:read")
      ? "write"
      : "write-only"
    : "read";
  function failed(e: unknown) {
    setError((e as Error).message);
    if (e instanceof APIError && e.status === 403) {
      sessionCoordinator.flush();
      reconcileSession(user.id);
    }
  }
  async function currentIssuance() {
    const config = await api("/auth/config");
    setAvailability(config.api_keys_state);
    const me = await api("/auth/me");
    if (me.id !== user.id)
      throw new APIError(
        409,
        t(
          "계정이 변경되었습니다. 폼을 다시 여세요.",
          "Account changed; reopen the form.",
        ),
      );
    return config.api_keys_state === "available";
  }
  async function prepare(k: any) {
    if (pending.current || token || uncertain) return;
    const receipt = issuance.beginSubmission(null);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await currentIssuance())) return;
      const keys = await api("/api-keys?key=" + encodeURIComponent(k.id));
      const current = keys.find((item: any) => item.id === k.id);
      if (!current)
        throw new Error(
          t(
            "선택한 API 키를 찾을 수 없습니다.",
            "The selected API key was not found.",
          ),
        );
      if (!issuance.markSubmitted(receipt)) return;
      setName(current.name);
      setScopes([...current.scopes]);
      setReplacement(current.id);
      createForm.current?.querySelector("input")?.focus();
    } catch (e) {
      if (issuance.isCurrentSubmission(receipt)) failed(e);
    } finally {
      if (issuance.isCurrentSubmission(receipt)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current || !canIssue || uncertain || token) return;
    const receipt = issuance.beginSubmission({
      name,
      days: Number(days),
      scopes: [...scopes],
    });
    pending.current = true;
    setBusy(true);
    setError("");
    let sent = false;
    try {
      if (!(await currentIssuance()) || !issuance.isCurrentSubmission(receipt))
        return;
      sent = true;
      const r = await send("/api-keys", receipt.fields);
      if (!issuance.isCurrentSubmission(receipt)) return;
      if (
        typeof r?.token !== "string" ||
        !/^aag_sk_[A-Za-z0-9_-]{43}$/.test(r.token)
      )
        throw new TypeError(
          t(
            "발급 응답에서 키 원문을 확인할 수 없습니다.",
            "The issuance response did not contain a usable key secret.",
          ),
        );
      // A newer edit can retain its input while the accepted token is shown once.
      setToken(r.token);
      setRefresh((x) => x + 1);
      if (!issuance.markSubmitted(receipt)) return;
      setName("");
      setScopes(["scan:read", "scan:write"]);
      setDays("90");
    } catch (e) {
      if (!issuance.isCurrentSubmission(receipt)) return;
      failed(e);
      if (
        sent &&
        (e instanceof TypeError || (e instanceof APIError && e.status >= 500))
      )
        setUncertain(true);
    } finally {
      if (issuance.isCurrentSubmission(receipt)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function checkKeys() {
    if (pending.current) return;
    const receipt = issuance.beginSubmission(null);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(base + (keyId ? "?key=" + encodeURIComponent(keyId) : ""));
      if (!admin) await currentIssuance();
      if (!issuance.isCurrentSubmission(receipt)) return;
      setUncertain(false);
      setRefresh((x) => x + 1);
    } catch (e) {
      if (issuance.isCurrentSubmission(receipt)) failed(e);
    } finally {
      if (issuance.isCurrentSubmission(receipt)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function revoke(e: FormEvent) {
    e.preventDefault();
    if (pending.current || uncertain || reason.trim().length < 5) return;
    const receipt = revocation.beginSubmission({ id: selected, reason });
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await send(base + "/" + receipt.fields.id + "/revoke", {
        reason: receipt.fields.reason,
      });
      if (!revocation.isCurrentSubmission(receipt)) return;
      setRefresh((x) => x + 1);
      if (!revocation.markSubmitted(receipt)) return;
      setSelected("");
      setReason("");
    } catch (e) {
      if (!revocation.isCurrentSubmission(receipt)) return;
      failed(e);
      if (e instanceof TypeError || (e instanceof APIError && e.status >= 500))
        setUncertain(true);
    } finally {
      if (revocation.isCurrentSubmission(receipt)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <>
      {!admin && (
        <PageTitle
          eyebrow="ACCESS"
          title={t("API 키", "API keys")}
          description={t(
            "본인이 발급한 키와 최근 사용 이력을 관리합니다.",
            "Manage your keys and recent usage.",
          )}
        />
      )}
      <ErrorMessage value={error} />
      {busy && <p role="status">{t("요청 처리 중…", "Processing request…")}</p>}
      {!admin && (
        <KeysUnavailable
          state={apiKeysState === "available" ? availability : apiKeysState}
        />
      )}
      {uncertain && (
        <div className="notice" role="status">
          <p>
            {t(
              "요청 결과를 확인할 수 없습니다. 키 목록을 먼저 확인하세요. 발급된 키 원문은 다시 조회할 수 없으므로 사용할 수 없는 새 키는 별도로 폐기하세요. 자동으로 재발급하지 않습니다.",
              "The request outcome is unknown. Check the key list first. An issued secret cannot be retrieved; revoke any unusable new key separately. Issuance is not retried automatically.",
            )}
          </p>
          <button disabled={busy} onClick={checkKeys}>
            {t("현재 키 목록 확인", "Check current keys")}
          </button>
        </div>
      )}
      {replacement && (
        <p className="notice" role="status">
          {t(
            "새 키를 도구에 반영한 뒤 이전 키를 별도로 폐기하세요.",
            "Update your tool with the new key, then revoke the previous key separately.",
          )}{" "}
          <code>{replacement}</code>
        </p>
      )}
      {token && (
        <section className="one-time" role="status">
          <h2>{t("키가 발급되었습니다", "Your key is ready")}</h2>
          <p>
            {t(
              "이 화면을 닫으면 원문을 다시 볼 수 없습니다. 안전한 곳에 보관하세요.",
              "The secret is shown once. Save it in your secret manager.",
            )}
          </p>
          <div className="secret-row">
            <code>{token}</code>
            <CopyButton value={token} />
          </div>
          <button onClick={() => setToken("")}>
            {t("저장했어요 · 닫기", "Saved · dismiss")}
          </button>
        </section>
      )}
      {!admin && (
        <section className="panel form-panel">
          <h2>{t("새 API 키", "New API key")}</h2>
          <form ref={createForm} onSubmit={create} className="inline-form">
            <label>
              {t("키 이름", "Name")}
              <input
                name="name"
                value={name}
                onChange={(e) => {
                  issuance.touch();
                  setName(e.target.value);
                }}
                placeholder="Claude Code / CI"
                maxLength={100}
                required
                disabled={!canIssue}
              />
            </label>
            <label>
              {t("만료", "Expires in")}
              <select
                name="days"
                value={days}
                onChange={(e) => {
                  issuance.touch();
                  setDays(e.target.value);
                }}
                disabled={!canIssue}
              >
                <option value="90">90 {t("일", "days")}</option>
                <option value="30">30 {t("일", "days")}</option>
                <option value="7">7 {t("일", "days")}</option>
              </select>
            </label>
            <label>
              {t("권한", "Scope")}
              <select
                name="scope"
                value={scope}
                onChange={(e) => {
                  issuance.touch();
                  setScopes(
                    e.target.value === "read"
                      ? ["scan:read"]
                      : e.target.value === "write-only"
                        ? ["scan:write"]
                        : ["scan:read", "scan:write"],
                  );
                }}
                disabled={!canIssue}
              >
                <option value="write">scan:read + scan:write</option>
                <option value="read">scan:read</option>
                <option value="write-only">scan:write</option>
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || !canIssue || uncertain || !!token}
            >
              {t("발급", "Create key")}
            </button>
          </form>
        </section>
      )}
      <State {...load}>
        {requested &&
          load.data &&
          !load.data.some((key: any) => key.id === keyId) && (
            <p className="notice" role="status">
              {t(
                "선택한 API 키를 찾을 수 없습니다.",
                "The selected API key was not found.",
              )}
            </p>
          )}
        {load.data?.length ? (
          <div className="key-list">
            <p className="panel-note">
              {t(
                "키 사용량은 REST 및 MCP HTTP 요청입니다. MCP HTTP 집계는 이 버전부터 시작되며 이전의 일부 도구 호출은 제외됩니다.",
                "Key usage counts REST and MCP HTTP requests. MCP HTTP recording starts with this version; earlier partial tool calls are excluded.",
              )}
            </p>
            {load.data.map((k: any) => (
              <article
                className="panel key-card"
                key={k.id}
                aria-current={keyId === k.id ? "true" : undefined}
              >
                {keyId === k.id && (
                  <p className="notice" role="status">
                    {t("선택한 API 키", "Selected API key")}
                  </p>
                )}
                <header>
                  <div>
                    <h2>{k.name}</h2>
                    <code>{k.display_key}</code>
                  </div>
                  <Badge value={k.state} />
                  {!admin && (
                    <button
                      disabled={busy || !canIssue || uncertain || !!token}
                      onClick={() => prepare(k)}
                    >
                      {t("새 키로 교체 준비", "Prepare replacement key")}
                    </button>
                  )}
                  {k.state === "active" && (
                    <button
                      className="danger-button"
                      disabled={busy || uncertain}
                      onClick={() => {
                        revocation.touch();
                        setSelected(k.id);
                        setReason("");
                      }}
                    >
                      {t("폐기", "Revoke")}
                    </button>
                  )}
                </header>
                <dl>
                  <div>
                    <dt>{t("발급자", "Issuer")}</dt>
                    <dd>{k.issuer}</dd>
                  </div>
                  <div>
                    <dt>{t("발급일", "Created")}</dt>
                    <dd>{timestamp(k.created_at)}</dd>
                  </div>
                  <div>
                    <dt>{t("만료일", "Expires")}</dt>
                    <dd>{timestamp(k.expires_at)}</dd>
                  </div>
                  <div>
                    <dt>{t("마지막 사용", "Last used")}</dt>
                    <dd>{timestamp(k.last_used_at)}</dd>
                  </div>
                  {k.revoked_at && (
                    <div>
                      <dt>{t("폐기일", "Revoked")}</dt>
                      <dd>{timestamp(k.revoked_at)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t("30일 HTTP 사용량", "30-day HTTP usage")}</dt>
                    <dd>
                      {k.requests_30d}
                      {t("요청 · ", " requests · ")}
                      {k.active_days_30d}
                      {t("일 사용", " active days")}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>{t("키 ID · 권한", "Key ID · scopes")}</summary>
                  <p className="mono">{k.id}</p>
                  <p>{k.scopes.join(", ")}</p>
                </details>
                {selected === k.id && (
                  <form className="revoke-form" onSubmit={revoke}>
                    <p>
                      {t(
                        "연결된 도구에서 이 키를 더 이상 사용할 수 없습니다.",
                        "Connected tools will no longer be able to use this key.",
                      )}
                    </p>
                    <label>
                      {t("폐기 사유", "Revocation reason")}
                      <input
                        value={reason}
                        onChange={(e) => {
                          revocation.touch();
                          setReason(e.target.value);
                        }}
                        minLength={5}
                        required
                      />
                    </label>
                    <div className="toolbar">
                      <button
                        type="button"
                        onClick={() => {
                          revocation.touch();
                          setSelected("");
                          setReason("");
                        }}
                      >
                        {t("취소", "Cancel")}
                      </button>
                      <button
                        className="danger-button"
                        disabled={busy || uncertain}
                      >
                        {t("키 폐기 확인", "Confirm revocation")}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty>{t("발급한 API 키가 없습니다.", "No API keys yet.")}</Empty>
        )}
      </State>
    </>
  );
}
export function Devices() {
  const send = useAccountMutation();
  const { apiKeysState } = useApp();
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [code, setCode] = useState(""),
    [verification, setVerification] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    load = useLoad("/device-clients", refresh),
    t = useText();
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    try {
      await send("/device-clients", { name: data.get("name") });
      form.reset();
      setRefresh((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setVerification(await api("/device/verify/" + code));
      setMessage("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(approve: boolean) {
    setBusy(true);
    try {
      await send("/device/decision", {
        user_code: verification.user_code,
        approve,
      });
      setVerification(null);
      setCode("");
      setMessage(
        approve
          ? t(
              "승인했습니다. 도구에서 키를 수령하세요.",
              "Approved. Retrieve the key from your tool.",
            )
          : t("연결을 거부했습니다.", "Connection denied."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="DEVICE AUTHORIZATION"
        title={t("도구 연결 등록", "Connect your tools")}
        description={t(
          "8자리 코드로 연결을 승인합니다. 코드는 10분 후 만료됩니다.",
          "Approve an eight-character code. Codes expire in 10 minutes.",
        )}
      />
      <ErrorMessage value={error} />
      <KeysUnavailable />
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <div className="two-columns">
        <section className="panel form-panel">
          <h2>{t("연결 코드 확인", "Verify a connection code")}</h2>
          <form onSubmit={verify}>
            <label>
              {t("도구에 표시된 코드", "Code shown by your tool")}
              <input
                className="device-code"
                value={code}
                onChange={(e) => {
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z2-9]/g, "")
                      .slice(0, 8),
                  );
                  setVerification(null);
                }}
                pattern="[A-Z2-9]{8}"
                required
                maxLength={8}
                placeholder="ABCD2345"
                disabled={apiKeysState !== "available"}
              />
            </label>
            <button disabled={busy || apiKeysState !== "available"}>
              {t("연결 정보 확인", "Check connection")}
            </button>
          </form>
          {verification && (
            <div className="verify-card">
              <h3>{verification.client_name}</h3>
              <p>
                {t("등록자", "Registered by")}: {verification.client_owner}
              </p>
              <p>
                {verification.scopes.join(" + ")} · 90 {t("일 키", "day key")}
              </p>
              <p>
                {t(
                  "본인이 시작한 연결인지 확인하세요.",
                  "Confirm that you initiated this connection.",
                )}
              </p>
              <div className="toolbar">
                <button
                  disabled={busy || apiKeysState !== "available"}
                  onClick={() => decide(false)}
                >
                  {t("거부", "Deny")}
                </button>
                <button
                  className="primary"
                  disabled={busy || apiKeysState !== "available"}
                  onClick={() => decide(true)}
                >
                  {t("연결 승인", "Approve connection")}
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="panel form-panel">
          <h2>{t("새 도구 등록", "Register a tool")}</h2>
          <form onSubmit={create}>
            <label>
              {t("표시 이름", "Display name")}
              <input
                name="name"
                maxLength={100}
                placeholder="My coding agent"
                required
                disabled={apiKeysState !== "available"}
              />
            </label>
            <button className="primary" disabled={apiKeysState !== "available"}>
              {t("등록", "Register")}
            </button>
          </form>
          <p className="muted">
            {t(
              "등록 후 발급된 Client ID로 Device Code Flow를 시작합니다.",
              "Use the registered Client ID to start the Device Code Flow.",
            )}
          </p>
        </section>
      </div>
      <State {...load}>
        <section className="panel">
          {load.data?.length ? (
            load.data.map((c: any) => (
              <div className="device-row" key={c.id}>
                <div>
                  <h3>{c.name}</h3>
                  <code>{c.id}</code>
                  <CopyButton value={c.id} />
                </div>
                <Badge value={c.active ? "active" : "disabled"} />
                {c.active && (
                  <button
                    onClick={async () => {
                      if (
                        confirm(
                          t(
                            "도구 등록을 비활성화할까요?",
                            "Disable this client registration?",
                          ),
                        )
                      ) {
                        try {
                          await send(
                            "/device-clients/" + c.id,
                            undefined,
                            "DELETE",
                          );
                          setRefresh((x) => x + 1);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }
                    }}
                  >
                    {t("비활성화", "Disable")}
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty>
              {t("등록된 도구가 없습니다.", "No registered tools.")}
            </Empty>
          )}
        </section>
      </State>
    </>
  );
}
export function Guide() {
  const [tab, setTab] = useState("rest"),
    t = useText(),
    base = location.origin;
  return (
    <>
      <PageTitle
        eyebrow="INTEGRATION GUIDE"
        title={t("API · MCP 가이드", "API · MCP guide")}
        description={t(
          "웹, CLI와 에이전트가 동일한 검사·권한·정책을 사용합니다.",
          "Web, CLI and agents share scan logic, authorization and policy.",
        )}
      />
      <Tabs
        values={[
          ["rest", "REST API"],
          ["mcp", "Remote MCP"],
        ]}
        selected={tab}
        onChange={setTab}
      />
      <section className="panel guide">
        <h2>
          {tab === "rest"
            ? t("검사 요청 → 상태 조회 → 판정 확인", "Submit → Poll → Inspect")
            : t(
                "에이전트에 검사 도구 연결",
                "Connect inspection tools to your agent",
              )}
        </h2>
        {tab === "rest" ? (
          <>
            <p>
              {t(
                "API 키를 Bearer 헤더로 전달합니다. 비동기 요청은 202와 작업 ID를 반환합니다.",
                "Pass an API key in the Bearer header. Asynchronous scans return 202 and a scan ID.",
              )}
            </p>
            <Code language="bash">{`export AAG_URL="${base}"
# Set AAG_API_KEY from your secret manager.
curl "$AAG_URL/api/scans" \\
  -H "Authorization: Bearer $AAG_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"url":"https://github.com/owner/repository","profile":"static"}'

curl "$AAG_URL/api/scans/SCAN_ID" \\
  -H "Authorization: Bearer $AAG_API_KEY"

# CLI: non-ALLOW verdicts return a nonzero CI exit code.
aag scan https://github.com/owner/repository --profile full --wait`}</Code>
            <p>
              {t(
                "최대 30초 동기 대기는 POST /api/scans?wait=30을 사용합니다. 시간이 지나면 작업은 계속 진행됩니다.",
                "Use POST /api/scans?wait=30 to wait up to 30 seconds; execution continues if the wait expires.",
              )}
            </p>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              {t("OpenAPI 명세 열기", "Open API reference")} ↗
            </a>
          </>
        ) : (
          <>
            <p>
              Streamable HTTP · <code>{base}/mcp/</code>
            </p>
            <Code>
              {JSON.stringify(
                {
                  mcpServers: {
                    "agent-admission-gate": {
                      url: `${base}/mcp/`,
                      headers: { Authorization: "Bearer <YOUR_API_KEY>" },
                    },
                  },
                },
                null,
                2,
              )}
            </Code>
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>{t("역할", "Purpose")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>scan</td>
                  <td>{t("Git URL 검사 접수", "Submit a Git scan")}</td>
                </tr>
                <tr>
                  <td>get_scan</td>
                  <td>
                    {t(
                      "본인 검사 상태·판정·발견 사항 조회",
                      "Read your status, verdict and evidence",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>list_scans</td>
                  <td>{t("본인 검사 목록 조회", "List your scans")}</td>
                </tr>
              </tbody>
            </table>
            <p>
              {t(
                "도구 연결 등록에서 Client ID를 만든 뒤 CLI의 device-login을 사용할 수도 있습니다.",
                "You can also register a Client ID and use device-login in the CLI.",
              )}
            </p>
            <Code language="bash">{"aag device-login CLIENT_ID"}</Code>
          </>
        )}
        <h2>{t("판정 계약", "Verdict contract")}</h2>
        <p>
          <Badge value="ALLOW" />{" "}
          {t("선택 범위 내 반입 허용", "Allowed within the chosen profile")} ·{" "}
          <Badge value="REVIEW" />{" "}
          {t(
            "검토 또는 누락 검사 필요",
            "Review or missing inspection required",
          )}{" "}
          · <Badge value="BLOCK" /> {t("반입 차단", "Admission blocked")}
        </p>
        <p>
          {t(
            "COMPLETED는 실행 완료 상태입니다. 반입 여부는 effective_verdict로 확인하세요.",
            "COMPLETED is an execution state. Use effective_verdict for the admission decision.",
          )}
        </p>
      </section>
    </>
  );
}
