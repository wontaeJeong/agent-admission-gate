import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageTitle } from "../components";
import { useText } from "../context";
import "./coverage.css";
type Area = "검사" | "검토·권한" | "연동" | "운영" | "UI";
type Item = {
  area: Area;
  name: string;
  link: string;
  evidence: string;
  acceptance: string;
};
/** Traceability UI: none of these entries claim production acceptance passed. */
export const coverageItems: Item[] = [
  [
    "검사",
    "Git/ZIP static/full 검사",
    "/new",
    "소스·스캐너 어댑터와 정책 테스트",
    "실제 검사기 버전 및 Git 네트워크 확인",
  ],
  [
    "검사",
    "엔진 누락·취소·캐시 처리",
    "/jobs",
    "검사 서비스 회귀 테스트",
    "동시성·재시작·운영 데이터 시험",
  ],
  [
    "검토·권한",
    "Reviewer 자격·자기승인 방지",
    "/reviews",
    "권한 및 검토 백엔드 테스트",
    "사내 SSO 그룹·철회 시험",
  ],
  [
    "검토·권한",
    "근거·조치·감사 이력",
    "/reviews",
    "검토·감사 API",
    "보관·삭제·운영 무결성 정책",
  ],
  [
    "연동",
    "API 키 발급·폐기",
    "/api-keys",
    "키 해시·만료·scope",
    "운영 secret 관리·실 클라이언트 시험",
  ],
  [
    "연동",
    "Device Code / MCP / CLI",
    "/device-clients",
    "승인·poll·교환 계약 테스트",
    "실 IDE·온프렘 연결 검증",
  ],
  [
    "운영",
    "모델별 토큰·결측·CSV",
    "/",
    "서버 Usage 집계",
    "Bedrock/온프렘/SystemOne 실계정 확인",
  ],
  [
    "운영",
    "7/14/30/90일 역할별 추이",
    "/",
    "실측 지표·Recharts",
    "대량 데이터·업무 정의 승인",
  ],
  [
    "운영",
    "STG/PROD·migration·복구",
    "/admin",
    "Kustomize·Alembic",
    "실 클러스터 백업·복원 인수",
  ],
  [
    "UI",
    "Plum 테마·라이트/다크·반응형",
    "/about",
    "테마 대비 및 FE 검증",
    "키보드·모바일 브라우저 인수",
  ],
  [
    "UI",
    "공지/VOC/내부 검토",
    "/boards",
    "기능 플래그·게시판 API",
    "운영 승인 전 기본 비활성",
  ],
].map(([area, name, link, evidence, acceptance]) => ({
  area: area as Area,
  name,
  link,
  evidence,
  acceptance,
}));
export function Coverage() {
  const t = useText();
  const [filter, setFilter] = useState("전체"),
    [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      coverageItems.filter(
        (x) =>
          (filter === "전체" || x.area === filter) &&
          Object.values(x)
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
      ),
    [filter, query],
  );
  return (
    <>
      <PageTitle
        eyebrow="OPERATIONS / EVIDENCE"
        title={t("요구사항 · 검증 경계", "Feature coverage · acceptance")}
        description={t(
          "구현 근거와 별도 운영 인수를 구분합니다. 이 표는 사내 운영 승인 결과가 아닙니다.",
          "Traceability is not production sign-off.",
        )}
      />
      <div className="coverage-summary">
        <strong>{coverageItems.length}</strong>
        <div>
          <b>{t("대표 점검 영역", "Tracked areas")}</b>
          <p>
            {t(
              "모든 항목에 별도 운영 인수 조건이 있습니다. 미실행 검증을 통과로 표시하지 않습니다.",
              "Unrun acceptance checks are never shown as passed.",
            )}
          </p>
        </div>
      </div>
      <section className="panel coverage-panel">
        <h2>{t("기능별 근거", "Evidence by feature")}</h2>
        <div className="coverage-filter">
          <label>
            {t("분류", "Area")}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option>전체</option>
              {["검사", "검토·권한", "연동", "운영", "UI"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            {t("검색", "Search")}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("항목·인수 조건", "Search acceptance")}
            />
          </label>
        </div>
        {visible.length === 0 ? (
          <Empty>{t("결과가 없습니다.", "No matching requirement.")}</Empty>
        ) : (
          <div
            tabIndex={0}
            role="region"
            className="coverage-scroll"
            aria-label={t(
              "요구사항 표 · 가로 스크롤 가능",
              "Feature table, horizontal scroll",
            )}
          >
            <table className="coverage-table">
              <caption>
                {t(
                  "대표 요구사항과 운영 검증 경계",
                  "Representative requirements and acceptance boundaries",
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("기능", "Feature")}</th>
                  <th scope="col">{t("구현 근거", "Evidence")}</th>
                  <th scope="col">{t("별도 인수", "Required acceptance")}</th>
                  <th scope="col">{t("화면", "Page")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((x) => (
                  <tr key={x.name}>
                    <th scope="row">
                      <small>{x.area}</small>
                      <strong>{x.name}</strong>
                    </th>
                    <td>{x.evidence}</td>
                    <td>{x.acceptance}</td>
                    <td>
                      <Link to={x.link}>{t("열기", "Open")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
