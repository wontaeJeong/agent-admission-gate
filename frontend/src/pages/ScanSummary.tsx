import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { sessionCoordinator } from "../session";
import { Markdown, State, useLoad } from "../components";
import { useText } from "../context";
import { ListLink, ListBackLink } from "../SavedViews";

/** All text reads use the common session/account response guards. */
const summaryPath = (id: string) => `/scans/${id}/summary?format=markdown`;
export function SummaryTools({
  id,
  findingLink,
  summaryPage = false,
}: {
  id: string;
  findingLink?: string;
  summaryPage?: boolean;
}) {
  const t = useText();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef(0);
  useEffect(() => {
    const epoch = ++lifetime.current;
    return () => {
      if (lifetime.current === epoch) lifetime.current++;
    };
  }, [id]);
  async function act(kind: "link" | "copy" | "download") {
    const epoch = lifetime.current,
      capture = sessionCoordinator.capture();
    const current = () =>
      epoch === lifetime.current && sessionCoordinator.isCurrent(capture);
    setBusy(true);
    setMessage("");
    try {
      const text =
        kind === "link"
          ? window.location.origin + findingLink!
          : await api<string>(summaryPath(id), {}, "text");
      if (!current()) return;
      if (kind === "download") {
        const url = URL.createObjectURL(
          new Blob([text], { type: "text/markdown;charset=utf-8" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `scan-${id}.md`;
        anchor.click();
        URL.revokeObjectURL(url);
      } else {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          if (current())
            setMessage(
              t(
                "복사하지 못했습니다. 다시 시도하거나 Markdown을 내려받으세요.",
                "Copy failed. Try again or download Markdown.",
              ),
            );
          return;
        }
        if (current()) setMessage(t("복사했습니다.", "Copied."));
      }
    } catch (error) {
      if (current()) setMessage((error as Error).message);
    } finally {
      if (current()) setBusy(false);
    }
  }
  const controls = (
    <>
      {!summaryPage && (
        <button
          disabled={busy || !findingLink}
          onClick={() => void act("link")}
        >
          {t("발견 링크 복사", "Copy finding link")}
        </button>
      )}
      <button disabled={busy} onClick={() => void act("copy")}>
        {t("판정 요약 복사", "Copy verdict summary")}
      </button>
      <button disabled={busy} onClick={() => void act("download")}>
        {t("Markdown 다운로드", "Download Markdown")}
      </button>
      {summaryPage ? (
        <button onClick={() => window.print()}>{t("인쇄", "Print")}</button>
      ) : (
        <ListLink resource="jobs" to={`/jobs/${id}/summary`}>
          {t("인쇄", "Print")}
        </ListLink>
      )}
      {!summaryPage && (
        <ListLink resource="jobs" to={`/jobs/${id}/summary`}>
          {t("읽기용 요약", "Read summary")}
        </ListLink>
      )}
      <p className="muted">
        {t(
          "링크는 접근 권한을 부여하지 않습니다.",
          "Links do not grant access.",
        )}
      </p>
      {message && <p role="status">{message}</p>}
    </>
  );
  return summaryPage ? (
    <div className="summary-tools toolbar">{controls}</div>
  ) : (
    <details className="detail-tools">
      <summary>{t("상세 도구", "Detail tools")}</summary>
      <div className="toolbar">{controls}</div>
    </details>
  );
}
export function ScanSummary() {
  const { id } = useParams();
  const t = useText();
  const load = useLoad<string>(summaryPath(id!), 0, 4000, "text");
  return (
    <>
      <div className="summary-tools toolbar">
        <ListLink resource="jobs" to={`/jobs/${id}`}>
          {t("검사로 돌아가기", "Back to scan")}
        </ListLink>
        <ListBackLink resource="jobs">{t("작업 목록", "Scans")}</ListBackLink>
      </div>
      <State
        {...load}
        preserveContent={load.data !== null && (!load.error || load.retryable)}
      >
        {load.data !== null && (
          <>
            <SummaryTools id={id!} summaryPage />
            <article className="panel scan-summary">
              <Markdown>{load.data}</Markdown>
            </article>
          </>
        )}
      </State>
    </>
  );
}
