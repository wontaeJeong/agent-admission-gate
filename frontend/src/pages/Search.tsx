import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, APIError, type SearchResponse } from "../api";
import { useApp, useText } from "../context";
import { ListLink, useListContext } from "../SavedViews";

export function Search() {
  const { user } = useApp(),
    t = useText();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "",
    kind = params.get("type") || "scans",
    scope = params.get("scope") || "personal";
  const [input, setInput] = useState(query);
  const [result, setResult] = useState<{
    key: string;
    data: SearchResponse;
  } | null>(null);
  const [error, setError] = useState<{ key: string; status: number } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const key = user.id + ":" + params.toString() + ":" + retry;
  const current = useRef(key);
  current.current = key;
  const data = result?.key === key && input === query ? result.data : null;
  const failure = error?.key === key && input === query ? error : null;
  const valid =
    input.trim().length >= 2 &&
    input.length <= 200 &&
    input.trim().split(/\s+/).length <= 8;
  const rememberPosition = useListContext(
    "search",
    data ? { total: data.total ?? data.items.length } : null,
    1,
  );
  const remember = useRef(rememberPosition);
  remember.current = rememberPosition;
  useEffect(() => {
    setInput(query);
  }, [query]);
  useEffect(() => {
    if (input === query) return;
    const timer = window.setTimeout(() => {
      remember.current();
      const next = new URLSearchParams(params);
      next.set("q", input);
      next.delete("cursor");
      setParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input, query, params, setParams]);
  useEffect(() => {
    const sequence = ++generation.current;
    if (
      query.trim().length < 2 ||
      query.length > 200 ||
      query.trim().split(/\s+/).length > 8
    )
      return;
    const abort = new AbortController();
    const request = new URLSearchParams(params);
    if (!request.has("type")) request.set("type", "scans");
    if (!request.has("scope")) request.set("scope", "personal");
    api<SearchResponse>("/search?" + request, { signal: abort.signal }).then(
      (value) => {
        if (
          !abort.signal.aborted &&
          sequence === generation.current &&
          current.current === key
        ) {
          setResult({ key, data: value });
          setError(null);
        }
      },
      (reason) => {
        if (
          !abort.signal.aborted &&
          sequence === generation.current &&
          current.current === key
        ) {
          setResult(null);
          setError({
            key,
            status: reason instanceof APIError ? reason.status : 0,
          });
        }
      },
    );
    return () => {
      abort.abort();
      generation.current++;
    };
  }, [key, query, params]);
  function change(name: string, value: string) {
    rememberPosition();
    const next = new URLSearchParams(params);
    next.set("q", input);
    next.set(name, value);
    if (name !== "cursor") next.delete("cursor");
    setParams(next);
  }
  return (
    <div>
      <div className="page-heading">
        <h1>{t("통합 검색", "Search")}</h1>
        <p>
          {t(
            "권한이 있는 검사, 검토, 발견을 검색합니다.",
            "Search scans, reviews and findings you can access.",
          )}
        </p>
      </div>
      <div className="toolbar">
        <label>
          {t("검색어", "Search query")}
          <input
            autoFocus
            aria-label={t("검색어", "Search query")}
            value={input}
            maxLength={200}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("작업 ID, CVE, 경로", "Scan ID, CVE, path")}
          />
        </label>
        <label>
          {t("검색 범위", "Search scope")}
          <select
            aria-label={t("검색 범위", "Search scope")}
            value={scope}
            onChange={(e) => change("scope", e.target.value)}
          >
            <option value="personal">{t("내 항목", "Personal")}</option>
            {user.reviewer && (
              <option value="review">{t("검토 대상", "Review")}</option>
            )}
            {(user.reviewer || user.role === "admin") && (
              <option value="all">
                {t("전체 권한 범위", "All accessible")}
              </option>
            )}
            {scope !== "personal" &&
              !user.reviewer &&
              user.role !== "admin" && (
                <option value={scope}>
                  {t("접근할 수 없는 범위", "Unavailable scope")}
                </option>
              )}
          </select>
        </label>
      </div>
      <div
        className="tabs"
        role="tablist"
        aria-label={t("검색 유형", "Search type")}
      >
        {(
          [
            ["scans", "검사", "Scans"],
            ["reviews", "검토", "Reviews"],
            ["findings", "발견", "Findings"],
          ] as const
        ).map(([value, ko, en]) => (
          <button
            key={value}
            role="tab"
            aria-selected={kind === value}
            className={kind === value ? "selected" : ""}
            onClick={() => change("type", value)}
          >
            {t(ko, en)}
          </button>
        ))}
      </div>
      {!valid ? (
        <p className="notice">
          {t(
            "2–200자, 최대 8개 단어를 입력하세요. %, _는 문자 그대로 검색합니다.",
            "Enter 2–200 characters, up to 8 words. % and _ are literal characters.",
          )}
        </p>
      ) : failure ? (
        <div className="error" role="alert">
          <p>
            {failure.status === 403
              ? t(
                  "이 검색 범위에 접근할 권한이 없습니다.",
                  "You do not have access to this search scope.",
                )
              : failure.status === 404
                ? t("검색 기능을 사용할 수 없습니다.", "Search is unavailable.")
                : failure.status === 422
                  ? t(
                      "검색 조건이나 페이지가 유효하지 않습니다.",
                      "Search parameters or page are invalid.",
                    )
                  : t(
                      "검색 실패. 입력을 유지했습니다.",
                      "Search failed. Your input is preserved.",
                    )}
          </p>
          <button onClick={() => setRetry((value) => value + 1)}>
            {t("다시 시도", "Retry")}
          </button>
          {params.has("cursor") && (
            <button
              onClick={() => {
                rememberPosition();
                const next = new URLSearchParams(params);
                next.delete("cursor");
                setParams(next);
              }}
            >
              {t("첫 페이지", "First page")}
            </button>
          )}
        </div>
      ) : !data ? (
        <p role="status">{t("검색 중…", "Searching…")}</p>
      ) : (
        <>
          {!data.index_complete && (
            <p className="notice" role="status">
              {t(
                "검색 준비 중. 색인이 완료된 항목만 표시하며 전체 개수는 아직 알 수 없습니다.",
                "Search preparation is in progress. Only indexed items are shown; the total is not yet known.",
              )}
            </p>
          )}
          {data.index_complete && (
            <p role="status">
              {data.total === 0
                ? t("검색 결과가 없습니다.", "No results.")
                : t("검색 결과", "Results") + ": " + data.total}
            </p>
          )}
          <div className="search-results">
            {data.items.map((item) => (
              <article className="card" key={item.kind + ":" + item.id}>
                <h2>
                  <ListLink resource="search" to={item.href}>
                    {item.label}
                  </ListLink>
                </h2>
                <p>{item.safe_snippet}</p>
                <small>{item.id}</small>
              </article>
            ))}
          </div>
          <div className="toolbar">
            {params.has("cursor") && (
              <button
                onClick={() => {
                  rememberPosition();
                  const next = new URLSearchParams(params);
                  next.delete("cursor");
                  setParams(next);
                }}
              >
                {t("첫 페이지", "First page")}
              </button>
            )}
            {data.next_cursor && (
              <button onClick={() => change("cursor", data.next_cursor!)}>
                {t("다음 페이지", "Next page")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
