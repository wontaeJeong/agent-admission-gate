import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  FileCheck2,
  ListFilter,
  ShieldAlert,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApp, useText } from "../context";
import { Badge, Empty, PageTitle, State, Tabs, useLoad } from "../components";
import { number } from "../api";

export function Dashboard() {
  const { user } = useApp(),
    t = useText();
  const [days, setDays] = useState(30),
    [scope, setScope] = useState(
      user.role === "admin" ? "all" : user.reviewer ? "review" : "personal",
    ),
    [tab, setTab] = useState("attention");
  const load = useLoad(`/metrics?days=${days}&scope=${scope}`),
    data = load.data;
  return (
    <>
      <PageTitle
        eyebrow="OVERVIEW"
        title={t("검사 현황", "Admission overview")}
        description={t(
          "반입 결정에 필요한 근거와 조치 사항을 한곳에서 확인하세요.",
          "Evidence and next actions for every admission decision.",
        )}
        actions={
          <>
            <select
              aria-label={t("조회 범위", "Scope")}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="personal">{t("내 사용량", "My activity")}</option>
              {user.reviewer && (
                <option value="review">{t("검토 업무", "Review queue")}</option>
              )}
              {user.role === "admin" && (
                <option value="all">{t("전체 운영", "All activity")}</option>
              )}
            </select>
            <div
              className="segmented"
              aria-label={t("조회 기간", "Date range")}
            >
              {[7, 14, 30, 90].map((d) => (
                <button
                  key={d}
                  aria-pressed={days === d}
                  className={d === days ? "active" : ""}
                  onClick={() => setDays(d)}
                >
                  {d}
                  {t("일", "d")}
                </button>
              ))}
            </div>
          </>
        }
      />
      <State {...load}>
        {data && (
          <>
            <div className="stats-grid">
              {[
                [
                  FileCheck2,
                  t("전체 검사", "Scans"),
                  data.total_scans,
                  t("선택 기간 내 요청", "Requests in period"),
                ],
                [
                  ShieldAlert,
                  t("검토 대기", "Pending reviews"),
                  data.pending_reviews,
                  t("사람의 판단이 필요합니다", "Awaiting a human decision"),
                ],
                [
                  Activity,
                  t("API 요청", "API requests"),
                  data.api.requests,
                  t("REST · MCP 합계", "REST · MCP requests"),
                ],
                [
                  ListFilter,
                  t("차단 판정", "Blocked"),
                  data.distribution.BLOCK || 0,
                  t("최종 판정 기준", "Effective verdict"),
                ],
              ].map(([Icon, label, count, detail], i) => {
                const Glyph = Icon as typeof Activity;
                return (
                  <div className="stat" key={i}>
                    <div>
                      <span>{String(label)}</span>
                      <Glyph size={17} />
                    </div>
                    <strong>{number(count as number)}</strong>
                    <small>{String(detail)}</small>
                  </div>
                );
              })}
            </div>
            <div className="dashboard-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>{t("검사 추이", "Scan activity")}</h2>
                    <p>{t("기간별 요청 건수", "Daily requests")} · UTC</p>
                  </div>
                  <span className="legend">
                    <i />
                    {t("검사", "Scans")}
                  </span>
                </div>
                {data.total_scans ? (
                  <div className="chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={data.series}
                        margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="scanFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="var(--color-accent)"
                              stopOpacity={0.22}
                            />
                            <stop
                              offset="100%"
                              stopColor="var(--color-accent)"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--color-line)"
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v) => v.slice(5)}
                          minTickGap={40}
                          tick={{
                            fill: "var(--color-ink-muted)",
                            fontSize: 11,
                          }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{
                            fill: "var(--color-ink-muted)",
                            fontSize: 11,
                          }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-raised)",
                            border: "1px solid var(--color-line)",
                            color: "var(--color-ink)",
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="scans"
                          stroke="var(--color-accent)"
                          strokeWidth={2}
                          fill="url(#scanFill)"
                          name={t("검사", "Scans")}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty>
                    {t(
                      "첫 검사를 실행하면 추이가 표시됩니다.",
                      "Run your first scan to see activity.",
                    )}
                  </Empty>
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>{t("판정 분포", "Verdict distribution")}</h2>
                </div>
                <div className="verdict-list">
                  {["ALLOW", "REVIEW", "BLOCK"].map((v) => (
                    <div key={v}>
                      <div>
                        <Badge value={v} />
                        <strong>{data.distribution[v] || 0}</strong>
                      </div>
                      <div className={"meter " + v.toLowerCase()}>
                        <span
                          style={{
                            width: `${(100 * (data.distribution[v] || 0)) / Math.max(1, data.total_scans)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="panel-note">
                  {t(
                    "실패·취소된 검사는 정상 통과에 포함하지 않습니다.",
                    "Failed and cancelled scans are never counted as allowed.",
                  )}
                </div>
              </section>
            </div>
            <Tabs
              values={[
                ["attention", t("조치 필요", "Needs attention")],
                ["distribution", t("사용량 · 분포", "Usage & distribution")],
                ["recent", t("최근 검사", "Recent scans")],
              ]}
              selected={tab}
              onChange={setTab}
            />
            {tab === "attention" && (
              <div className="attention-list">
                <Link to="/reviews?tab=pending">
                  <span className="attention-icon">
                    <ShieldAlert size={20} />
                  </span>
                  <div>
                    <h3>
                      {data.pending_reviews}{" "}
                      {t(
                        "건의 검토가 대기 중입니다",
                        "reviews awaiting decision",
                      )}
                    </h3>
                    <p>
                      {data.oldest_review_seconds
                        ? `${t("최장 대기", "Oldest")} · ${number(data.oldest_review_seconds / 3600)}h`
                        : t(
                            "대기 중인 요청이 없습니다.",
                            "Your review queue is clear.",
                          )}
                    </p>
                  </div>
                  <ArrowUpRight size={18} />
                </Link>
                <Link to="/jobs?status=FAILED">
                  <span className="attention-icon neutral">
                    <Activity size={20} />
                  </span>
                  <div>
                    <h3>
                      {data.statuses.FAILED || 0}{" "}
                      {t("건의 검사 실행 실패", "failed scan executions")}
                    </h3>
                    <p>
                      {t(
                        "엔진 설정과 실패 사유를 확인하세요.",
                        "Inspect engine configuration and failure reasons.",
                      )}
                    </p>
                  </div>
                  <ArrowUpRight size={18} />
                </Link>
              </div>
            )}
            {(tab === "recent" || tab === "attention") && (
              <section className="panel recent">
                <div className="panel-heading">
                  <h2>{t("최근 검사", "Recent scans")}</h2>
                  <Link to="/jobs">{t("전체 보기", "View all")} ↗</Link>
                </div>
                {data.recent.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("대상", "Source")}</th>
                          <th>{t("실행 상태", "Execution")}</th>
                          <th>{t("판정", "Verdict")}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent.map((j: any) => (
                          <tr key={j.id}>
                            <td>
                              <Link to={"/jobs/" + j.id}>{j.source}</Link>
                              <small className="mono">
                                {j.id.slice(0, 12)}
                              </small>
                            </td>
                            <td>
                              <Badge value={j.status} />
                            </td>
                            <td>
                              <Badge value={j.verdict} />
                            </td>
                            <td>
                              <Link
                                to={"/jobs/" + j.id}
                                aria-label={t("상세 보기", "View details")}
                              >
                                <ArrowUpRight size={16} />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    {t("아직 검사한 대상이 없습니다.", "No scans yet.")}
                  </Empty>
                )}
              </section>
            )}
            {tab === "distribution" && (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>{t("API 사용량", "API usage")}</h2>
                    <a href={`/api/usage/export?days=${days}`}>CSV ↓</a>
                  </div>
                  <div className="chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.series}>
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--color-line)"
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v) => v.slice(5)}
                          minTickGap={40}
                        />
                        <YAxis allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-raised)",
                            border: "1px solid var(--color-line)",
                          }}
                        />
                        <Bar
                          dataKey="api_requests"
                          fill="var(--color-accent)"
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="panel-note">
                    {t("오류", "Errors")}: {data.api.errors} ·{" "}
                    {t("평균 응답", "Mean latency")}:{" "}
                    {number(data.api.latency_ms)} ms ·{" "}
                    {t("사용량 범위", "Usage scope")}: {data.usage_scope}
                  </p>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>{t("모델별 토큰 사용량", "Model token usage")}</h2>
                  </div>
                  {data.models.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {[
                              "Provider / model",
                              "Requests",
                              "Input",
                              "Output",
                              "Cache read / write",
                              "Missing input / output",
                              "Errors",
                              "Cost USD",
                            ].map((x) => (
                              <th key={x}>{x}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.models.map((m: any) => (
                            <tr key={m.provider + m.model}>
                              <td>
                                <Badge value={m.provider} />
                                <small>{m.model}</small>
                              </td>
                              <td>{m.requests}</td>
                              <td>{number(m.input_tokens)}</td>
                              <td>{number(m.output_tokens)}</td>
                              <td>
                                {number(m.cache_read_tokens)} /{" "}
                                {number(m.cache_write_tokens)}
                              </td>
                              <td>
                                {m.missing_input_usage} /{" "}
                                {m.missing_output_usage}
                              </td>
                              <td>{m.errors}</td>
                              <td>
                                {number(m.cost_usd)}
                                <small>
                                  {m.priced_requests}/{m.requests} measured
                                </small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>
                      {t(
                        "아직 모델 호출 기록이 없습니다.",
                        "No model calls recorded yet.",
                      )}
                    </Empty>
                  )}
                  <p className="panel-note">
                    {t(
                      "미보고 토큰·비용은 — 로 표시합니다. 온프렘 비용을 0으로 가정하지 않습니다.",
                      "Unreported tokens and cost appear as —. On-prem cost is not assumed to be zero.",
                    )}
                  </p>
                </section>
              </>
            )}
          </>
        )}
      </State>
    </>
  );
}
