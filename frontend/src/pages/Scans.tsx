import { useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  FileArchive,
  GitBranch,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { api, number, send, timestamp, type Finding, type Job } from "../api";
import {
  Badge,
  Code,
  Empty,
  ErrorMessage,
  Markdown,
  PageTitle,
  Pagination,
  State,
  Tabs,
  useLoad,
} from "../components";
import { useApp, useText } from "../context";

export function Jobs() {
  const [params, setParams] = useSearchParams(),
    t = useText(),
    page = Number(params.get("page") || 1);
  const load = useLoad(`/scans?${params}`, 0, 5000);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setParams(next);
  };
  return (
    <>
      <PageTitle
        eyebrow="INSPECT"
        title={t("작업 목록", "Scans")}
        description={t(
          "대상 소스, 실행 상태와 최종 반입 판정을 확인합니다.",
          "Track source snapshots, execution and effective admission verdicts.",
        )}
        actions={
          <Link className="primary" to="/new">
            + {t("새 검사", "New scan")}
          </Link>
        }
      />
      <div className="filters">
        <label className="search">
          <Search size={17} />
          <input
            aria-label={t("대상 검색", "Search source")}
            placeholder={t(
              "저장소 또는 파일 검색",
              "Search repository or file",
            )}
            value={params.get("q") || ""}
            onChange={(e) => change("q", e.target.value)}
          />
        </label>
        <select
          aria-label={t("실행 상태", "Execution status")}
          value={params.get("status") || ""}
          onChange={(e) => change("status", e.target.value)}
        >
          <option value="">{t("모든 상태", "All statuses")}</option>
          {["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
        <select
          aria-label={t("판정", "Verdict")}
          value={params.get("verdict") || ""}
          onChange={(e) => change("verdict", e.target.value)}
        >
          <option value="">{t("모든 판정", "All verdicts")}</option>
          {["ALLOW", "REVIEW", "BLOCK"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={params.get("mine") === "true"}
            onChange={(e) => change("mine", String(e.target.checked))}
          />
          {t("내 검사만", "My scans")}
        </label>
      </div>
      <State {...load}>
        {load.data && (
          <section className="panel">
            {load.data.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        t("대상 / 작업 ID", "Source / scan ID"),
                        t("프로필", "Profile"),
                        t("실행 상태", "Execution"),
                        t("최종 판정", "Verdict"),
                        t("요청 시각", "Created"),
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {load.data.items.map((j: Job) => (
                      <tr key={j.id}>
                        <td>
                          <Link className="source-link" to={"/jobs/" + j.id}>
                            {j.source_type === "git" ? (
                              <GitBranch size={16} />
                            ) : (
                              <FileArchive size={16} />
                            )}
                            <span>{j.source}</span>
                          </Link>
                          <small className="mono">{j.id.slice(0, 12)}</small>
                        </td>
                        <td>{j.profile}</td>
                        <td>
                          <Badge value={j.status} />
                        </td>
                        <td>
                          <Badge value={j.effective_verdict} />
                        </td>
                        <td className="muted">{timestamp(j.created_at)}</td>
                        <td>
                          <Link to={"/jobs/" + j.id}>
                            <ArrowUpRight size={17} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>
                {t(
                  "조건에 맞는 검사가 없습니다.",
                  "No scans match these filters.",
                )}{" "}
                <Link to="/new">{t("검사 시작", "Start a scan")}</Link>
              </Empty>
            )}
            <Pagination
              page={page}
              total={load.data.total}
              onChange={(p) => change("page", String(p))}
            />
          </section>
        )}
      </State>
    </>
  );
}
export function NewScan() {
  const t = useText(),
    navigate = useNavigate();
  const [type, setType] = useState("git"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      let result: Job;
      if (type === "git") {
        const credential = String(data.get("credential") || "");
        const field = form.elements.namedItem("credential") as HTMLInputElement;
        field.value = "";
        result = await send("/scans", {
          url: data.get("url"),
          ref: data.get("ref") || null,
          profile: data.get("profile"),
          force_rescan: data.has("force"),
          ...(credential ? { credential } : {}),
        });
      } else {
        data.set("force_rescan", String(data.has("force")));
        result = await api("/scans/upload", { method: "POST", body: data });
      }
      navigate("/jobs/" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="NEW INSPECTION"
        title={t("새 검사 실행", "Start a new scan")}
        description={t(
          "코드를 실행하지 않고 소스와 메타데이터에서 위험 근거를 수집합니다.",
          "Inspect source and metadata without executing submitted code.",
        )}
      />
      <div className="form-layout">
        <section className="panel form-panel">
          <Tabs
            values={[
              ["git", t("Git 저장소", "Git repository")],
              ["upload", t("파일 업로드", "Upload package")],
            ]}
            selected={type}
            onChange={setType}
          />
          <form onSubmit={submit}>
            <ErrorMessage value={error} />
            {type === "git" ? (
              <>
                <label>
                  {t("저장소 URL", "Repository URL")}
                  <input
                    name="url"
                    type="url"
                    placeholder="https://github.com/owner/repository"
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  {t("브랜치 또는 태그", "Branch or tag")}
                  <input
                    name="ref"
                    placeholder={t(
                      "비워두면 기본 브랜치",
                      "Default branch when empty",
                    )}
                  />
                </label>
                <details>
                  <summary>
                    {t("비공개 저장소 인증", "Private repository credentials")}
                  </summary>
                  <label>
                    Personal access token
                    <input
                      name="credential"
                      type="password"
                      autoComplete="off"
                    />
                  </label>
                  <small>
                    {t(
                      "클론 과정에서만 메모리로 전달하고 저장하지 않습니다.",
                      "Used in memory only for cloning; never persisted.",
                    )}
                  </small>
                </details>
              </>
            ) : (
              <label className="upload-zone">
                <Upload size={26} />
                <strong>{t("ZIP 패키지 선택", "Choose a ZIP package")}</strong>
                <span>
                  {t(
                    "최대 20 MB · 압축 해제 후 최대 100 MB",
                    "Up to 20 MB · 100 MB extracted",
                  )}
                </span>
                <input
                  name="file"
                  type="file"
                  accept=".zip,application/zip"
                  required
                />
              </label>
            )}
            <fieldset>
              <legend>{t("검사 프로필", "Scan profile")}</legend>
              <label className="radio-card">
                <input
                  name="profile"
                  type="radio"
                  value="static"
                  defaultChecked
                />
                <span>
                  <b>Static</b>
                  <small>
                    {t(
                      "소스 규칙 · 감지된 Skill/MCP 메타데이터 검사",
                      "Source rules and detected Skill/MCP metadata",
                    )}
                  </small>
                </span>
              </label>
              <label className="radio-card">
                <input name="profile" type="radio" value="full" />
                <span>
                  <b>Full</b>
                  <small>
                    {t(
                      "Static + SBOM · 취약점 · 라이선스 · 모델 보조 판단",
                      "Static + SBOM, vulnerabilities, licenses and model advice",
                    )}
                  </small>
                </span>
              </label>
            </fieldset>
            <label className="check">
              <input type="checkbox" name="force" />
              {t("기존 캐시를 사용하지 않고 다시 검사", "Force a fresh scan")}
            </label>
            <button className="primary" disabled={busy}>
              {busy ? t("접수 중…", "Submitting…") : t("검사 실행", "Run scan")}
            </button>
          </form>
        </section>
        <aside className="help-panel">
          <ShieldCheck size={26} />
          <h2>{t("판정은 근거에서 시작합니다", "Evidence comes first")}</h2>
          <p>
            {t(
              "검사 결과는 선택한 프로필과 소스 시점에만 적용됩니다. 필요한 엔진이 없거나 실패하면 검토 대상으로 남습니다.",
              "Verdicts apply to the chosen profile and source snapshot. Missing or failed engines require review.",
            )}
          </p>
          <hr />
          <h3>{t("검사 후 확인할 내용", "After the scan")}</h3>
          <ul>
            <li>
              {t("반입 판정과 엔진 실행 범위", "Verdict and engine coverage")}
            </li>
            <li>
              {t(
                "위험 항목, 위치, 개선 방법",
                "Findings, locations and remediation",
              )}
            </li>
            <li>
              {t("검토 요청과 승인 이력", "Review requests and decisions")}
            </li>
          </ul>
          <Link to="/guide">
            {t("연동 가이드 보기", "Integration guide")} ↗
          </Link>
        </aside>
      </div>
    </>
  );
}
export function JobDetail() {
  const { id } = useParams(),
    [params, setParams] = useSearchParams(),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    t = useText(),
    { user } = useApp(),
    navigate = useNavigate();
  const load = useLoad<Job>("/scans/" + id, refresh, 4000),
    job = load.data,
    tab = params.get("tab") || "admission";
  async function requestReview(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await send(`/scans/${id}/review`, { reason });
      navigate("/reviews/" + r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back" to="/jobs">
        <ArrowLeft size={15} />
        {t("작업 목록", "Scans")}
      </Link>
      <State {...load}>
        {job && (
          <>
            <PageTitle
              eyebrow={"SCAN / " + job.id.slice(0, 12)}
              title={job.source.split("/").filter(Boolean).pop() || job.source}
              description={job.source}
              actions={
                <>
                  <a className="button" href={`/api/scans/${id}/export`}>
                    JSON ↓
                  </a>
                  <a
                    className="button"
                    href={`/api/scans/${id}/export?format=sarif`}
                  >
                    SARIF ↓
                  </a>
                  {["PENDING", "RUNNING"].includes(job.status) && (
                    <button
                      className="danger-button"
                      onClick={async () => {
                        if (
                          confirm(t("검사를 취소할까요?", "Cancel this scan?"))
                        ) {
                          try {
                            await send(`/scans/${id}/cancel`, {});
                            setRefresh((x) => x + 1);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }
                      }}
                    >
                      {t("검사 취소", "Cancel scan")}
                    </button>
                  )}
                </>
              }
            />
            <ErrorMessage value={error} />
            <div className="scan-strip">
              <Badge value={job.status} />
              <span>{job.profile}</span>
              <span>{timestamp(job.created_at)}</span>
              {job.cached_from && (
                <Link to={"/jobs/" + job.cached_from}>
                  {t("캐시 재사용", "Cached result")} ↗
                </Link>
              )}
            </div>
            <Tabs
              values={[
                ["admission", "Admission"],
                ["comments", t("코멘트", "Comments")],
                ["findings", t("발견 사항", "Findings")],
                ["actions", "Actions"],
                ["engines", t("엔진", "Engines")],
                ["meta", t("메타데이터", "Metadata")],
                ["timeline", t("타임라인", "Timeline")],
                ["raw", "Raw JSON"],
              ]}
              selected={tab}
              onChange={(v) => setParams({ tab: v })}
            />
            {tab === "admission" && (
              <>
                <Admission job={job} />
                {job.owner_id === user.id && job.status === "COMPLETED" && (
                  <section className="panel form-panel">
                    <h2>{t("검토 요청", "Request review")}</h2>
                    <p>
                      {t(
                        "판정에 대한 설명이나 추가 근거를 검토자에게 전달합니다.",
                        "Provide context and evidence for a reviewer.",
                      )}
                    </p>
                    <form onSubmit={requestReview}>
                      <label>
                        {t("요청 사유", "Reason")}
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          minLength={5}
                          maxLength={4000}
                          required
                        />
                      </label>
                      <button disabled={busy} className="primary">
                        {t("검토 요청", "Request review")}
                      </button>
                    </form>
                  </section>
                )}
              </>
            )}
            {tab === "findings" && (
              <Findings findings={job.result.findings || []} />
            )}
            {tab === "comments" && (
              <Comments endpoint={`/scans/${id}/comments`} />
            )}
            {tab === "actions" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>{t("감지된 동작 범주", "Detected capabilities")}</h2>
                </div>
                {job.result.findings?.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>{t("발견 수", "Findings")}</th>
                          <th>{t("위험 수준", "Severity")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(
                          new Set(job.result.findings.map((f) => f.action)),
                        ).map((action) => (
                          <tr key={action}>
                            <td>{action}</td>
                            <td>
                              {
                                job.result.findings!.filter(
                                  (f) => f.action === action,
                                ).length
                              }
                            </td>
                            <td>
                              {Array.from(
                                new Set(
                                  job.result
                                    .findings!.filter(
                                      (f) => f.action === action,
                                    )
                                    .map((f) => f.severity),
                                ),
                              ).map((s) => (
                                <Badge key={s} value={s} />
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    {t(
                      "감지된 동작이 없습니다. 실행 중 안전성을 보장하는 의미는 아닙니다.",
                      "No detected capabilities. This does not guarantee runtime safety.",
                    )}
                  </Empty>
                )}
              </section>
            )}
            {tab === "engines" && (
              <section className="panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {["Engine", "Status", "Duration", "Details"].map(
                          (h) => (
                            <th key={h}>{h}</th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {job.result.engines?.map((e, i) => (
                        <tr key={i}>
                          <td>{e.name}</td>
                          <td>
                            <Badge value={e.status} />
                          </td>
                          <td>{number(e.duration_ms)} ms</td>
                          <td>
                            {e.error ||
                              (e.packages !== undefined
                                ? `${e.packages} packages`
                                : "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {tab === "meta" && (
              <section className="panel metadata">
                <dl>
                  {Object.entries({
                    ID: job.id,
                    Source: job.source,
                    Ref: job.ref,
                    Commit: job.resolved_commit,
                    "Content SHA256": job.content_hash,
                    Profile: job.profile,
                    Policy: job.result.policy_version,
                    "Scanner revision": job.result.scanner_revision,
                    Owner: job.owner_id,
                    Created: timestamp(job.created_at),
                  }).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className="mono">{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {tab === "timeline" && (
              <section className="panel timeline">
                {[
                  [t("요청 접수", "Submitted"), job.created_at],
                  [t("검사 시작", "Started"), job.started_at],
                  ...(job.result.engines || []).map((e) => [
                    e.name + " · " + e.status,
                    e.started_at,
                  ]),
                  [t("검사 종료", "Finished"), job.completed_at],
                ].map(([label, at], i) => (
                  <div key={i}>
                    <span
                      className={at ? "timeline-dot done" : "timeline-dot"}
                    />
                    <strong>{label}</strong>
                    <time>{timestamp(at as number)}</time>
                  </div>
                ))}
              </section>
            )}
            {tab === "raw" && <Code>{JSON.stringify(job, null, 2)}</Code>}
          </>
        )}
      </State>
    </>
  );
}
export function Admission({ job }: { job: Job }) {
  const t = useText();
  return (
    <section
      className={
        "panel admission-panel " + (job.effective_verdict || "").toLowerCase()
      }
    >
      <div className="admission-header">
        <ShieldCheck size={30} />
        <div>
          <span className="eyebrow">ADMISSION VERDICT</span>
          <h2>{job.effective_verdict || t("판정 대기", "Awaiting verdict")}</h2>
        </div>
        <Badge
          value={
            job.result.coverage_complete
              ? "coverage complete"
              : "coverage incomplete"
          }
        />
      </div>
      <p>
        {job.error ||
          (job.status !== "COMPLETED"
            ? t(
                "검사가 끝나면 근거에 따른 판정이 표시됩니다.",
                "A verdict appears after the scan completes.",
              )
            : job.effective_verdict === "ALLOW"
              ? t(
                  "선택한 검사 범위와 정책에 따라 반입이 허용되었습니다.",
                  "Admission is allowed within the selected inspection scope and policy.",
                )
              : job.effective_verdict === "BLOCK"
                ? t(
                    "위험 근거가 발견되어 반입이 차단되었습니다.",
                    "Evidence of risk blocks admission.",
                  )
                : t(
                    "사람의 검토 또는 누락된 검사가 필요합니다.",
                    "Human review or missing engine coverage is required.",
                  ))}
      </p>
      <div className="admission-facts">
        <div>
          <small>{t("원래 판정", "Original verdict")}</small>
          <Badge value={job.verdict} />
        </div>
        <div>
          <small>{t("발견 사항", "Findings")}</small>
          <b>{job.result.findings?.length || 0}</b>
        </div>
        <div>
          <small>{t("엔진 완료", "Engines complete")}</small>
          <b>
            {job.result.engines?.filter((e) => e.status === "completed")
              .length || 0}{" "}
            / {job.result.engines?.length || 0}
          </b>
        </div>
      </div>
      {job.result.limitations?.map((l) => (
        <small className="limit-note" key={l}>
          {l}
        </small>
      ))}
    </section>
  );
}
export function Findings({ findings }: { findings: Finding[] }) {
  const [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState(""),
    t = useText();
  const filtered = findings.filter(
      (f) => filter === "all" || f.severity === filter,
    ),
    active = filtered.find((f) => f.fingerprint === selected) || filtered[0];
  return (
    <>
      <div className="filters">
        <select
          aria-label="Severity"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t("모든 심각도", "All severities")}</option>
          {["critical", "high", "medium", "low", "unknown"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span>
          {filtered.length} {t("개 발견 사항", "findings")}
        </span>
      </div>
      {filtered.length ? (
        <div className="finding-inspector">
          <div className="finding-list">
            {filtered.map((f) => (
              <button
                key={f.fingerprint}
                onClick={() => setSelected(f.fingerprint)}
                className={
                  active?.fingerprint === f.fingerprint ? "selected" : ""
                }
              >
                <div>
                  <Badge value={f.severity} />
                  <small>
                    {f.engine}
                    {f.suppressed ? " · exception" : ""}
                  </small>
                </div>
                <strong>{f.title}</strong>
                <small className="mono">
                  {f.path}
                  {f.line ? ":" + f.line : ""}
                </small>
              </button>
            ))}
          </div>
          {active && (
            <article className="finding-detail">
              <span className="eyebrow">FINDING INSPECTOR</span>
              <h2>{active.title}</h2>
              <Badge value={active.severity} />
              <p className="mono">{active.rule}</p>
              <h3>{t("근거", "Evidence")}</h3>
              <p>
                {active.evidence ||
                  t(
                    "검사 규칙과 위치를 확인하세요.",
                    "See the rule and source location.",
                  )}
              </p>
              <p className="mono">
                {active.path}
                {active.line ? ":" + active.line : ""}
              </p>
              <h3>{t("개선 방법", "Remediation")}</h3>
              <p>
                {active.remediation ||
                  t(
                    "원본 코드와 엔진 결과를 검토하세요.",
                    "Review the source and engine result.",
                  )}
              </p>
              <details>
                <summary>Fingerprint</summary>
                <Code>{active.fingerprint}</Code>
              </details>
            </article>
          )}
        </div>
      ) : (
        <Empty>
          {t("조건에 맞는 발견 사항이 없습니다.", "No matching findings.")}
        </Empty>
      )}
    </>
  );
}
export function Comments({ endpoint }: { endpoint: string }) {
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    load = useLoad(endpoint, refresh),
    { user } = useApp(),
    t = useText();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    try {
      await send(endpoint, {
        body: data.get("body"),
        internal: data.has("internal"),
      });
      form.reset();
      setRefresh((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel comments">
      <State {...load}>
        {load.data?.length ? (
          load.data.map((c: any) => (
            <article key={c.id}>
              <header>
                <b>{c.author}</b>
                <time>{timestamp(c.created_at)}</time>
                {c.internal && <Badge value="internal" />}
              </header>
              <Markdown>{c.body}</Markdown>
            </article>
          ))
        ) : (
          <Empty>
            {t("첫 코멘트를 남겨보세요.", "Start the conversation.")}
          </Empty>
        )}
      </State>
      <form onSubmit={submit}>
        <ErrorMessage value={error} />
        <label>
          {t("코멘트", "Comment")}
          <textarea
            name="body"
            required
            maxLength={20000}
            placeholder={t(
              "Markdown으로 작성할 수 있습니다.",
              "Markdown supported.",
            )}
          />
        </label>
        {(user.role === "admin" || user.reviewer) && (
          <label className="check">
            <input name="internal" type="checkbox" />
            {t("내부 검토자에게만 공개", "Staff only")}
          </label>
        )}
        <button className="primary" disabled={busy}>
          {t("등록", "Post comment")}
        </button>
      </form>
    </section>
  );
}
