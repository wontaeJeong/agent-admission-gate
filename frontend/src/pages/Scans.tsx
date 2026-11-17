import {
  findingEntries,
  filterFindings,
  parseFindingSelection,
  selectFinding,
  findingHref,
} from "../findingSelection";
import { SummaryTools } from "./ScanSummary";
import { rerunFields, snapshotCommit, type RerunMode } from "./scanRerun";
import { useDraft } from "../useDraft";
import { DraftRecovery } from "../DraftRecovery";
import { useDirtyForms } from "../DirtyForms";
import { useAccountMutation } from "../accountMutations";
import {
  SavedViews,
  ListLink,
  ListBackLink,
  useListContext,
} from "../SavedViews";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import {
  APIError,
  api,
  number,
  timestamp,
  type Finding,
  type Job,
} from "../api";
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
    { user } = useApp(),
    staff = user.role === "admin" || user.reviewer,
    scope =
      params.get("scope") ||
      (params.get("mine") === "true" || !staff ? "personal" : "all"),
    page = Number(params.get("page") || 1);
  const load = useLoad(`/scans?${params}`, 0, 5000);
  const rememberPosition = useListContext(
    "jobs",
    load.loading ? null : load.data,
    page,
  );
  const [query, setQuery] = useState(params.get("q") || "");
  useEffect(() => setQuery(params.get("q") || ""), [params]);
  useEffect(() => {
    if (query === (params.get("q") || "")) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (query) next.set("q", query);
      else next.delete("q");
      next.set("page", "1");
      rememberPosition();
      setParams(next);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, params, setParams]);
  const unavailable =
    (scope === "all" && !staff) || (scope === "review" && !user.reviewer);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "scope") next.delete("mine");
    if (key !== "page") next.set("page", "1");
    rememberPosition();
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
      <SavedViews resource="jobs" beforeNavigate={rememberPosition} />
      <div className="filters">
        <select
          aria-label={t("조회 범위", "Scope")}
          value={scope}
          onChange={(e) => change("scope", e.target.value)}
        >
          <option value="personal">{t("내 검사", "My scans")}</option>
          {(user.reviewer || scope === "review") && (
            <option value="review" disabled={!user.reviewer}>
              {t("검토 요청 검사", "Scans with review requests")}
            </option>
          )}
          {(staff || scope === "all") && (
            <option value="all" disabled={!staff}>
              {t("전체 검사", "All scans")}
            </option>
          )}
          {!["personal", "review", "all"].includes(scope) && (
            <option value={scope} disabled>
              {t("사용할 수 없는 범위", "Unavailable scope")}
            </option>
          )}
        </select>
        <select
          aria-label={t("조회 기간", "Date range")}
          value={params.get("days") || ""}
          onChange={(e) => change("days", e.target.value)}
        >
          <option value="">{t("전체 기간", "All time")}</option>
          {[7, 14, 30, 90].map((days) => (
            <option key={days} value={days}>
              {t(`최근 ${days}일`, `Last ${days} days`)} · UTC
            </option>
          ))}
        </select>
        <label className="search">
          <Search size={17} />
          <input
            aria-label={t("대상 검색", "Search source")}
            placeholder={t(
              "저장소 또는 파일 검색",
              "Search repository or file",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
        {params.get("mine") === "true" && (
          <label className="check">
            <input
              type="checkbox"
              checked
              onChange={() => change("mine", "")}
            />
            {t("내 검사만", "My scans only")}
          </label>
        )}
      </div>
      {unavailable && (
        <p className="panel-note" role="status">
          {t(
            "이 범위에는 직원 또는 검토자 자격이 필요합니다. 조회 범위를 수정하세요.",
            "Staff access required; edit scope. Reviewer scope requires reviewer qualification.",
          )}
        </p>
      )}
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
                          <ListLink
                            resource="jobs"
                            className="source-link"
                            to={"/jobs/" + j.id}
                          >
                            {j.source_type === "git" ? (
                              <GitBranch size={16} />
                            ) : (
                              <FileArchive size={16} />
                            )}
                            <span>{j.source}</span>
                          </ListLink>
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
                          <ListLink resource="jobs" to={"/jobs/" + j.id}>
                            <ArrowUpRight size={17} />
                          </ListLink>
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
  const [params] = useSearchParams();
  const from = params.get("from");
  const mode = params.get("mode") || "latest";
  if (!from) return <NewScanForm key="new" />;
  return <RerunScan key={`${from}:${mode}`} from={from} mode={mode} />;
}
function RerunScan({ from, mode }: { from: string; mode: string }) {
  const load = useLoad(`/scans/${encodeURIComponent(from)}`);
  const { user } = useApp();
  const t = useText();
  const job = load.data as Job | null;
  const available = job && job.owner_id === user.id;
  return (
    <State
      {...load}
      preserveContent={!!available && (!load.error || load.retryable)}
    >
      {job &&
        (!available ? (
          <ErrorMessage
            value={t(
              "본인 검사만 재검사할 수 있습니다.",
              "Only your own scan can be reused.",
            )}
          />
        ) : !["latest", "snapshot"].includes(mode) ? (
          <ErrorMessage
            value={t(
              "지원하지 않는 재검사 방식입니다.",
              "Unsupported rerun mode.",
            )}
          />
        ) : mode === "snapshot" &&
          (job.source_type !== "git" || !snapshotCommit(job)) ? (
          <ErrorMessage
            value={t(
              "이 검사에 기록된 커밋이 없습니다.",
              "No recorded commit is available for this scan.",
            )}
          />
        ) : (
          <NewScanForm
            origin={job}
            mode={mode as RerunMode}
            writable={!load.error || load.retryable}
          />
        ))}
    </State>
  );
}
function NewScanForm({
  origin,
  mode = "latest",
  writable = true,
}: {
  origin?: Job;
  mode?: RerunMode;
  writable?: boolean;
}) {
  const send = useAccountMutation();
  const t = useText(),
    navigate = useNavigate();
  const [linked, setLinked] = useState(!!origin);
  const [snapshot] = useState(() =>
    origin && mode === "snapshot" ? snapshotCommit(origin) : null,
  );
  const draft = useDraft({
    kind: "scan_new",
    targetId: "new",
    enabled: true,
    writable,
    initialFields: rerunFields(origin),
  });
  const { confirmLeave } = useDirtyForms();
  const type = String(draft.fields.type);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [checked, setChecked] = useState<Job[] | null>(null);
  const [checking, setChecking] = useState(false);
  const receipt = useRef<ReturnType<typeof draft.beginSubmission> | null>(null);
  async function checkLatest() {
    if (!receipt.current || checking) return;
    const submitted = receipt.current;
    setChecking(true);
    try {
      const response = await api<{ items: Job[] }>(
        "/scans?mine=true&page_size=25",
      );
      if (!draft.isCurrentSubmission(submitted)) return;
      setChecked(response.items);
      setUncertain(false);
    } catch (e) {
      if (draft.isCurrentSubmission(submitted)) setError((e as Error).message);
    } finally {
      if (draft.isCurrentSubmission(submitted)) setChecking(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current || draft.locked || uncertain) return;
    pending.current = true;
    const submission = draft.beginSubmission();
    receipt.current = submission;
    const fields = submission.fields;
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    setChecked(null);
    try {
      let result: Job;
      if (fields.type === "git") {
        const credential = String(data.get("credential") || "");
        result = await send("/scans", {
          url: fields.url,
          ref: linked && snapshot ? null : fields.ref || null,
          profile: fields.profile,
          force_rescan: !!fields.force,
          ...(linked && origin
            ? {
                origin_job_id: origin.id,
                rerun_mode: mode,
                ...(snapshot ? { target_commit: snapshot } : {}),
              }
            : {}),
          ...(credential ? { credential } : {}),
        });
      } else {
        const upload = new FormData();
        upload.set("file", data.get("file") as File);
        upload.set("profile", String(fields.profile));
        upload.set("force_rescan", String(!!fields.force));
        if (linked && origin) upload.set("origin_job_id", origin.id);
        result = await send("/scans/upload", upload);
      }
      if (!draft.markSubmitted(submission)) return;
      navigate("/jobs/" + result.id);
    } catch (e) {
      if (!draft.isCurrentSubmission(submission)) return;
      setError((e as Error).message);
      setUncertain(!(e instanceof APIError) || e.status >= 500);
    } finally {
      if (draft.isCurrentSubmission(submission)) {
        pending.current = false;
        setBusy(false);
      }
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
            onChange={(value) => {
              if (confirmLeave()) {
                setLinked(false);
                draft.update("type", value);
              }
            }}
          />
          {linked && origin && (
            <section
              className="notice"
              aria-label={t("재검사 설정", "Rerun settings")}
            >
              <h2>{t("같은 조건으로 다시 검사", "Reuse scan settings")}</h2>
              <p>
                <ListLink resource="jobs" to={"/jobs/" + origin.id}>
                  {t("원본 검사", "Origin scan")}
                </ListLink>
              </p>
              <p>
                {type === "upload"
                  ? t(
                      "ZIP 파일을 다시 선택하세요.",
                      "Select the ZIP file again.",
                    )
                  : snapshot
                    ? t("기록된 동일 커밋", "Recorded same commit")
                    : t(
                        "브랜치/태그의 현재 내용",
                        "Current branch or tag content",
                      )}
              </p>
              <p>
                {t(
                  "기존 승인과 예외를 복제하지 않습니다. 현재 내용과 정책을 다시 평가합니다.",
                  "Approvals and exceptions are not copied. Current content and policy are evaluated again.",
                )}
              </p>
              {draft.candidate && (
                <>
                  <p>
                    {t(
                      "원본 검사 설정 또는 연결 없는 새 검사로 초안 복구를 선택하세요.",
                      "Choose original scan settings or restore the previous draft as an unlinked new scan.",
                    )}
                  </p>
                  <button type="button" onClick={draft.discard}>
                    {t("원본 검사 설정 사용", "Use original scan settings")}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setLinked(false);
                  draft.touch();
                }}
              >
                {t("원본 연결 없이 계속", "Continue without origin")}
              </button>
            </section>
          )}
          <DraftRecovery
            draft={{
              ...draft,
              restore: () => {
                setLinked(false);
                draft.restore();
              },
            }}
          />
          <p className="muted">
            {t(
              "PAT와 ZIP 파일은 임시저장하지 않습니다. 복구 후 다시 입력하거나 선택하세요.",
              "PATs and ZIP files are not saved. Re-enter or select them after recovery.",
            )}
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={draft.locked}>
              <ErrorMessage value={error} />
              {uncertain && (
                <section className="notice" role="status">
                  <p>
                    {t(
                      "접수 여부를 확인하지 못했습니다. 최신 검사를 확인한 뒤 재제출 여부를 결정하세요.",
                      "Submission outcome is unknown. Check latest scans before deciding whether to submit again.",
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={checking}
                    onClick={checkLatest}
                  >
                    {t("최신 검사 확인", "Check latest scans")}
                  </button>
                </section>
              )}
              {checked && (
                <section className="notice" role="status">
                  <p>
                    {t(
                      "최신 검사를 확인했습니다. 다시 제출하기 전에 목록을 검토하세요.",
                      "Latest scans checked. Review the list before submitting again.",
                    )}
                  </p>
                  {checked.map((job) => (
                    <p key={job.id}>
                      <ListLink resource="jobs" to={"/jobs/" + job.id}>
                        {job.source} · {timestamp(job.created_at)} ·{" "}
                        {job.status}
                      </ListLink>
                    </p>
                  ))}
                  <ListLink resource="jobs" to="/jobs?mine=true">
                    {t("내 검사 전체 보기", "View all my scans")}
                  </ListLink>
                </section>
              )}
              {type === "git" ? (
                <>
                  <label>
                    {t("저장소 URL", "Repository URL")}
                    <input
                      name="url"
                      value={String(draft.fields.url)}
                      onChange={(e) => draft.update("url", e.target.value)}
                      type="url"
                      placeholder="https://github.com/owner/repository"
                      required
                      autoComplete="off"
                    />
                  </label>
                  {linked && snapshot ? (
                    <label>
                      {t("기록된 커밋", "Recorded commit")}
                      <input value={snapshot} readOnly className="mono" />
                    </label>
                  ) : (
                    <label>
                      {t("브랜치 또는 태그", "Branch or tag")}
                      <input
                        name="ref"
                        value={String(draft.fields.ref)}
                        onChange={(e) => draft.update("ref", e.target.value)}
                        placeholder={t(
                          "비워두면 기본 브랜치",
                          "Default branch when empty",
                        )}
                      />
                    </label>
                  )}
                  <details>
                    <summary>
                      {t(
                        "비공개 저장소 인증",
                        "Private repository credentials",
                      )}
                    </summary>
                    <label>
                      Personal access token
                      <input
                        name="credential"
                        onChange={draft.touch}
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
                  <strong>
                    {t("ZIP 패키지 선택", "Choose a ZIP package")}
                  </strong>
                  <span>
                    {t(
                      "최대 20 MB · 압축 해제 후 최대 100 MB",
                      "Up to 20 MB · 100 MB extracted",
                    )}
                  </span>
                  <input
                    name="file"
                    onChange={draft.touch}
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
                    checked={draft.fields.profile === "static"}
                    onChange={() => draft.update("profile", "static")}
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
                  <input
                    name="profile"
                    type="radio"
                    value="full"
                    checked={draft.fields.profile === "full"}
                    onChange={() => draft.update("profile", "full")}
                  />
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
                <input
                  type="checkbox"
                  name="force"
                  checked={!!draft.fields.force}
                  onChange={(e) => draft.update("force", e.target.checked)}
                />
                {t("기존 캐시를 사용하지 않고 다시 검사", "Force a fresh scan")}
              </label>
              <p className="muted">
                {draft.fields.force
                  ? t("캐시를 사용하지 않습니다.", "Cache will not be used.")
                  : t(
                      "동일 내용과 설정의 유효한 캐시를 사용할 수 있습니다.",
                      "A valid cache for the same content and settings may be used.",
                    )}
              </p>
              <button className="primary" disabled={busy || uncertain}>
                {busy
                  ? t("접수 중…", "Submitting…")
                  : t("검사 실행", "Run scan")}
              </button>
            </fieldset>
          </form>
        </section>
        <aside className="help-panel">
          <ShieldCheck size={26} />
          <h2>{t("검사 결과 적용 범위", "Scan result scope")}</h2>
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
  const send = useAccountMutation();
  const { id } = useParams(),
    [params, setParams] = useSearchParams(),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [reviewError, setReviewError] = useState(""),
    [reviewConflicted, setReviewConflicted] = useState(false),
    [busy, setBusy] = useState(false),
    t = useText(),
    { user } = useApp(),
    navigate = useNavigate();
  const load = useLoad<Job>("/scans/" + id, refresh, 4000),
    job = load.data,
    tab = params.get("tab") || "admission";
  const draft = useDraft({
    kind: "review_request",
    targetId: id!,
    enabled:
      !!job &&
      (!load.error || load.retryable) &&
      job.owner_id === user.id &&
      job.review !== undefined,
    writable:
      !reviewConflicted && job?.status === "COMPLETED" && job?.review === null,
    initialFields: { reason: "" },
    baseState: { status: job?.status, review_id: job?.review?.id ?? null },
  });
  async function requestReview(e: FormEvent) {
    e.preventDefault();
    const submission = draft.beginSubmission();
    setBusy(true);
    setReviewError("");
    try {
      const r = await send(`/scans/${id}/review`, {
        reason: submission.fields.reason,
      });
      if (!draft.markSubmitted(submission)) return;
      navigate("/reviews/" + r.id);
    } catch (e) {
      if (!draft.isCurrentSubmission(submission)) return;
      setReviewError((e as Error).message);
      if (e instanceof APIError && e.status === 409) {
        setReviewConflicted(true);
        setRefresh((x) => x + 1);
      }
    } finally {
      if (draft.isCurrentSubmission(submission)) setBusy(false);
    }
  }
  return (
    <>
      <ListBackLink resource="jobs" className="back">
        <ArrowLeft size={15} />
        {t("작업 목록", "Scans")}
      </ListBackLink>
      <State
        {...load}
        preserveContent={!!job && (!load.error || load.retryable)}
      >
        {job && (
          <>
            <PageTitle
              eyebrow={"SCAN / " + job.id.slice(0, 12)}
              title={job.source.split("/").filter(Boolean).pop() || job.source}
              description={job.source}
              actions={
                <>
                  <SummaryTools
                    id={id!}
                    findingLink={selectedFindingLink(job, params)}
                  />
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
            {job.owner_id === user.id && (
              <section className="panel">
                <h2>{t("같은 조건으로 다시 검사", "Reuse scan settings")}</h2>
                <div className="toolbar">
                  <ListLink
                    resource="jobs"
                    to={`/new?from=${job.id}&mode=latest`}
                  >
                    {job.source_type === "git"
                      ? t(
                          "브랜치/태그의 현재 내용",
                          "Current branch or tag content",
                        )
                      : t("ZIP 파일 다시 선택", "Select ZIP again")}
                  </ListLink>
                  {job.source_type === "git" &&
                    (snapshotCommit(job) ? (
                      <ListLink
                        resource="jobs"
                        to={`/new?from=${job.id}&mode=snapshot`}
                      >
                        {t("기록된 동일 커밋", "Recorded same commit")}
                      </ListLink>
                    ) : (
                      <button disabled>
                        {t("기록된 커밋 없음", "No recorded commit")}
                      </button>
                    ))}
                </div>
              </section>
            )}
            {job.origin_job_id && (
              <p>
                <ListLink resource="jobs" to={"/jobs/" + job.origin_job_id}>
                  {t("원본 검사", "Origin scan")} ↗
                </ListLink>
              </p>
            )}
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
              onChange={(v) =>
                setParams((old) => {
                  const next = new URLSearchParams(old);
                  next.set("tab", v);
                  return next;
                })
              }
            />
            {tab === "admission" && (
              <>
                <DraftRecovery draft={draft} />
                <Admission job={job} />
                {job.review && (
                  <section
                    className="panel form-panel"
                    aria-labelledby="scan-review-title"
                  >
                    <h2 id="scan-review-title">
                      {t("검토 요청", "Review request")}
                    </h2>
                    <p>
                      <Badge value={job.review.status} />
                    </p>
                    <p>
                      {t(
                        "이 검사의 검토 요청과 결정 내용을 확인합니다.",
                        "View this scan's review request and decision.",
                      )}
                    </p>
                    <Link to={"/reviews/" + job.review.id}>
                      {t("검토 상세 보기", "View review details")} ↗
                    </Link>
                  </section>
                )}
                {job.owner_id === user.id &&
                  job.status === "COMPLETED" &&
                  job.review === undefined && (
                    <p className="panel-note" role="status">
                      {t(
                        "검토 상태를 불러올 수 없습니다. 페이지를 새로고침해 주세요.",
                        "Review status is unavailable. Reload the page to try again.",
                      )}
                    </p>
                  )}
                {job.owner_id === user.id &&
                  job.status === "COMPLETED" &&
                  job.review === null &&
                  !reviewConflicted && (
                    <section className="panel form-panel">
                      <h2>{t("검토 요청", "Request review")}</h2>
                      <p>
                        {t(
                          "판정에 대한 설명이나 추가 근거를 검토자에게 전달합니다.",
                          "Provide context and evidence for a reviewer.",
                        )}
                      </p>
                      <form onSubmit={requestReview}>
                        <fieldset disabled={draft.locked}>
                          <ErrorMessage value={reviewError} />
                          <label>
                            {t("요청 사유", "Reason")}
                            <textarea
                              aria-label={t("요청 사유", "Reason")}
                              value={String(draft.fields.reason)}
                              onChange={(e) =>
                                draft.update("reason", e.target.value)
                              }
                              minLength={5}
                              maxLength={4000}
                              required
                            />
                          </label>
                          <button disabled={busy} className="primary">
                            {t("검토 요청", "Request review")}
                          </button>
                        </fieldset>
                      </form>
                    </section>
                  )}
              </>
            )}
            {tab === "findings" && (
              <Findings findings={job.result.findings || []} urlSelection />
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
                    [t("대상 커밋", "Target commit")]: job.target_commit,
                    [t("재검사 방식", "Rerun mode")]: job.rerun_mode,
                    [t("계보 루트", "Lineage root")]: job.lineage_root_id,
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
function findingView(findings: Finding[], params: URLSearchParams) {
  const entries = findingEntries(findings);
  const filtered = filterFindings(entries, {
    severity: params.get("severity") || "all",
    engine: params.get("engine") || "all",
    q: params.get("q") || "",
  });
  const query = parseFindingSelection(params);
  const selection =
    query.status === "valid"
      ? selectFinding(findings, query.fingerprint, query.occurrence)
      : query;
  const active =
    selection.status === "selected"
      ? selection.entry
      : selection.status === "absent"
        ? filtered[0]
        : undefined;
  return { filtered, active, missing: selection.status === "missing" };
}
function selectedFindingLink(job: Job, params: URLSearchParams) {
  const active = findingView(job.result.findings || [], params).active;
  return active
    ? findingHref(job.id, active.finding.fingerprint, active.occurrence)
    : undefined;
}
export function Findings({
  findings,
  urlSelection = false,
}: {
  findings: Finding[];
  urlSelection?: boolean;
}) {
  const [routeParams, setRouteParams] = useSearchParams();
  const [localParams, setLocalParams] = useState(new URLSearchParams());
  const params = urlSelection ? routeParams : localParams;
  const t = useText();
  const { filtered, active: entry, missing } = findingView(findings, params);
  const active = entry?.finding;
  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    if (urlSelection) setRouteParams(next, { replace: true });
    else setLocalParams(next);
  }
  return (
    <>
      <div className="filters finding-filters">
        <select
          aria-label={t("심각도", "Severity")}
          value={params.get("severity") || "all"}
          onChange={(e) => update({ severity: e.target.value })}
        >
          <option value="all">{t("모든 심각도", "All severities")}</option>
          {["critical", "high", "medium", "low", "info", "unknown"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label={t("발견 엔진", "Finding engine")}
          value={params.get("engine") || "all"}
          onChange={(e) => update({ engine: e.target.value })}
        >
          <option value="all">{t("모든 엔진", "All engines")}</option>
          {Array.from(new Set(findings.map((f) => f.engine))).map((engine) => (
            <option key={engine}>{engine}</option>
          ))}
        </select>
        <input
          aria-label={t("발견 검색", "Finding search")}
          placeholder={t("발견 검색", "Finding search")}
          value={params.get("q") || ""}
          onChange={(e) => update({ q: e.target.value })}
          maxLength={200}
        />
        <span>
          {filtered.length} {t("개 발견 사항", "findings")}
        </span>
      </div>
      {missing && (
        <div className="notice" role="status">
          {t(
            "이 결과에서 항목을 찾을 수 없습니다",
            "This item cannot be found in this result.",
          )}
        </div>
      )}
      {entry && !filtered.some((e) => e.index === entry.index) && (
        <div className="notice" role="status">
          <p>
            {t("필터 밖 항목입니다.", "Linked finding is outside the filters.")}
          </p>
          <button
            onClick={() => update({ severity: null, engine: null, q: null })}
          >
            {t("발견 필터 초기화", "Reset finding filters")}
          </button>
        </div>
      )}
      {filtered.length > 0 || active ? (
        <div className="finding-inspector">
          <div className="finding-list">
            {filtered.map(({ finding: f, index, occurrence }) => (
              <button
                key={index}
                onClick={() =>
                  update({
                    finding: f.fingerprint,
                    occurrence: String(occurrence),
                  })
                }
                className={entry?.index === index ? "selected" : ""}
                aria-pressed={entry?.index === index}
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
              <span className="eyebrow">
                {t("발견 상세", "FINDING INSPECTOR")}
              </span>
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
                <summary>{t("발견 지문", "Fingerprint")}</summary>
                <Code>{active.fingerprint}</Code>
              </details>
            </article>
          )}
        </div>
      ) : (
        !missing && (
          <Empty>
            {t("조건에 맞는 발견 사항이 없습니다.", "No matching findings.")}
          </Empty>
        )
      )}
    </>
  );
}
export function Comments({ endpoint }: { endpoint: string }) {
  const send = useAccountMutation();
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    load = useLoad(endpoint, refresh),
    { user } = useApp(),
    t = useText();
  const draft = useDraft({
    kind: "scan_comment",
    targetId: endpoint,
    enabled: load.data !== null && (!load.error || load.retryable),
    initialFields: { body: "", internal: false },
    allowCandidate: (candidate) =>
      !candidate.fields.internal || user.role === "admin" || user.reviewer,
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submission = draft.beginSubmission();
    setBusy(true);
    try {
      await send(endpoint, {
        body: submission.fields.body,
        internal: submission.fields.internal,
      });
      if (!draft.markSubmitted(submission)) return;
      draft.discard();
      setRefresh((x) => x + 1);
    } catch (e) {
      if (!draft.isCurrentSubmission(submission)) return;
      setError((e as Error).message);
    } finally {
      if (draft.isCurrentSubmission(submission)) setBusy(false);
    }
  }
  return (
    <section className="panel comments">
      <State
        {...load}
        preserveContent={load.data !== null && (!load.error || load.retryable)}
      >
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
      <DraftRecovery draft={draft} />
      <form onSubmit={submit}>
        <fieldset
          disabled={
            draft.locked || !load.data || (!!load.error && !load.retryable)
          }
        >
          <ErrorMessage value={error} />
          <label>
            {t("코멘트", "Comment")}
            <textarea
              name="body"
              aria-label={t("코멘트", "Comment")}
              value={String(draft.fields.body)}
              onChange={(e) => draft.update("body", e.target.value)}
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
              <input
                name="internal"
                type="checkbox"
                checked={!!draft.fields.internal}
                onChange={(e) => draft.update("internal", e.target.checked)}
              />
              {t("내부 검토자에게만 공개", "Staff only")}
            </label>
          )}
          <button className="primary" disabled={busy}>
            {t("등록", "Post comment")}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
