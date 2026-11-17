# 검색과 결과 공유 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 아래 단계는 원래 구현 계획이며 체크는 2026-11-17의 실제 기능 PR 병합을 반영한다. 운영 배포·활성화 완료 표시는 아니다.

**전달 상태 (2026-11-17):** [E1 · PR #20](https://github.com/wontaeJeong/agent-admission-gate/pull/20), [E2 · PR #26](https://github.com/wontaeJeong/agent-admission-gate/pull/26) 병합. 각 최종 head의 독립 검토와 필수 CI 5개 성공을 확인했다. 정확한 head/CI·검증 시점·화면·판단 비용·남은 Minor는 [전달 기록](../../engineering/2026-11-17-convenience-roadmap-delivery.md)을 따른다. 전체 검토 I1/I2의 최종 수정은 별도 PR의 범위 재검토·정확한 head CI가 병합 조건이다.

**Goal:** F08·F09의 검색 확장, 특정 발견 링크, Markdown 요약·인쇄를 제공한다.

**Architecture:** 공유는 인증된 기존 작업의 링크와 안전한 파생 요약으로 제공한다. 검색은 관계형 DB의 좁은 발견 색인을 사용하고 원본 리소스의 권한을 먼저 적용한다. 내부 코멘트·초안·키 원문은 색인하지 않는다.

**Tech Stack:** Python >=3.12, FastAPI 0.141.1, SQLAlchemy >=2.0,<3, Alembic >=1.13,<2; React 19.2.8, Vite 8.2.2, TypeScript, react-markdown, Vitest, Playwright.

**Spec:** [상세 설계8장](../specs/2026-11-16-convenience-design.md). E1은 A1 로그인 복귀, E2는 E1 발견 링크에 의존한다.

## Global Constraints

- 공유 링크는 접근 권한을 부여하지 않는다. API 키 summary에는 검토 상태·결정 사유를 포함하지 않는다.
- 요약은 상위20개와 생략 개수, UTC 시각, 원래/최종 판정, coverage·한계를 표시한다.
- 검색은 interactive session 전용. q2~200자/최대8토큰, page_size25/최대50, literal token AND다.
- external 검색 서버·게스트 링크·raw HTML·외부 PDF 렌더러를 추가하지 않는다.
- AAG_SEARCH_ENABLED는 UI와 API에 적용한다. 색인이 불완전하면0건과 구분한다.

## Review Focus

1. 중복 fingerprint와 필터 밖의 deep link가 엉뚱한 항목을 가리키지 않는가 → E1 occurrence.
2. 요약이 API 키에 검토 사유나 내부 코멘트를 노출하지 않는가 → E1 권한/escape.
3. 숨겨진 작업이 검색 개수·snippet·cursor에서 추론되지 않는가 → E2 선행 predicate.
4. 캐시·backfill·중단된 색인이 최신 최종 판정이나 완료 개수를 왜곡하지 않는가 → E2 projection.
5. wildcard·긴 검색어·IME 단축키·큰 결과에서 기능이 오작동하지 않는가 → E2 입력/브라우저.

## E1 발견 링크와 읽기용 요약

**수정 파일:** backend/aag/routes_scans.py; frontend/src/pages/Scans.tsx, frontend/src/App.tsx, styles.css.

**생성 파일:** backend/aag/scan_summary.py; frontend/src/findingSelection.ts, frontend/src/pages/ScanSummary.tsx, frontend/src/findingSelection.test.ts; backend/tests/test_scan_summary.py; frontend/e2e/scan-sharing.spec.ts.

**인터페이스:** /jobs/{id}?tab=findings&finding={fingerprint}&occurrence={n}. selectFinding(findings, fingerprint, occurrence) -> selected|missing이며 occurrence는0-based다. /jobs/{id}/summary는 인증된 읽기용 화면이다. GET /api/scans/{id}/summary?format=markdown은 text/markdown attachment를 반환한다. build_scan_summary(job, *, public_review=None, public_url) -> str은 공개 데이터만 받는다.

- [x] **1. 선택·요약 사례:** test_duplicate_fingerprint_occurrence, test_missing_finding_not_replaced, test_filter_excludes_linked_finding, test_summary_api_key_omits_review, test_summary_internal_comment_absent, test_summary_escapes_untrusted_markdown, test_summary_twenty_and_omitted_count를 작성한다.
- [x] **2. 실패 확인:** uv run pytest backend/tests/test_scan_summary.py -q 및 frontend의 findingSelection.test.ts를 실행해 새 기능 부재로 실패하는지 확인한다.
- [x] **3. API 구현:** owned_job/scan:read를 확인한 뒤 field allowlist로 요약한다. review는 현재 조회 가능한 interactive session에만 전달한다. 심각도→engine/rule/path/line 정렬·상위20개·생략 수·coverage를 표시하고 사용자 문자열을 escape한다. 입력 원본 오류·내부 코멘트·Raw JSON은 넘기지 않는다.
- [x] **4. 화면 구현:** severity/engine/q/선택을 URL에 보존한다. 유효 선택이 필터 밖이면 선택 상세와 '필터 밖 항목' 안내를 표시하고 필터 초기화 버튼을 제공한다. 없는 선택은 누락 상태를 보여준다. 복사 실패를 알리고 인쇄 화면은 safe summary+print CSS를 사용한다.
- [x] **5. PR:** 대상 pytest·선택 단위·frontend build·scan-sharing E2E로 로그인 복귀, 중복/없는 발견, 제한된 요약, 모바일 공유·인쇄를 검증한다. 이미지와 함께 feat: share precise findings and readable scan summaries로 커밋·PR을 만든다.

**구현 상태 (2026-11-17):** [PR #20](https://github.com/wontaeJeong/agent-admission-gate/pull/20) 생성과 대표 이미지 준비. 리뷰 I1의 literal q=`all`/`allow` 보존을 실제 순차 입력·URL 유지 회귀로 보완했습니다. 최종 재검토와 CI 44022208395 성공 후 병합됐습니다. 검증 상세는 [전달 기록](../../engineering/2026-11-17-convenience-roadmap-delivery.md)에 기록합니다.

**완료 기준:** F09. 검색 결과는 동일한 fingerprint/occurrence 링크를 사용한다.

## E2 권한 범위를 유지하는 통합 검색

**수정 파일:** backend/aag/models.py, backend/aag/service.py, backend/aag/routes_scans.py, backend/aag/routes_metrics.py, backend/aag/cli.py, backend/aag/config.py, backend/aag/main.py; frontend/src/App.tsx, frontend/src/api.ts. source/review scope의 공통 predicate를 재사용한다.

**생성 파일:** backend/aag/search_index.py, backend/aag/routes_search.py; frontend/src/pages/Search.tsx, frontend/src/SearchEntry.tsx; backend/tests/test_search.py, backend/tests/test_search_index.py; frontend/e2e/search.spec.ts. 새 migration 이름은 finding_search_index다.

**인터페이스:** GET /api/search?q=&type=scans|reviews|findings&scope=personal|review|all&page_size=&cursor=. 응답은 items/next_cursor/total/index_complete다. index_job_findings(s, job) -> None과 CLI aag reindex-findings --batch-size 100을 제공한다. 각 결과는kind/id/label/safe_snippet/href만 포함한다.

- [x] **1. 권한·입력 고정:** test_hidden_job_absent_from_items_total_cursor, test_reviewer_scope_matches_source_query, test_api_key_search_forbidden, test_literal_percent_and_underscore, test_query_length_and_tokens, test_index_pending_not_zero, test_current_verdict_from_job_join을 작성한다.
- [x] **2. 실패 확인:** uv run pytest backend/tests/test_search.py backend/tests/test_search_index.py -q.
- [x] **3. 색인 구현:** FindingIndex의 job_id/ordinal unique와 safe field projection, Job.finding_index_version을 추가한다. 완료 result 저장과 색인 갱신을 같은 트랜잭션으로 묶는다. 캐시 재사용도 새 job으로 색인한다. 기존 기록은100개 ID씩 조회하고 결과 본문은 한 작업씩 처리하며 완료한 작업만 version을 갱신한다.
- [x] **4. 검색 API:** 원본 Job/Review 권한 predicate 이후 token AND·count·limit를 적용한다. created_at desc/id desc/ordinal을 cursor에 포함한다. 검토 판정은 live join하고 내부 데이터는 projection에서 제외한다. 색인 중단·구버전은 index_complete=false로 응답하며 검색 불가능한 항목을0개라고 단정하지 않는다.
- [x] **5. UI:** /search와 상단 검색을 제공한다. 유형·scope·검색어를 URL로 유지하고 debounce·AbortController·generation으로 오래된 응답을 폐기한다. Cmd/Ctrl+K는 입력창/IME 중 무시한다. CVE·작업ID·경로 결과를 E1 링크로 열고 권한 없음·준비 중·0건·오류를 구분한다.
- [x] **6. PR:** SQLite/PostgreSQL의 같은 fixture 결과·실제 query plan·synthetic 10만 발견의 최초/다음 페이지를 확인한다. backfill 중단/재개·캐시·유효 판정 변화, frontend build, search E2E를 검증한다. 실제 환경의 측정 시간을 PR에 기록하며 측정 없이 성능 보장을 쓰지 않는다. PC/모바일·색인 준비 상태 이미지와 함께 feat: search authorized scan and review evidence로 커밋·PR을 만든다.

**완료:** F08. 기준 구현에서 LIKE 검색 지연이 크면 측정 자료를 근거로 별도 DB 색인 최적화를 진행한다.

E2는 PR #26으로 병합됐다. routes_scans/routes_metrics가 이미 소비하는 job_scope_filters/review_queue_predicates를 검색도 재사용하므로 no-op 수정은 하지 않았다. 세 소비자의 일관성 유지 비용과 합성 10만 발견의 실제 측정 한계는 전달 기록 판단 16 및 운영 한계를 따른다.
