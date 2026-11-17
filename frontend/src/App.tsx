import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  BookOpen,
  CircleHelp,
  ClipboardList,
  ChevronsUpDown,
  ChevronRight,
  Info,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  Unplug,
  UserRound,
} from "lucide-react";
import { api, APIError, send, sendAsAccount, type User } from "./api";
import { Brand, syncFavicon } from "./Brand";
import { sessionCoordinator, publishAccountObservation } from "./session";
import {
  clearAccountDrafts,
  clearOtherAccountDrafts,
  clearInternalCommentDrafts,
} from "./drafts";
import { normalizeReturnTo } from "./returnPaths";
import { AppContext } from "./context";
import { ErrorMessage, State } from "./components";
import { Landing } from "./pages/Landing";
import { NotificationBell, NotificationProvider } from "./notifications";
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Jobs = lazy(() =>
  import("./pages/Scans").then((m) => ({ default: m.Jobs })),
);
const NewScan = lazy(() =>
  import("./pages/Scans").then((m) => ({ default: m.NewScan })),
);
const JobDetail = lazy(() =>
  import("./pages/Scans").then((m) => ({ default: m.JobDetail })),
);
const ScanSummary = lazy(() =>
  import("./pages/ScanSummary").then((m) => ({ default: m.ScanSummary })),
);
const Reviews = lazy(() =>
  import("./pages/Reviews").then((m) => ({ default: m.Reviews })),
);
const ReviewDetail = lazy(() =>
  import("./pages/Reviews").then((m) => ({ default: m.ReviewDetail })),
);
const Keys = lazy(() =>
  import("./pages/Integrations").then((m) => ({ default: m.Keys })),
);
const Devices = lazy(() =>
  import("./pages/Integrations").then((m) => ({ default: m.Devices })),
);
const Guide = lazy(() =>
  import("./pages/Integrations").then((m) => ({ default: m.Guide })),
);
const Admin = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Admin })),
);
const Coverage = lazy(() =>
  import("./pages/Coverage").then((m) => ({ default: m.Coverage })),
);
const Boards = lazy(() =>
  import("./pages/Boards").then((m) => ({ default: m.Boards })),
);
const PostDetail = lazy(() =>
  import("./pages/Boards").then((m) => ({ default: m.PostDetail })),
);
const AccountSettings = lazy(() =>
  import("./pages/AccountSettings").then((m) => ({
    default: m.AccountSettings,
  })),
);
const Notifications = lazy(() =>
  import("./pages/Notifications").then((m) => ({ default: m.Notifications })),
);
const OpenNotification = lazy(() =>
  import("./pages/Notifications").then((m) => ({
    default: m.OpenNotification,
  })),
);

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const clearDraftsFor = (account: string) => {
    try {
      clearAccountDrafts(account);
    } catch {
      setDraftStorageError(true);
    }
  };
  const acceptDraftAccount = (account: User) => {
    try {
      clearOtherAccountDrafts(account.id);
      if (!account.reviewer && account.role !== "admin")
        clearInternalCommentDrafts(account.id);
    } catch {
      setDraftStorageError(true);
    }
  };
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const profileGeneration = useRef(0);
  const currentUserId = useRef<string | null>(null);
  const sessionGeneration = useRef(0);
  currentUserId.current = user?.id || null;
  const reconcileSession = useCallback((ownerId?: string) => {
    if (ownerId && currentUserId.current !== ownerId) return;
    const generation = ++sessionGeneration.current;
    sessionCoordinator.invalidate();
    setUser(null);
    setLoading(true);
    setError("");
    Promise.all([
      api("/auth/config"),
      api<User>("/auth/me").catch((e) => {
        if (e instanceof APIError && e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([config, current]) => {
        if (sessionGeneration.current !== generation) return;
        setConfig(config);
        if (current) acceptDraftAccount(current);
        sessionCoordinator.setAccount(current?.id ?? null);
        // An unauthenticated read may be expiry. Only explicit logout publishes null.
        if (current) publishAccountObservation(current.id);
        setUser(current);
      })
      .catch((e) => {
        if (sessionGeneration.current === generation)
          setError((e as Error).message);
      })
      .finally(() => {
        if (sessionGeneration.current === generation) setLoading(false);
      });
  }, []);
  useEffect(
    () =>
      sessionCoordinator.subscribe(() => {
        sessionGeneration.current++;
        sessionCoordinator.setAccount(null);
        setUser(null);
        setSessionExpired(true);
        setLoading(false);
      }),
    [],
  );
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "aag-auth-change") {
        const observed = localStorage.getItem("aag-auth-observed-account");
        try {
          clearOtherAccountDrafts(observed ?? "");
        } catch {
          setDraftStorageError(true);
        }
        reconcileSession();
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [reconcileSession]);
  const [profileRevision, setProfileRevision] = useState(0);
  const syncDisplayName = (ownerId: string, refreshPage: boolean) => {
    if (currentUserId.current !== ownerId) return;
    const generation = ++profileGeneration.current;
    api<{ display_name: string | null }>("/profile")
      .then((profile) => {
        if (
          profileGeneration.current !== generation ||
          currentUserId.current !== ownerId
        )
          return;
        setDisplayNameState(profile.display_name);
        if (refreshPage) setProfileRevision((value) => value + 1);
      })
      .catch(() => {});
  };
  const [theme, setTheme] = useState(
      localStorage.getItem("aag-theme") || "dark",
    ),
    [palette, setPalette] = useState(
      localStorage.getItem("aag-palette") || "plum",
    ),
    [lang, setLang] = useState(localStorage.getItem("aag-lang") || "ko"),
    [open, setOpen] = useState(false);
  const location = useLocation(),
    navigate = useNavigate(),
    t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  useEffect(() => {
    reconcileSession();
  }, [reconcileSession]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
    document.documentElement.lang = lang;
    localStorage.setItem("aag-theme", theme);
    localStorage.setItem("aag-palette", palette);
    localStorage.setItem("aag-lang", lang);
    requestAnimationFrame(syncFavicon);
  }, [theme, palette, lang]);
  useEffect(() => {
    setOpen(false);
    document.getElementById("main-content")?.focus();
  }, [location.pathname]);
  useEffect(() => {
    const generation = ++profileGeneration.current;
    setDisplayNameState(null);
    if (user) {
      api<{ display_name: string | null }>("/profile")
        .then((profile) => {
          if (profileGeneration.current === generation)
            setDisplayNameState(profile.display_name);
        })
        .catch(() => {});
    }
    return () => {
      profileGeneration.current++;
    };
  }, [user?.id]);
  const returnTo = normalizeReturnTo(
    location.pathname === "/login"
      ? new URLSearchParams(location.search).get("return_to")
      : location.pathname + location.search,
  );
  const refresh = async () => {
    const current = await api<User>("/auth/me");
    sessionGeneration.current++;
    acceptDraftAccount(current);
    sessionCoordinator.invalidate();
    sessionCoordinator.setAccount(current.id);
    setSessionExpired(false);
    setUser(current);
    publishAccountObservation(current.id);
    navigate(returnTo, { replace: true });
  };
  if (loading || error)
    return (
      <State loading={loading} error={error}>
        <></>
      </State>
    );
  if (!user)
    return !sessionExpired &&
      (location.pathname === "/" || location.pathname === "/about") ? (
      <Landing mode={config?.mode ?? "oidc"} />
    ) : (
      <Login
        mode={config?.mode}
        onLogin={refresh}
        returnTo={returnTo}
        expired={sessionExpired}
        lang={lang}
      />
    );
  return (
    <AppContext.Provider
      value={{
        user,
        boards: config.boards_enabled,
        reviewWorkflow: config.review_workflow_enabled,
        apiKeysState: config.api_keys_state ?? "disabled",
        lang,
        syncDisplayName,
        profileRevision,
        reconcileSession,
      }}
    >
      <NotificationProvider key={user.id}>
        <a href="#main-content" className="skip-link">
          {t("본문으로 이동", "Skip to content")}
        </a>
        <div className="app-shell">
          <aside className={"sidebar " + (open ? "open" : "")}>
            <Link
              to="/"
              className="brand-link"
              aria-label="Agent Admission Gate"
            >
              <Brand />
            </Link>
            <Link className="primary new-scan" to="/new">
              <Plus size={17} />
              {t("새 검사 실행", "New scan")}
            </Link>
            <nav aria-label={t("주 탐색", "Main navigation")}>
              <div className="nav-group-label">{t("검사", "INSPECT")}</div>
              <NavLink to="/" end>
                <LayoutDashboard size={17} />
                {t("대시보드", "Dashboard")}
              </NavLink>
              <NavLink to="/jobs">
                <ListChecks size={17} />
                {t("작업 목록", "Scans")}
              </NavLink>
              <NavLink to="/reviews">
                <ShieldCheck size={17} />
                {t("검토", "Reviews")}
              </NavLink>
              <div className="nav-group-label">{t("연동", "CONNECT")}</div>
              <NavLink to="/guide">
                <BookOpen size={17} />
                {t("API · MCP 가이드", "API · MCP guide")}
              </NavLink>
              <NavLink to="/api-keys">
                <KeyRound size={17} />
                {t("API 키", "API keys")}
              </NavLink>
              <NavLink to="/device-clients">
                <Unplug size={17} />
                {t("도구 연결 등록", "Connect tools")}
              </NavLink>
              {config.boards_enabled && (
                <>
                  <div className="nav-group-label">
                    {t("소통", "COMMUNITY")}
                  </div>
                  <NavLink to="/boards">
                    <MessageSquare size={17} />
                    {t("공지사항 · VOC", "Notices · Feedback")}
                  </NavLink>
                </>
              )}
              <div className="nav-group-label">{t("서비스", "SERVICE")}</div>
              <NavLink to="/about">
                <Info size={17} />
                {t("서비스 소개", "About")}
              </NavLink>
              {user.role === "admin" && (
                <>
                  <div className="nav-group-label">{t("관리", "MANAGE")}</div>
                  <NavLink to="/admin">
                    <Settings size={17} />
                    {t("관리자", "Administration")}
                  </NavLink>
                  <NavLink to="/coverage">
                    <ClipboardList size={17} />
                    {t("요구사항 · 검증", "Coverage · evidence")}
                  </NavLink>
                </>
              )}
            </nav>
            <footer className="sidebar-footer">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  className="user-line account-trigger"
                  aria-label={t(
                    `계정 메뉴: ${displayName || user.name}`,
                    `Account menu: ${displayName || user.name}`,
                  )}
                >
                  <span className="avatar">
                    {(displayName || user.name).slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <b>{displayName || user.name}</b>
                    <small>
                      {user.role}
                      {user.reviewer ? " · reviewer" : ""}
                    </small>
                  </span>
                  <ChevronsUpDown size={16} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="account-menu"
                    side="top"
                    align="start"
                    sideOffset={8}
                  >
                    <DropdownMenu.Label className="account-label">
                      {displayName || user.name}{" "}
                      <small>
                        {user.role}
                        {user.reviewer ? " · reviewer" : ""}
                      </small>
                    </DropdownMenu.Label>
                    <DropdownMenu.Separator className="account-separator" />
                    <DropdownMenu.Item
                      className="account-item"
                      onSelect={() =>
                        setTheme(theme === "dark" ? "light" : "dark")
                      }
                    >
                      {theme === "dark" ? (
                        <Sun size={16} />
                      ) : (
                        <Moon size={16} />
                      )}
                      {theme === "dark"
                        ? t("라이트 모드", "Light mode")
                        : t("다크 모드", "Dark mode")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="account-item" asChild>
                      <Link to="/settings">
                        <UserRound size={16} />
                        {t("사용자 설정", "User settings")}
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Sub>
                      <DropdownMenu.SubTrigger className="account-item">
                        <Settings size={16} />
                        {t("화면 설정", "Display settings")}
                        <ChevronRight size={15} className="account-arrow" />
                      </DropdownMenu.SubTrigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.SubContent
                          className="account-menu account-submenu"
                          sideOffset={6}
                        >
                          <DropdownMenu.Label className="account-label">
                            {t("색상 팔레트", "Color palette")}
                          </DropdownMenu.Label>
                          <DropdownMenu.RadioGroup
                            value={palette}
                            onValueChange={setPalette}
                          >
                            {["plum", "teal", "blue"].map((p) => (
                              <DropdownMenu.RadioItem
                                key={p}
                                value={p}
                                className="account-item"
                              >
                                <DropdownMenu.ItemIndicator>
                                  ✓
                                </DropdownMenu.ItemIndicator>
                                {p[0].toUpperCase() + p.slice(1)}
                              </DropdownMenu.RadioItem>
                            ))}
                          </DropdownMenu.RadioGroup>
                          <DropdownMenu.Separator className="account-separator" />
                          <DropdownMenu.Item
                            className="account-item"
                            onSelect={() =>
                              setLang(lang === "ko" ? "en" : "ko")
                            }
                          >
                            {lang === "ko" ? "English" : "한국어"}
                          </DropdownMenu.Item>
                        </DropdownMenu.SubContent>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Sub>
                    <DropdownMenu.Separator className="account-separator" />
                    <DropdownMenu.Item
                      className="account-item"
                      onSelect={async () => {
                        await sendAsAccount("/auth/logout", {}, user.id);
                        clearDraftsFor(user.id);
                        sessionCoordinator.setAccount(null);
                        setSessionExpired(false);
                        setUser(null);
                        sessionGeneration.current++;
                        publishAccountObservation(null);
                      }}
                    >
                      <LogOut size={16} />
                      {t("로그아웃", "Sign out")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </footer>
          </aside>
          <div className="workspace">
            <div className="topbar">
              <button
                className="mobile-toggle icon-button"
                aria-label={t("메뉴", "Menu")}
                onClick={() => setOpen(!open)}
              >
                <Menu size={20} />
              </button>
              <span className="breadcrumb">
                Workspace <span>/</span> Agent Admission Gate
              </span>
              <span className="environment">
                <span className="dot" />
                {config.environment}
              </span>
              <NotificationBell />
              <Link to="/guide" aria-label={t("도움말", "Help")}>
                <CircleHelp size={17} />
              </Link>
            </div>
            <main id="main-content" tabIndex={-1}>
              {draftStorageError && (
                <div className="error" role="alert">
                  {t(
                    "이 탭의 초안 저장소에 접근할 수 없습니다. 작성 내용을 따로 보관하세요.",
                    "Draft storage is unavailable in this tab. Keep a separate copy of your input.",
                  )}
                </div>
              )}
              <Suspense
                key={location.pathname}
                fallback={
                  <State loading>
                    <></>
                  </State>
                }
              >
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/new" element={<NewScan />} />
                  <Route path="/jobs" element={<Jobs />} />
                  <Route path="/jobs/:id" element={<JobDetail />} />
                  <Route path="/jobs/:id/summary" element={<ScanSummary />} />
                  <Route path="/reviews" element={<Reviews />} />
                  <Route path="/reviews/:id" element={<ReviewDetail />} />
                  <Route path="/api-keys" element={<Keys />} />
                  <Route path="/device-clients" element={<Devices />} />
                  <Route path="/guide" element={<Guide />} />
                  <Route path="/settings" element={<AccountSettings />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route
                    path="/notifications/open/:id"
                    element={<OpenNotification />}
                  />
                  <Route
                    path="/admin"
                    element={
                      user.role === "admin" ? (
                        <Admin />
                      ) : (
                        <div role="alert">403</div>
                      )
                    }
                  />
                  <Route
                    path="/coverage"
                    element={
                      user.role === "admin" ? (
                        <Coverage />
                      ) : (
                        <div role="alert">403</div>
                      )
                    }
                  />
                  <Route
                    path="/about"
                    element={
                      <Landing mode={config?.mode ?? "oidc"} authenticated />
                    }
                  />
                  {config.boards_enabled && (
                    <>
                      <Route path="/boards" element={<Boards />} />
                      <Route path="/boards/:id" element={<PostDetail />} />
                    </>
                  )}
                  <Route
                    path="*"
                    element={
                      <div className="empty">
                        <h1>404</h1>
                        <p>
                          {t("페이지를 찾을 수 없습니다.", "Page not found.")}
                        </p>
                        <Link to="/">
                          {t("대시보드로 이동", "Back to dashboard")}
                        </Link>
                      </div>
                    }
                  />
                </Routes>
              </Suspense>
            </main>
          </div>
        </div>
      </NotificationProvider>
    </AppContext.Provider>
  );
}
function Login({
  mode,
  onLogin,
  returnTo,
  expired,
  lang,
}: {
  mode: string;
  returnTo: string;
  expired: boolean;
  lang: string;
  onLogin: () => Promise<void>;
}) {
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await send("/auth/login", {
        username: form.get("username"),
        password: form.get("password"),
      });
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-panel">
        <Brand />
        <h1>{t("로그인", "Sign in")}</h1>
        <p>
          {t(
            "인증 후 요청한 화면으로 돌아갑니다.",
            "Return to the requested page after signing in.",
          )}
        </p>
        {expired && (
          <div className="notice" role="alert">
            {t(
              "세션이 만료되었습니다. 다시 로그인하세요. 제출은 자동으로 재시도되지 않습니다.",
              "Your session expired. Sign in again. Submissions are not retried automatically.",
            )}
          </div>
        )}
        <ErrorMessage value={error} />
        {mode === "oidc" ? (
          <a
            className="primary"
            href={
              "/api/auth/oidc/login?return_to=" + encodeURIComponent(returnTo)
            }
            onClick={() => sessionCoordinator.flush()}
          >
            {t("SSO로 로그인", "Sign in with SSO")}
          </a>
        ) : (
          <form onSubmit={submit}>
            <label>
              {t("사용자명", "Username")}
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              {t("비밀번호", "Password")}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? t("로그인 중…", "Signing in…") : t("로그인", "Sign in")}
            </button>
            <small>
              {t(
                "로컬 개발 계정 · 운영 환경은 SSO를 사용합니다.",
                "Local development account. Production uses SSO.",
              )}
            </small>
          </form>
        )}
      </div>
      <div className="login-art" aria-hidden="true">
        <Brand compact />
      </div>
    </div>
  );
}
