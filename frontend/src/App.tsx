import { Suspense, lazy, useEffect, useState, type FormEvent } from "react";
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
} from "lucide-react";
import { api, send, type User } from "./api";
import { Brand, syncFavicon } from "./Brand";
import { AppContext } from "./context";
import { ErrorMessage, State } from "./components";
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
const Boards = lazy(() =>
  import("./pages/Boards").then((m) => ({ default: m.Boards })),
);
const PostDetail = lazy(() =>
  import("./pages/Boards").then((m) => ({ default: m.PostDetail })),
);

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
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
    Promise.all([api("/auth/config"), api<User>("/auth/me").catch(() => null)])
      .then(([c, u]) => {
        setConfig(c);
        setUser(u);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
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
  const refresh = async () => {
    setUser(await api<User>("/auth/me"));
    if (location.pathname === "/login") navigate("/");
  };
  if (loading || error)
    return (
      <State loading={loading} error={error}>
        <></>
      </State>
    );
  if (!user) return <Login mode={config?.mode} onLogin={refresh} />;
  return (
    <AppContext.Provider value={{ user, boards: config.boards_enabled, lang }}>
      <a href="#main-content" className="skip-link">
        {t("본문으로 이동", "Skip to content")}
      </a>
      <div className="app-shell">
        <aside className={"sidebar " + (open ? "open" : "")}>
          <Link to="/" className="brand-link" aria-label="Agent Admission Gate">
            <Brand />
          </Link>
          <Link className="primary new-scan" to="/new">
            <Plus size={17} />
            {t("새 검사 실행", "New scan")}
          </Link>
          <nav>
            <div className="nav-group-label">{t("검사", "INSPECT")}</div>
            <NavLink to="/" end>
              <LayoutDashboard size={17} />
              {t("대시보드", "Dashboard")}
            </NavLink>
            <NavLink to="/jobs">
              <ListChecks size={17} />
              {t("작업 목록", "Scans")}
            </NavLink>
            {user.reviewer && (
              <NavLink to="/reviews">
                <ShieldCheck size={17} />
                {t("검토", "Reviews")}
              </NavLink>
            )}
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
                <div className="nav-group-label">{t("소통", "COMMUNITY")}</div>
                <NavLink to="/boards">
                  <MessageSquare size={17} />
                  {t("공지사항 · VOC", "Notices · Feedback")}
                </NavLink>
              </>
            )}
            {user.role === "admin" && (
              <>
                <div className="nav-group-label">{t("관리", "MANAGE")}</div>
                <NavLink to="/admin">
                  <Settings size={17} />
                  {t("관리자", "Administration")}
                </NavLink>
              </>
            )}
          </nav>
          <footer className="sidebar-footer">
            <div className="user-line">
              <span className="avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <b>{user.name}</b>
                <small>
                  {user.role}
                  {user.reviewer ? " · reviewer" : ""}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={t("로그아웃", "Sign out")}
                onClick={async () => {
                  await send("/auth/logout", {});
                  setUser(null);
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
            <div className="preferences">
              <button
                className="icon-button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={t("테마 전환", "Toggle theme")}
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <select
                aria-label={t("색상 팔레트", "Color palette")}
                value={palette}
                onChange={(e) => setPalette(e.target.value)}
              >
                <option value="plum">Plum</option>
                <option value="teal">Teal</option>
                <option value="blue">Blue</option>
              </select>
              <button onClick={() => setLang(lang === "ko" ? "en" : "ko")}>
                {lang === "ko" ? "EN" : "한국어"}
              </button>
            </div>
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
            <Link to="/guide" aria-label={t("도움말", "Help")}>
              <CircleHelp size={17} />
            </Link>
          </div>
          <main id="main-content" tabIndex={-1}>
            <Suspense
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
                <Route path="/reviews" element={<Reviews />} />
                <Route path="/reviews/:id" element={<ReviewDetail />} />
                <Route path="/api-keys" element={<Keys />} />
                <Route path="/device-clients" element={<Devices />} />
                <Route path="/guide" element={<Guide />} />
                <Route path="/admin" element={<Admin />} />
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
    </AppContext.Provider>
  );
}
function Login({
  mode,
  onLogin,
}: {
  mode: string;
  onLogin: () => Promise<void>;
}) {
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
        <div className="eyebrow">EVIDENCE BEFORE ADMISSION</div>
        <h1>
          신뢰할 수 있는
          <br />
          에이전트의 시작.
        </h1>
        <p>
          소스와 위험을 확인하고, 근거를 남기고,
          <br />
          검증된 도구를 업무에 연결하세요.
        </p>
        <ErrorMessage value={error} />
        {mode === "oidc" ? (
          <a className="primary" href="/api/auth/oidc/login">
            SSO로 로그인
          </a>
        ) : (
          <form onSubmit={submit}>
            <label>
              사용자명
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              비밀번호
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "로그인 중…" : "로그인"}
            </button>
            <small>로컬 개발 계정 · 운영 환경은 SSO를 사용합니다.</small>
          </form>
        )}
        <div className="login-foot">
          Agent Admission Gate · Independent security tooling
        </div>
      </div>
      <div className="login-art" aria-hidden="true">
        <Brand compact />
        <span>Inspect. Understand. Admit.</span>
      </div>
    </div>
  );
}
