import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorMessage, PageTitle, State, useLoad } from "../components";
import { useApp, useText } from "../context";

type Profile = {
  account_name: string;
  display_name: string | null;
  role: string;
  reviewer: boolean;
};

export function AccountSettings() {
  const t = useText(),
    [reload, setReload] = useState(0),
    load = useLoad<Profile>("/profile", reload);
  return (
    <>
      <PageTitle
        eyebrow="ACCOUNT"
        title={t("사용자 설정", "User settings")}
        description={t(
          "내 계정 정보와 서비스 표시 이름을 관리합니다.",
          "Manage your account information and display name.",
        )}
      />
      <State {...load}>
        {load.data && (
          <ProfileForm
            profile={load.data}
            onReload={() => setReload((value) => value + 1)}
          />
        )}
      </State>
    </>
  );
}

function ProfileForm({
  profile,
  onReload,
}: {
  profile: Profile;
  onReload: () => void;
}) {
  const t = useText(),
    { user, syncDisplayName, profileRevision } = useApp();
  const [acknowledgedRevision, setAcknowledgedRevision] =
    useState(profileRevision);
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const profileChanged = profileRevision !== acknowledgedRevision;
  const [name, setName] = useState(profile.display_name || "");
  const [savedName, setSavedName] = useState(profile.display_name);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function save(value: string | null) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api<Profile>("/profile", {
        method: "PUT",
        body: JSON.stringify({ display_name: value }),
      });
      syncDisplayName(user.id, !active.current);
      if (!active.current) return;
      setName(updated.display_name || "");
      setSavedName(updated.display_name);
      setAllowOverwrite(false);
      setMessage(t("변경 사항을 저장했습니다.", "Changes saved."));
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void save(name);
  }
  return (
    <div className="account-settings">
      <section className="panel form-panel">
        <h2>{t("계정 정보", "Account information")}</h2>
        <dl className="account-information">
          <div>
            <dt>{t("인증 계정", "Account")}</dt>
            <dd>{profile.account_name}</dd>
          </div>
          <div>
            <dt>{t("권한", "Access")}</dt>
            <dd>
              {profile.role}
              {profile.reviewer ? " · reviewer" : ""}
            </dd>
          </div>
        </dl>
        <p>
          {t(
            "인증 계정과 권한은 관리자가 관리합니다.",
            "Your account and permissions are managed by your administrator.",
          )}
        </p>
      </section>
      <section className="panel form-panel">
        <h2>{t("서비스 표시 이름", "Service display name")}</h2>
        <p>
          {t(
            "사이드바에 표시할 이름입니다. 로그인 계정과 감사 기록은 바뀌지 않습니다.",
            "Shown in the sidebar. Your sign-in identity and audit records do not change.",
          )}
        </p>
        <form onSubmit={submit}>
          {profileChanged && (
            <div className="notice" role="status">
              <p>
                {t(
                  "다른 저장이 완료되어 서버의 표시 이름이 바뀌었습니다. 최신 값을 불러오면 현재 입력은 지워집니다. 입력을 유지하면 저장 시 서버 값을 덮어씁니다.",
                  "Another save changed the server profile. Loading it discards your input; keeping your input overwrites the server value when saved.",
                )}
              </p>
              <button type="button" disabled={busy} onClick={onReload}>
                {t("최신 저장 값 불러오기", "Load latest saved value")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAcknowledgedRevision(profileRevision);
                  setAllowOverwrite(true);
                }}
              >
                {t("내 입력 유지하고 계속", "Keep my input")}
              </button>
            </div>
          )}
          <label>
            {t("표시 이름", "Display name")}
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setMessage("");
              }}
              placeholder={profile.account_name}
              maxLength={80}
              disabled={busy}
              required
            />
          </label>
          <ErrorMessage value={error} />
          {message && <p role="status">{message}</p>}
          <div className="toolbar">
            <button
              className="primary"
              disabled={
                busy ||
                profileChanged ||
                !name.trim() ||
                (!allowOverwrite && name.trim() === savedName)
              }
            >
              {t("변경 사항 저장", "Save changes")}
            </button>
            <button
              type="button"
              disabled={
                busy || profileChanged || (!savedName && !allowOverwrite)
              }
              onClick={() => void save(null)}
            >
              {t("기본 이름 사용", "Use account name")}
            </button>
          </div>
        </form>
      </section>
      <section className="panel form-panel">
        <h2>{t("화면과 연결", "Display and connections")}</h2>
        <p>
          {t(
            "테마, 색상, 언어는 왼쪽 아래 계정 메뉴의 화면 설정에서 바꿀 수 있으며 이 브라우저에 저장됩니다.",
            "Change theme, palette and language in the account menu. These preferences are stored in this browser.",
          )}
        </p>
        <Link to="/api-keys">
          {t("내 API 키 관리", "Manage my API keys")} →
        </Link>
      </section>
    </div>
  );
}
