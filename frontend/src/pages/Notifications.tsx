import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Check,
  CheckCheck,
  Circle,
  RefreshCw,
  Settings,
} from "lucide-react";
import {
  Empty,
  ErrorMessage,
  PageTitle,
  Pagination,
  State,
  Tabs,
} from "../components";
import { useText } from "../context";
import {
  changeNotification,
  NotificationIcon,
  NotificationText,
  useNotifications,
  useNotificationApi,
  useNotificationLoad,
  type Notification,
  type NotificationList,
} from "../notifications";

export function Notifications() {
  const t = useText(),
    { refresh, unread } = useNotifications();
  const [params, setParams] = useSearchParams();
  const view = ["all", "unread", "archived", "settings"].includes(
    params.get("view") || "",
  )
    ? params.get("view")!
    : "all";
  const category = ["scans", "reviews", "comments"].includes(
    params.get("category") || "",
  )
    ? params.get("category")!
    : "all";
  const requestedPage = Number(params.get("page") || 1);
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 1000000
      ? requestedPage
      : 1;
  const settings = view === "settings";
  function changeFilters(changes: {
    view?: string;
    category?: string;
    page?: number;
  }) {
    // History updates before a route transition renders. Read the latest URL
    // so a rapid second filter action cannot restore the previous tab.
    const nextParams = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === "all" || value === 1) nextParams.delete(key);
      else nextParams.set(key, String(value));
    }
    if (!("page" in changes)) nextParams.delete("page");
    setParams(nextParams);
  }
  return (
    <>
      <PageTitle
        eyebrow="INBOX"
        title={t("알림함", "Notifications")}
        description={t(
          "검사와 검토의 새 소식을 한곳에서 확인하세요. 알림은 90일간 보관됩니다.",
          "Scan and review updates in one place. Notifications are kept for 90 days.",
        )}
        actions={
          <button
            onClick={refresh}
            aria-label={t("알림 새로고침", "Refresh notifications")}
          >
            <RefreshCw size={15} />
            {t("새로고침", "Refresh")}
          </button>
        }
      />
      <Tabs
        values={[
          ["all", t("전체", "All")],
          [
            "unread",
            t("안 읽음", "Unread") + (unread !== null ? ` (${unread})` : ""),
          ],
          ["archived", t("보관함", "Archived")],
          ["settings", t("알림 설정", "Settings")],
        ]}
        selected={view}
        onChange={(v) => changeFilters({ view: v })}
      />
      {settings ? (
        <NotificationSettings />
      ) : (
        <Inbox
          key={view + category}
          view={view}
          category={category}
          page={page}
          onChangePage={(p) => changeFilters({ page: p })}
          onCategory={(c) => changeFilters({ category: c })}
        />
      )}
    </>
  );
}

function Inbox({
  view,
  category,
  page,
  onChangePage,
  onCategory,
}: {
  view: string;
  category: string;
  page: number;
  onChangePage: (page: number) => void;
  onCategory: (category: string) => void;
}) {
  const t = useText(),
    navigate = useNavigate(),
    { revision, refresh } = useNotifications();
  const [reload, setReload] = useState(0);
  const request = useNotificationApi();
  const load = useNotificationLoad<NotificationList>(
    `/notifications?state=${view}&category=${category}&page=${page}`,
    revision + reload,
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (load.data && page > Math.max(1, Math.ceil(load.data.total / 25)))
      onChangePage(Math.max(1, Math.ceil(load.data.total / 25)));
  }, [load.data, page, onChangePage]);
  async function mutate(
    id: string,
    changes: { read?: boolean; archived?: boolean },
    href?: string,
  ) {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      await changeNotification(request, id, changes);
      refresh();
      if (!active.current) return;
      if (href) navigate(href);
      else setReload((v) => v + 1);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy("");
    }
  }
  function openItem(e: MouseEvent<HTMLAnchorElement>, item: Notification) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    if (busy) return;
    if (item.read_at) navigate(item.href);
    else void mutate(item.id, { read: true }, item.href);
  }
  async function markAll() {
    if (!load.data || busy) return;
    setBusy("all");
    setError("");
    try {
      await request("/notifications/read-all", {
        method: "POST",
        body: JSON.stringify({
          category,
          before: load.data.snapshot_at,
          through: load.data.snapshot_sequence,
        }),
      });
      refresh();
      if (active.current) setReload((v) => v + 1);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy("");
    }
  }
  return (
    <section
      className="notification-inbox"
      aria-label={t("받은 알림", "Notification inbox")}
    >
      <div className="notification-toolbar">
        <label>
          {t("알림 유형", "Notification type")}
          <select value={category} onChange={(e) => onCategory(e.target.value)}>
            <option value="all">{t("모든 유형", "All types")}</option>
            <option value="scans">{t("검사", "Scans")}</option>
            <option value="reviews">{t("검토", "Reviews")}</option>
            <option value="comments">{t("코멘트", "Comments")}</option>
          </select>
        </label>
        {view !== "archived" && (
          <button
            disabled={!!busy || !load.data?.filtered_unread_count}
            onClick={() => void markAll()}
          >
            <CheckCheck size={15} />
            {t("모두 읽음", "Mark all as read")}
          </button>
        )}
      </div>
      <ErrorMessage value={error || load.error} />
      <State loading={load.loading}>
        {load.data && (
          <>
            {load.data.items.length === 0 ? (
              <Empty>
                <Bell size={25} aria-hidden="true" />
                <h2>
                  {view === "unread"
                    ? t("안 읽은 알림이 없습니다", "No unread notifications")
                    : view === "archived"
                      ? t("보관된 알림이 없습니다", "No archived notifications")
                      : t("아직 받은 알림이 없습니다", "No notifications yet")}
                </h2>
                <p>
                  {t(
                    "선택한 유형의 새 소식이 여기에 표시됩니다.",
                    "Updates matching your selected type will appear here.",
                  )}
                </p>
              </Empty>
            ) : (
              <ul className="notification-list">
                {load.data.items.map((item) => (
                  <li
                    key={item.id}
                    className={
                      "notification-row " + (!item.read_at ? "is-unread" : "")
                    }
                  >
                    <Link
                      className="notification-open"
                      to={"/notifications/open/" + item.id}
                      onClick={(e) => openItem(e, item)}
                      aria-disabled={!!busy}
                    >
                      <NotificationIcon kind={item.kind} />
                      <NotificationText item={item} />
                      {!item.read_at && (
                        <span
                          className="unread-dot"
                          aria-label={t("안 읽음", "Unread")}
                        />
                      )}
                    </Link>
                    <div className="notification-actions">
                      <button
                        className="icon-button"
                        disabled={!!busy}
                        onClick={() =>
                          void mutate(item.id, { read: !item.read_at })
                        }
                        aria-label={
                          item.read_at
                            ? t("안 읽음으로 표시", "Mark as unread")
                            : t("읽음으로 표시", "Mark as read")
                        }
                        title={
                          item.read_at
                            ? t("안 읽음으로 표시", "Mark as unread")
                            : t("읽음으로 표시", "Mark as read")
                        }
                      >
                        {item.read_at ? (
                          <Circle size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        disabled={!!busy}
                        onClick={() =>
                          void mutate(item.id, { archived: !item.archived_at })
                        }
                        aria-label={
                          item.archived_at
                            ? t("알림함으로 복원", "Restore to inbox")
                            : t("보관", "Archive")
                        }
                        title={
                          item.archived_at
                            ? t("알림함으로 복원", "Restore to inbox")
                            : t("보관", "Archive")
                        }
                      >
                        {item.archived_at ? (
                          <ArchiveRestore size={16} />
                        ) : (
                          <Archive size={16} />
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Pagination
              page={page}
              total={load.data.total}
              onChange={onChangePage}
            />
          </>
        )}
      </State>
    </section>
  );
}

type Preferences = {
  scans: boolean;
  review_requests: boolean;
  review_results: boolean;
  review_updates: boolean;
  comments: boolean;
};

export function OpenNotification() {
  const { id } = useParams();
  const request = useNotificationApi(),
    navigate = useNavigate(),
    t = useText();
  const { refresh } = useNotifications();
  const [retry, setRetry] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    changeNotification(request, id!, { read: true })
      .then((item) => {
        if (!live) return;
        refresh();
        navigate(item.href, { replace: true });
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [id, request, navigate, refresh, retry]);
  return (
    <>
      <State loading={!error} error={error}>
        <></>
      </State>
      {error && (
        <button onClick={() => setRetry((v) => v + 1)}>
          {t("다시 시도", "Retry")}
        </button>
      )}
    </>
  );
}

function NotificationSettings() {
  const t = useText();
  const [reload, setReload] = useState(0);
  const load = useNotificationLoad<Preferences>(
    "/notification-preferences",
    reload,
  );
  return (
    <section className="notification-settings">
      <State {...load}>
        {load.data && <PreferenceForm initial={load.data} />}
      </State>
      {load.error && (
        <button onClick={() => setReload((v) => v + 1)}>
          {t("다시 시도", "Retry")}
        </button>
      )}
    </section>
  );
}

function PreferenceForm({ initial }: { initial: Preferences }) {
  const t = useText();
  const request = useNotificationApi();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const changes = Object.fromEntries(
        (Object.keys(value) as (keyof Preferences)[])
          .filter((key) => value[key] !== saved[key])
          .map((key) => [key, value[key]]),
      );
      const updated = await request<Preferences>("/notification-preferences", {
        method: "PUT",
        body: JSON.stringify(changes),
      });
      if (active.current) {
        setValue(updated);
        setSaved(updated);
        setMessage(
          t("알림 설정을 저장했습니다.", "Notification settings saved."),
        );
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const fields: [keyof Preferences, string, string][] = [
    [
      "scans",
      t("검사 소식", "Scan updates"),
      t(
        "내 검사 완료, 실패, 취소",
        "Completion, failure and cancellation of my scans",
      ),
    ],
    [
      "review_requests",
      t("검토 요청", "Review requests"),
      t(
        "검토 자격이 있을 때 새 요청 수신",
        "New requests while qualified as a reviewer",
      ),
    ],
    [
      "review_results",
      t("검토 결과", "Review results"),
      t(
        "내 검토 요청의 승인과 반려",
        "Approval and rejection of my review requests",
      ),
    ],
    [
      "review_updates",
      t("검토 진행 알림", "Review updates"),
      t(
        "담당 지정·해제, 보완 요청·응답, 철회",
        "Assignment, release, supplement requests, explanations and withdrawal",
      ),
    ],
    [
      "comments",
      t("코멘트", "Comments"),
      t(
        "내 검사 또는 내가 검토한 검사의 공개 코멘트",
        "Public comments on my scans or scans I reviewed",
      ),
    ],
  ];
  return (
    <form className="panel notification-preference-form" onSubmit={submit}>
      <div className="notification-settings-title">
        <Settings size={20} />
        <h2>{t("알림 수신 설정", "Notification settings")}</h2>
      </div>
      <p className="muted">
        {t(
          "설정은 계정에 저장되며 앞으로 생성되는 알림에 적용됩니다. 기존 알림은 유지됩니다.",
          "Saved to your account and applied to future notifications. Existing items are kept.",
        )}
      </p>
      {fields.map(([key, label, description]) => (
        <label className="notification-preference" key={key}>
          <span>
            <b>{label}</b>
            <small>{description}</small>
          </span>
          <input
            type="checkbox"
            checked={value[key]}
            disabled={busy}
            onChange={(e) => {
              setValue({ ...value, [key]: e.target.checked });
              setMessage("");
            }}
          />
        </label>
      ))}
      <ErrorMessage value={error} />
      {message && <p role="status">{message}</p>}
      <button
        className="primary"
        disabled={
          busy ||
          (Object.keys(value) as (keyof Preferences)[]).every(
            (k) => value[k] === saved[k],
          )
        }
      >
        {t("알림 설정 저장", "Save notification settings")}
      </button>
      <Link to="/settings">
        {t("사용자 설정으로 이동", "Go to user settings")} →
      </Link>
    </form>
  );
}
