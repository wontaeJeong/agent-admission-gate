"""Read-only Markdown projection; callers supply only authorized public fields."""

import re
from collections import Counter
from datetime import UTC, datetime
from string import punctuation
from urllib.parse import quote, urlsplit, urlunsplit

SEVERITIES = ("critical", "high", "medium", "low", "info", "unknown")


def escaped(value):
    # GFM can autolink decoded entities. Code spans keep punctuation literal in
    # CommonMark/GFM and other renderers; use a longer fence than any input run.
    text = "".join(c if c.isprintable() else " " for c in str(value if value is not None else "—"))
    if not any(c in punctuation for c in text):
        return text
    fence = "`" * (max((len(run) for run in re.findall(r"`+", text)), default=0) + 1)
    return fence + " " + text + " " + fence


def public_source(source):
    value = str(source or "")
    if "://" not in value:
        return value
    try:
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname:
            return "—"
        host = url.hostname
        if ":" in host:
            host = "[" + host + "]"
        if url.port:
            host += ":" + str(url.port)
        return urlunsplit((url.scheme, host, url.path, "", ""))
    except ValueError:
        return "—"


def build_scan_summary(job, *, public_review=None, public_url):
    findings = job.get("findings", [])
    counts = Counter(f.get("severity", "unknown") for f in findings)

    def order(f):
        severity = f.get("severity", "unknown")
        return (
            SEVERITIES.index(severity) if severity in SEVERITIES else len(SEVERITIES),
            str(f.get("engine", "")),
            str(f.get("rule", "")),
            str(f.get("path", "")),
            f.get("line") if isinstance(f.get("line"), int) else 0,
        )

    created = datetime.fromtimestamp(job["created_at"], UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [
        "# 검사 요약 / Scan summary",
        "",
        "읽기용 요약입니다. 반입과 검토 결정에는 현재 서버 권한과 정책이 적용됩니다. Read-only summary. Admission and review decisions remain subject to current server authorization and policy.",
        "",
        "소스 / Source: " + escaped(public_source(job.get("source"))),
        "참조 / Ref: " + escaped(job.get("ref")),
        "커밋 / Commit: " + escaped(job.get("resolved_commit")),
        "콘텐츠 해시 / Content SHA256: " + escaped(job.get("content_hash")),
        "생성 시각 / Created: " + created,
        "프로필 / Profile: " + escaped(job.get("profile")),
        "상태 / Status: " + escaped(job.get("status")),
        "원래 판정 / Original verdict: " + escaped(job.get("verdict")),
        "최종 판정 / Final verdict: " + escaped(job.get("effective_verdict")),
        "",
        "## 검사 범위와 제한 / Coverage and limitations",
        "",
        "검사 범위 / Coverage: "
        + ("complete (완전)" if job.get("coverage_complete") is True else "incomplete (불완전)"),
        "선택한 소스 시점과 프로필의 정적 분석은 실행 중 안전성을 보장하지 않습니다. Static analysis of the selected source snapshot and profile does not guarantee runtime safety.",
    ]
    for engine in job.get("engines", []):
        lines.append("- " + escaped(engine.get("name")) + ": " + escaped(engine.get("status")))
    for limitation in job.get("limitations", []):
        lines.append("- " + escaped(limitation))
    lines += ["", "## 발견 / Findings", "", f"전체 발견 / Total findings: {len(findings)}"]
    lines += [f"- {severity}: {counts[severity]}" for severity in SEVERITIES]
    unknown = sum(count for severity, count in counts.items() if severity not in SEVERITIES)
    if unknown:
        lines.append(f"- 미분류 심각도 / unrecognized severity: {unknown}")
    lines += [
        "",
        "상위 20개 발견 / Top 20 findings (심각도 / severity, 엔진 / engine, 규칙 / rule, 경로 / path, 행 / line):",
        "",
    ]
    for n, f in enumerate(sorted(findings, key=order)[:20], 1):
        lines.append(
            f"{n}. "
            + " · ".join(
                escaped(f.get(k)) for k in ("severity", "engine", "rule", "title", "path", "line")
            )
            + (" · 예외 적용 / suppressed by exception" if f.get("suppressed") else "")
        )
    lines += ["", f"생략된 발견 / Omitted findings: {max(0, len(findings) - 20)}"]
    if public_review is not None:
        lines += [
            "",
            "## 검토 / Review",
            "",
            "상태 / Status: " + escaped(public_review.get("status")),
        ]
        if public_review.get("decision_reason"):
            lines.append(
                "결정 사유 / Decision reason: " + escaped(public_review["decision_reason"])
            )
    # The sole generated URL is built from configured origin and the owned job ID.
    url = public_url.rstrip("/") + "/jobs/" + quote(job["id"], safe="")
    lines += [
        "",
        f"[원본 검사 열기 / Open original scan]({url})",
        "",
        "링크는 접근 권한을 부여하지 않습니다. 권한이 있는 계정으로 로그인하세요. Links do not grant access. Sign in with an authorized account.",
    ]
    return "\n\n".join(lines) + "\n"
