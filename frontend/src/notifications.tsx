import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  CheckCheck,
  CircleCheck,
  CircleX,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, APIError, timestamp } from "./api";
import { ErrorMessage, State } from "./components";
import { useApp, useText } from "./context";
import { sessionCoordinator } from "./session";

export type Notification = {
  id: string;
  kind: string;
  source: string;
  href: string;
  verdict: string | null;
  created_at: number;
  read_at: number | null;
  archived_at: number | null;
};
export type NotificationList = {
  items: Notification[];
  total: number;
  unread_count: number;
  snapshot_at: number;
  snapshot_sequence: number;
  filtered_unread_count: number;
};

type NotificationAPI = <T = any>(
  path: string,
  init?: RequestInit,
) => Promise<T>;
export function useNotificationApi(): NotificationAPI {
  const { user, reconcileSession } = useApp();
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const capture = sessionCoordinator.capture();
      try {
        return await api<T>(path, {
          ...init,
          headers: { ...init.headers, "X-AAG-Account": user.id },
        });
      } catch (e) {
        if (
          sessionCoordinator.isCurrent(capture) &&
          e instanceof APIError &&
          e.status === 409
        )
          reconcileSession(user.id);
        throw e;
      }
    },
    [user.id, reconcileSession],
  );
}

export function useNotificationLoad<T>(path: string, revision = 0) {
  const request = useNotificationApi();
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path, data: null, error: "", loading: true });
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    setState((previous) =>
      previous.path === path && previous.data
        ? { ...previous, error: "" }
        : { path, data: null, error: "", loading: true },
    );
    request<T>(path, { signal: abort.signal })
      .then((data) => {
        if (live) setState({ path, data, error: "", loading: false });
      })
      .catch((e) => {
        if (!live || (e instanceof DOMException && e.name === "AbortError"))
          return;
        const denied =
          e instanceof APIError && [401, 403, 404, 409].includes(e.status);
        setState((previous) => ({
          path,
          data: denied || previous.path !== path ? null : previous.data,
          error: (e as Error).message,
          loading: false,
        }));
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [path, revision, request]);
  return state.path === path
    ? state
    : { path, data: null, error: "", loading: true };
}

const NotificationContext = createContext({
  unread: null as number | null,
  revision: 0,
  error: "",
  refresh: () => {},
});
export const useNotifications = () => useContext(NotificationContext);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const request = useNotificationApi();
  const [unread, setUnread] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const runRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => runRef.current(), []);
  useEffect(() => {
    let live = true,
      sequence = 0;
    let abort: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    setUnread(null);
    const run = async () => {
      clearTimeout(timer);
      abort?.abort();
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      setRevision((v) => v + 1);
      const current = ++sequence;
      abort = new AbortController();
      try {
        const data = await request<{ unread_count: number }>(
          "/notifications/unread-count",
          { signal: abort.signal },
        );
        if (live && current === sequence) {
          setUnread(data.unread_count);
          setError("");
        }
      } catch (e) {
        if (
          live &&
          current === sequence &&
          !(e instanceof DOMException && e.name === "AbortError")
        ) {
          setUnread(null);
          setError((e as Error).message);
        }
      } finally {
        if (live && current === sequence) timer = setTimeout(run, 30000);
      }
    };
    const trigger = () => {
      void run();
    };
    runRef.current = trigger;
    trigger();
    window.addEventListener("focus", trigger);
    window.addEventListener("online", trigger);
    document.addEventListener("visibilitychange", trigger);
    return () => {
      live = false;
      sequence++;
      abort?.abort();
      clearTimeout(timer);
      runRef.current = () => {};
      window.removeEventListener("focus", trigger);
      window.removeEventListener("online", trigger);
      document.removeEventListener("visibilitychange", trigger);
    };
  }, [user.id, user.role, user.reviewer, request]);
  return (
    <NotificationContext.Provider value={{ unread, revision, error, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function notificationLabel(
  kind: string,
  t: (ko: string, en: string) => string,
) {
  const labels: Record<string, string> = {
    "scan.completed": t("검사가 완료되었습니다", "Scan completed"),
    "scan.failed": t("검사를 완료하지 못했습니다", "Scan failed"),
    "scan.cancelled": t("검사가 취소되었습니다", "Scan cancelled"),
    "review.requested": t("새 검토 요청이 있습니다", "Review requested"),
    "review.approved": t("검토가 승인되었습니다", "Review approved"),
    "review.rejected": t("검토가 반려되었습니다", "Review rejected"),
    "review.claimed": t("검토 담당자가 지정되었습니다", "Review assigned"),
    "review.released": t(
      "검토 담당자가 해제되었습니다",
      "Review assignment released",
    ),
    "review.changes_requested": t(
      "보완 요청이 있습니다",
      "Supplement requested",
    ),
    "review.responded": t("설명이 보충되었습니다", "Explanation added"),
    "review.withdrawn": t("검토 요청이 철회되었습니다", "Review withdrawn"),
    "comment.created": t("새 코멘트가 등록되었습니다", "New comment"),
  };
  return labels[kind] || t("새 알림", "New notification");
}

export function NotificationIcon({ kind }: { kind: string }) {
  const Icon = kind.startsWith("review.")
    ? ShieldCheck
    : kind.startsWith("comment.")
      ? MessageSquare
      : kind === "scan.completed"
        ? CircleCheck
        : CircleX;
  return (
    <span
      className={
        "notification-icon " +
        (kind === "scan.failed" ? "notification-failed" : "")
      }
    >
      <Icon size={19} aria-hidden="true" />
    </span>
  );
}

export function NotificationText({ item }: { item: Notification }) {
  const t = useText();
  return (
    <span className="notification-copy">
      <strong>{notificationLabel(item.kind, t)}</strong>
      <span className="notification-source">{item.source}</span>
      <small>
        <time dateTime={new Date(item.created_at * 1000).toISOString()}>
          {timestamp(item.created_at)}
        </time>
        {item.verdict && <> · {item.verdict}</>}
      </small>
    </span>
  );
}

export const changeNotification = (
  request: NotificationAPI,
  id: string,
  changes: { read?: boolean; archived?: boolean },
) =>
  request<Notification>("/notifications/" + id, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });

export function NotificationBell() {
  const t = useText(),
    { unread, error, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);
  const label =
    unread === null
      ? t("알림함", "Notifications")
      : t(
          `알림함, 안 읽은 알림 ${unread}개`,
          `Notifications, ${unread} unread`,
        );
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        className="icon-button notification-bell"
        aria-label={label}
        title={
          error
            ? t(
                "알림 개수를 갱신하지 못했습니다. 알림함에서 다시 시도하세요.",
                "Could not refresh the count. Open notifications to retry.",
              )
            : label
        }
      >
        <Bell size={19} aria-hidden="true" />
        {unread !== null && unread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        {error && (
          <span className="notification-count" aria-hidden="true">
            !
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="notification-menu"
          align="end"
          sideOffset={12}
          collisionPadding={12}
          aria-label={t("최근 알림", "Recent notifications")}
          aria-labelledby={undefined}
        >
          <div className="notification-menu-heading">
            <b>{t("알림함", "Notifications")}</b>
            <span>{t("최근 90일", "Last 90 days")}</span>
          </div>
          <NotificationPreview onClose={() => setOpen(false)} />
          <DropdownMenu.Separator className="account-separator" />
          <DropdownMenu.Item className="notification-menu-footer" asChild>
            <Link to="/notifications" onClick={refresh}>
              {t("전체 알림 보기", "View all notifications")} →
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function NotificationPreview({ onClose }: { onClose: () => void }) {
  const t = useText(),
    navigate = useNavigate(),
    { revision, refresh } = useNotifications();
  const [reload, setReload] = useState(0);
  const request = useNotificationApi();
  const load = useNotificationLoad<NotificationList>(
    "/notifications?page_size=5",
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
  async function openItem(item: Notification) {
    setBusy(item.id);
    setError("");
    try {
      if (!item.read_at)
        await changeNotification(request, item.id, { read: true });
      refresh();
      if (!active.current) return;
      onClose();
      navigate(item.href);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy("");
    }
  }
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ErrorMessage value={load.error} />
      <State loading={load.loading}>
        {load.data?.items.length === 0 && (
          <div className="notification-preview-empty">
            <CheckCheck size={22} />
            <p>{t("아직 받은 알림이 없습니다", "No notifications yet")}</p>
          </div>
        )}
        {load.data?.items.map((item) => (
          <DropdownMenu.Item
            key={item.id}
            className={
              "notification-preview-item " + (!item.read_at ? "is-unread" : "")
            }
            disabled={!!busy}
            onSelect={(e) => {
              e.preventDefault();
              void openItem(item);
            }}
          >
            <NotificationIcon kind={item.kind} />
            <NotificationText item={item} />
            {!item.read_at && (
              <span
                className="unread-dot"
                aria-label={t("안 읽음", "Unread")}
              />
            )}
          </DropdownMenu.Item>
        ))}
      </State>
      {load.error && (
        <DropdownMenu.Item
          className="notification-menu-footer"
          onSelect={(e) => {
            e.preventDefault();
            setReload((v) => v + 1);
            refresh();
          }}
        >
          {t("다시 시도", "Retry")}
        </DropdownMenu.Item>
      )}
    </>
  );
}
