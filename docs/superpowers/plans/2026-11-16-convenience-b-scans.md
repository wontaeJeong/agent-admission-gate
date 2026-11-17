# 재검사와 비교 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 현재 요청은 설계·플랜 작성이며 이 문서 자체가 제품 구현 시작 지시는 아니다.

**Goal:** F01·F05의 재검사, 대상별 이력, 근거와 한계를 설명하는 결과 비교를 제공한다.

**Architecture:** 재검사는 기존 ScanService로 새 작업을 제출하고 원본은 불변으로 둔다. Git은 기존 정규 URL, ZIP은 명시적 계보로 이력을 구성한다. 비교는 저장 결과를 읽기만 하며 판정 권한을 갖지 않는다.

**Tech Stack:** Python >=3.12, FastAPI 0.141.1, SQLAlchemy >=2.0,<3, Alembic >=1.13,<2; React 19.2.8, TypeScript, Vite 8.2.2, Vitest, Playwright.

**Spec:** [상세 설계5장](../specs/2026-11-16-convenience-design.md). A1의 계정 바인딩과 A3의 목록 복귀를 사용한다.

## Global Constraints

- clone/upload·캐시·시간/크기 제한·SSRF·인증정보 비저장은 기존 계약을 유지한다.
- target_commit은40/64자리 hex이며 ref와 동시 지정할 수 없다. snapshot 취득 실패를 latest로 바꾸지 않는다.
- ZIP은 같은 파일명으로 동일 대상을 추정하지 않는다. 새 결과에 이전 승인 효력을 옮기지 않는다.
- fingerprint는 line/title을 포함한다. 미검출을 자동 해결·ALLOW로 해석하지 않는다.

## Review Focus

1. checkout 전 실패해도 snapshot 의도가 남는가 → B1 target_commit 저장.
2. 타인의 원본·ZIP 계보를 요청으로 위조할 수 없는가 → B1/B2 소유권.
3. branch/tag 변경에도 latest/snapshot이 분명히 나뉘는가 → B1 임시 Git fixture.
4. 줄 이동·중복 fingerprint·suppressed 변화를 잘못 분류하지 않는가 → B3 fixture.
5. incomplete/truncated/출처 미보고 결과에 해결 수를 만들지 않는가 → B3 comparability.

## B1 이전 조건으로 재검사

**수정 파일:** backend/aag/models.py, backend/aag/schemas.py, backend/aag/sources.py, backend/aag/service.py, backend/aag/routes_scans.py; frontend/src/api.ts, frontend/src/pages/Scans.tsx.

**생성 파일:** frontend/src/pages/scanRerun.ts; backend/tests/test_scan_rerun.py; frontend/e2e/scan-rerun.spec.ts. 새 migration 이름은 scan_lineage다.

**인터페이스:** ScanRequest에 origin_job_id/target_commit/rerun_mode를 추가한다. submit의 upload 인자에 upload_origin_job_id를 추가한다. clone(url, ref, credential, root, settings, *, target_commit=None)은 기존 호출과 호환된다. Job은 origin_job_id/lineage_root_id/target_commit/rerun_mode를 반환한다.

- [x] **1. 계약 고정:** test_rerun_copies_nonsecret_settings, test_foreign_origin_rejected(404), test_snapshot_target_survives_checkout_failure, test_snapshot_ref_mutually_exclusive(422), test_unlinked_same_filename_not_grouped를 작성한다.
- [x] **2. 실패 확인:** uv run pytest backend/tests/test_scan_rerun.py -q.
- [x] **3. 제출과 계보 구현:** JSON/Multipart 제출을 확장하고 원본 owner/source_type/Git 정규 URL을 검사해 root를 설정한다. target_commit/rerun_mode는 태스크 실행 전에 저장한다. 기존 Job의 root=self를 backfill하고 owner/root/created 복합 인덱스를 추가한다.
- [x] **4. snapshot 구현:**40/64자리 hex만 안전한 init→fetch --depth=1→detached checkout으로 처리한다. 기존 protocol/redirect/hook/submodule 제한을 모든 command에 적용하고 실제 HEAD 일치를 확인한다. 임시 Git fixture로 브랜치 이동·없는 커밋·fetch 거부·timeout에서 fallback이 없음을 확인한다.
- [x] **5. UI 구현:** /new?from=ID&mode=latest|snapshot은 GET 확인 후 URL/ref/profile을 채운다. 실패한 snapshot 재시도는 target_commit을 우선한다. PAT·ZIP은 재입력하고 초기 설정과 A2 복구 후보 중 사용자가 선택하게 한다. 이중 클릭을 막고 저장 여부가 불명확한 POST는 자동 재전송하지 않는다.
- [ ] **6. PR:** 대상 pytest, source/cache/권한 회귀, frontend build, scan-rerun E2E, migration을 검증한다. latest/snapshot/ZIP 재선택/실패 이미지와 함께 feat: reuse scan settings and preserve source lineage로 커밋·PR을 만든다.

**구현 상태 (2026-11-17):** 단계1–5 구현·RED/GREEN 확인. backend212개, frontend99개, 전체 E2E116개, Ruff·frontend build/format·docs build 통과; SQLite/PostgreSQL migration 왕복 및 화면7장 확인. [PR #19](https://github.com/wontaeJeong/agent-admission-gate/pull/19) 생성됨. 독립 검토 I1의 신규 메타데이터 라벨 한·영 누락을 수정했으며 최종 검토·CI·병합은 controller gate다.

**완료:** F01. C3·B2에서 origin_job_id/lineage_root_id를 사용할 수 있다.

## B2 동일 대상 이력

**수정 파일:** backend/aag/routes_scans.py; frontend/src/pages/Scans.tsx.

**생성 파일:** backend/aag/scan_history.py; frontend/src/pages/ScanHistory.tsx; backend/tests/test_scan_history.py; frontend/e2e/scan-history.spec.ts.

**인터페이스:** GET /api/scans/{id}/history?ref=&profile=&status=&page=&page_size=는 items/total/page/page_size를 반환한다. history_query(actor, reference_job)는 Git source+owner 또는 ZIP root+owner를 적용한다. 허용된 interactive 사용자에게만 review summary를 추가한다.

- [ ] **1. 대상 분리 검증:** test_history_same_git_different_refs_included, test_history_excludes_other_owner, test_api_key_owner_scope, test_zip_root_not_filename, test_filters_and_page_count를 작성한다.
- [ ] **2. 실패 확인:** uv run pytest backend/tests/test_scan_history.py -q.
- [ ] **3. API 구현:** reference의 owned_job 확인 후 같은 owner query를 만든다. ref/profile/status를 count와 rows에 동일 적용한다. page_size 기본25/최대100, created_at desc/id desc로 안정 정렬한다. staff라도 다른 owner 이력을 자동 추가하지 않는다.
- [ ] **4. 화면 구현:** commit/ref/profile/판정/coverage/cache/검토 상태를 표시한다.2건 선택·비교 진입·원래 목록 복귀를 제공하고 이력이 없으면 재검사 링크를 보여준다.
- [ ] **5. PR:** 대상 pytest·scan-history E2E로 Git/ZIP, 권한, filter/pagination, 모바일 표를 확인한다. 이미지와 함께 feat: navigate source scan history로 커밋·PR을 만든다.

**완료:** F05 이력 부분. 비교할2건과 baseline/current 구분을 제공한다.

## B3 저장 결과 비교

**수정 파일:** backend/aag/routes_scans.py; frontend/src/App.tsx, frontend/src/api.ts, frontend/src/pages/Scans.tsx.

**생성 파일:** backend/aag/scan_comparison.py; frontend/src/pages/ScanCompare.tsx; backend/tests/test_scan_comparison.py; frontend/e2e/scan-compare.spec.ts.

**인터페이스:** compare_jobs(baseline, current, *, allow_unlinked=False) -> ComparisonDTO. GET /api/scans/{id}/compare?baseline_id=&allow_unlinked=. DTO는 baseline/current/comparability/summary/items, item은 classification/baseline_finding/current_finding/change_flags/confidence를 가진다.

- [ ] **1. 비교 fixture 고정:** test_identical_fingerprint_persists, test_line_move_is_candidate, test_ambiguous_match_stays_unmatched, test_exception_is_not_remediation, test_incomplete_engine_has_no_resolved_count, test_missing_provenance_is_unknown, test_other_side_hidden을 작성한다.
- [ ] **2. 실패 확인:** uv run pytest backend/tests/test_scan_comparison.py -q.
- [ ] **3. 비교 구현:** 동일 fingerprint의 중복을 dict로 소실시키지 않고 배열로 대조한다. 남은 engine/rule/path/title이 유일한1:1일 때만 moved_candidate로 묶는다. 나머지는 new/not_observed/unmatched, severity/suppressed는 별도 flag로 표시한다. 과거 provenance는 null로 남긴다.
- [ ] **4. API·화면 구현:** 양쪽 owner/source/Git identity와 완료 상태를 확인하고 미연결 ZIP은 별도 확인을 요구한다. 상단에 profile/policy/revision/coverage/unknown 차이를 보여준다. 실패·취소는 메타데이터만 보여주고 해결 수를 만들지 않는다.
- [ ] **5. PR:** 모든 분류·권한·frontend build·scan-compare E2E와 각1,000건 결과의 유한 처리를 확인한다. 줄 이동·coverage 누락·예외 차이·모바일 이미지와 함께 feat: compare scan evidence with explicit limitations로 커밋·PR을 만든다.

**완료:** F05. 비교는 Job/Review/Exception을 갱신하지 않는다.
