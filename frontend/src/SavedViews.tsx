import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useNavigationType,
  useSearchParams,
} from "react-router-dom";
import { api, APIError } from "./api";
import { useAccountMutation } from "./accountMutations";
import { useApp, useText } from "./context";
import { sessionCoordinator } from "./session";
import {
  filtersFromSearch,
  filtersToSearch,
  rememberList,
  currentListEntryId,
  rememberListEntry,
  restoreListEntry,
  restoreList,
  validListState,
  type ListResource,
  type ViewFilters,
} from "./listNavigation";
import { ErrorMessage } from "./components";
// Live-document observations supplement validated entries restored from tab
// storage after a real back/forward document navigation.
const observedListEntries = new Set<string>();

export type SavedView = {
  id: string;
  resource: ListResource;
  name: string;
  filters: ViewFilters;
  is_default: boolean;
  revision: number;
  usable: boolean;
  invalid_reason: string | null;
};

export function ListLink({
  resource,
  to,
  children,
  className,
}: {
  resource: ListResource;
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const { user } = useApp(),
    location = useLocation(),
    navigate = useNavigate();
  return (
    <Link
      to={to}
      className={className}
      onClick={(event) => {
        if (
          event.button ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        const context = validListState(
          {
            accountId: user.id,
            resource,
            list_url: location.pathname + location.search,
            scroll_y: window.scrollY,
          },
          user.id,
          resource,
        );
        if (context)
          rememberList(user.id, resource, context.list_url, context.scroll_y);
        navigate(to, { state: { list: context } });
      }}
    >
      {children}
    </Link>
  );
}
export function ListBackLink({
  resource,
  children,
  className,
}: {
  resource: ListResource;
  children: ReactNode;
  className?: string;
}) {
  const { user } = useApp(),
    location = useLocation();
  const context =
    validListState(location.state?.list, user.id, resource) ||
    validListState(location.state?.list, user.id, "search") ||
    restoreList(user.id, resource);
  return (
    <Link
      className={className}
      to={context?.list_url || "/" + resource}
      state={{ restoreList: context }}
    >
      {children}
    </Link>
  );
}
export function useListContext(
  resource: ListResource,
  data: { total: number; page_size?: number } | null,
  page: number,
) {
  const { user } = useApp(),
    location = useLocation(),
    type = useNavigationType();
  const [params, setParams] = useSearchParams();
  const restored = useRef("");
  useEffect(() => {
    const entryId = currentListEntryId();
    if (!data) return;
    const last = Math.max(1, Math.ceil(data.total / (data.page_size || 25)));
    if (!Number.isInteger(page) || page < 1 || page > last) {
      const next = new URLSearchParams(params);
      next.set("page", String(last));
      setParams(next, { replace: true });
      return;
    }
    const url = location.pathname + location.search;
    const context =
      validListState(location.state?.restoreList, user.id, resource) ||
      (type === "POP"
        ? restoreListEntry(user.id, resource, entryId, url) ||
          restoreList(user.id, resource)
        : null);
    const remember = () => {
      rememberList(user.id, resource, url, window.scrollY);
      rememberListEntry(user.id, resource, entryId, url, window.scrollY);
    };
    let frame = 0;
    if (restored.current !== location.key) {
      if (context?.list_url === url) {
        frame = requestAnimationFrame(() => {
          window.scrollTo(0, context.scroll_y);
          restored.current = location.key;
          remember();
        });
      } else {
        restored.current = location.key;
        remember();
      }
    }
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", remember);
    };
  }, [data, page, location, type, user.id, resource, params, setParams]);
  // Call immediately before query navigation: a queued scroll event can arrive
  // only after the outgoing list has collapsed and lost its actual position.
  return function rememberPosition() {
    const url = location.pathname + location.search;
    const last = data
      ? Math.max(1, Math.ceil(data.total / (data.page_size || 25)))
      : 0;
    if (
      !data ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > last ||
      sessionCoordinator.capture().accountId !== user.id ||
      window.location.pathname + window.location.search !== url
    )
      return;
    const entryId = currentListEntryId();
    rememberList(user.id, resource, url, window.scrollY);
    rememberListEntry(user.id, resource, entryId, url, window.scrollY);
  };
}

export function SavedViews({
  resource,
  beforeNavigate,
}: {
  resource: ListResource;
  beforeNavigate: () => void;
}) {
  const { user, reviewWorkflow } = useApp(),
    t = useText(),
    send = useAccountMutation(),
    location = useLocation(),
    type = useNavigationType();
  const [params, setParams] = useSearchParams();
  const [views, setViews] = useState<SavedView[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [editing, setEditing] = useState<SavedView | null>(null),
    [filters, setFilters] = useState<ViewFilters | null>(null),
    [conflict, setConflict] = useState(false),
    [notice, setNotice] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const version = useRef(0),
    sequence = useRef(0),
    readSequence = useRef(0),
    alive = useRef(true),
    latestLocation = useRef(location),
    applied = useRef("");
  latestLocation.current = location;
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  const currentFilters = () => {
    const value = filtersFromSearch(resource, params);
    if (resource === "jobs" && !value.scope && !value.mine)
      value.scope = user.role === "admin" || user.reviewer ? "all" : "personal";
    if (resource === "reviews" && !value.tab)
      value.tab = user.role === "admin" || user.reviewer ? "pending" : "mine";
    return value;
  };
  async function read() {
    const sequence = ++readSequence.current;
    try {
      const rows = await api<SavedView[]>(`/saved-views?resource=${resource}`, {
        headers: { "X-AAG-Account": user.id },
      });
      return sequence === readSequence.current ? rows : null;
    } catch (error) {
      if (sequence !== readSequence.current) return null;
      throw error;
    }
  }
  useEffect(() => {
    let active = true;
    const capture = sessionCoordinator.capture(),
      entry = location;
    const entryId = currentListEntryId();
    const url = entry.pathname + entry.search;
    const priorEntry = restoreListEntry(user.id, resource, entryId, url);
    const entryKey = JSON.stringify([user.id, resource, entryId]);
    const documentRestoration =
      (
        performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined
      )?.type === "back_forward";
    read()
      .then((rows) => {
        if (!rows || !active || !sessionCoordinator.isCurrent(capture)) return;
        const restoring =
          type === "POP" &&
          (observedListEntries.has(entryKey) || documentRestoration);
        observedListEntries.add(entryKey);
        if (!priorEntry)
          rememberListEntry(user.id, resource, entryId, url, window.scrollY);
        setViews(rows);
        setError("");
        if (
          entry.search ||
          validListState(entry.state?.restoreList, user.id, resource) ||
          restoring ||
          latestLocation.current.key !== entry.key ||
          applied.current === entry.key
        )
          return;
        applied.current = entry.key;
        const view = rows.find((v) => v.is_default);
        if (!view) return;
        if (!view.usable) {
          setNotice(
            view.invalid_reason ||
              t("기본 보기를 수정하세요.", "Edit the default view."),
          );
          return;
        }
        const query = filtersToSearch(view.filters);
        if (!query.size) query.set("page", "1");
        setParams(query, { replace: true });
      })
      .catch((e) => {
        if (active && sessionCoordinator.isCurrent(capture))
          setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [resource, user.id, user.role, user.reviewer, location.key]);
  function edit(view: SavedView) {
    version.current++;
    setEditing(view);
    setName(view.name);
    setFilters(view.filters);
    setConflict(false);
    setError("");
  }
  async function mutate(
    path: string,
    body: unknown,
    method: string,
    clear = false,
  ) {
    if (uncertain || busy) return;
    const capture = sessionCoordinator.capture(),
      request = ++sequence.current,
      authored = version.current;
    const current = () =>
      alive.current &&
      request === sequence.current &&
      sessionCoordinator.isCurrent(capture);
    setBusy(true);
    setError("");
    try {
      await send(path, body, method);
      if (!current()) return;
      const rows = await read();
      if (!rows || !current()) return;
      setViews(rows);
      setNotice(t("저장된 보기를 갱신했습니다.", "Saved views updated."));
      if (clear && authored === version.current) {
        version.current++;
        setName("");
        setEditing(null);
        setFilters(null);
        setConflict(false);
      }
    } catch (e) {
      if (!current()) return;
      setError((e as Error).message);
      if (e instanceof TypeError || (e instanceof APIError && e.status >= 500))
        setUncertain(true);
      if (e instanceof APIError && e.status === 409) {
        setConflict(!!editing);
        try {
          const rows = await read();
          if (rows && current()) setViews(rows);
        } catch {
          /* Preserve the conflict and authored input. */
        }
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  const selected = filters || currentFilters();
  return (
    <section
      className="panel form-panel"
      aria-label={t("저장된 보기", "Saved views")}
    >
      <h2>{t("저장된 보기", "Saved views")}</h2>
      <ErrorMessage value={error} />
      {uncertain && (
        <p role="status">
          {t(
            "저장 결과를 확인해야 합니다. 목록을 다시 조회한 뒤 재시도하세요.",
            "Verify the save outcome. Reload views before retrying.",
          )}
        </p>
      )}
      {(error || uncertain) && (
        <button
          disabled={busy}
          onClick={() => {
            const capture = sessionCoordinator.capture();
            read()
              .then((rows) => {
                if (
                  rows &&
                  alive.current &&
                  sessionCoordinator.isCurrent(capture)
                ) {
                  setViews(rows);
                  setError("");
                  setUncertain(false);
                  setNotice(
                    t(
                      "최신 보기를 확인한 뒤 필요한 작업을 직접 선택하세요.",
                      "Review the latest views, then choose any further action.",
                    ),
                  );
                }
              })
              .catch((e) => {
                if (alive.current && sessionCoordinator.isCurrent(capture))
                  setError(e.message);
              });
          }}
        >
          {t("목록 다시 조회", "Reload views")}
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {!views ? (
        <p role="status">{t("조회 중…", "Loading views…")}</p>
      ) : !views.length ? (
        <p className="muted">
          {t("저장된 보기가 없습니다.", "No saved views.")}
        </p>
      ) : (
        <ul>
          {views.map((view) => (
            <li key={view.id}>
              <b>{view.name}</b>{" "}
              {view.is_default && <span>{t("기본 보기", "Default view")}</span>}
              <p className="muted">
                {t("조건", "Filters")}:{" "}
                {Object.entries(view.filters)
                  .filter(([key]) => key !== "version")
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ") || t("표준 조건", "Standard filters")}
              </p>
              {!view.usable && <p role="status">{view.invalid_reason}</p>}
              <div className="filters">
                <button
                  disabled={!view.usable || busy}
                  onClick={() => {
                    setNotice("");
                    const query = filtersToSearch(view.filters);
                    if (!query.size) query.set("page", "1");
                    beforeNavigate();
                    setParams(query);
                  }}
                >
                  {t("적용", "Apply")} · {view.name}
                </button>
                <button disabled={busy || uncertain} onClick={() => edit(view)}>
                  {t("수정", "Edit")} · {view.name}
                </button>
                <button
                  disabled={
                    busy || uncertain || !view.usable || view.is_default
                  }
                  onClick={() =>
                    void mutate(
                      `/saved-views/${view.id}`,
                      { expected_revision: view.revision, is_default: true },
                      "PATCH",
                    )
                  }
                >
                  {t("기본으로 설정", "Set default")} · {view.name}
                </button>
                <button
                  disabled={busy || uncertain}
                  onClick={() =>
                    void mutate(
                      `/saved-views/${view.id}`,
                      { expected_revision: view.revision },
                      "DELETE",
                    )
                  }
                >
                  {t("삭제", "Delete")} · {view.name}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            editing ? `/saved-views/${editing.id}` : "/saved-views",
            editing
              ? { expected_revision: editing.revision, name, filters: selected }
              : { resource, name, filters: selected },
            editing ? "PATCH" : "POST",
            true,
          );
        }}
      >
        <label>
          {t("보기 이름", "View name")}
          <input
            maxLength={40}
            required
            value={name}
            onChange={(e) => {
              version.current++;
              setName(e.target.value);
            }}
          />
        </label>
        {editing && (
          <>
            <label>
              {t("저장할 범위", "Saved scope")}
              <select
                value={String(
                  selected[resource === "jobs" ? "scope" : "tab"] ||
                    (resource === "jobs" ? "personal" : "mine"),
                )}
                onChange={(e) => {
                  version.current++;
                  setFilters({
                    ...selected,
                    [resource === "jobs" ? "scope" : "tab"]: e.target.value,
                  });
                }}
              >
                {(resource === "jobs"
                  ? ["personal", "review", "all"]
                  : [
                      "mine",
                      "pending",
                      "approved",
                      "all",
                      ...(reviewWorkflow && user.reviewer
                        ? ["actionable"]
                        : []),
                    ]
                ).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                version.current++;
                setFilters(currentFilters());
              }}
            >
              {t("현재 목록 조건 사용", "Use current filters")}
            </button>
          </>
        )}
        <button disabled={busy || uncertain || conflict}>
          {busy
            ? t("저장 중…", "Saving…")
            : editing
              ? t("변경 저장", "Save changes")
              : t("현재 보기 저장", "Save current view")}
        </button>
        {editing && (
          <button
            type="button"
            disabled={busy || uncertain}
            onClick={() => {
              version.current++;
              setEditing(null);
              setName("");
              setFilters(null);
              setConflict(false);
            }}
          >
            {t("취소", "Cancel")}
          </button>
        )}
        {conflict && (
          <p role="status">
            {t(
              "최신 보기를 확인한 뒤 다시 수정하세요. 입력은 유지됩니다.",
              "Review the latest view before editing again. Your input is retained.",
            )}{" "}
            {editing && (
              <button
                type="button"
                disabled={busy || uncertain}
                onClick={() => {
                  const latest = views?.find((v) => v.id === editing.id);
                  if (latest) {
                    version.current++;
                    setEditing(latest);
                    setConflict(false);
                  }
                }}
              >
                {t("최신 revision으로 다시 수정", "Re-edit latest revision")}
              </button>
            )}
          </p>
        )}
      </form>
    </section>
  );
}
