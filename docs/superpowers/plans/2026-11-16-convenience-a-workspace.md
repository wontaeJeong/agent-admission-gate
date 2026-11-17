# 사용자 작업 보존 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 현재 요청은 설계·플랜 작성이며 이 문서 자체가 제품 구현 시작 지시는 아니다.

**Goal:** F02·F03·F04의 초안 복구, 목록 복원, 저장된 보기, 로그인 복귀를 제공한다.

**Architecture:** 목적지 검증과 계정 바인딩을 먼저 공통화한다. 초안은 탭별 브라우저 상태, 저장된 보기는 계정별 DB 상태로 구분한다. 기존 App 경로를 보존한 data router 진입점에서 이탈 차단기 하나를 사용한다.

**Tech Stack:** Python >=3.12, FastAPI 0.141.1, SQLAlchemy >=2.0,<3, Alembic >=1.13,<2; React 19.2.8, TypeScript, react-router-dom ^7.13.0, Vite 8.2.2, Vitest, Playwright.

**Spec:** [상세 설계 2~4장](../specs/2026-11-16-convenience-design.md).

## Global Constraints

- 세션·PKCE·nonce·same-origin·API 키 scope 계약을 유지한다. 토큰/PAT/파일 본문은 초안과 return_to에 넣지 않는다.
- 초안: debounce 300ms, 24시간, 최대 20개·256KiB, 같은 탭·같은 계정만 복구한다.
- 저장된 보기: 계정당 20개, 이름 1~40자, resource별 기본 보기 최대 1개, 명시적 URL이 우선한다.
- 사용자 콘텐츠 mutation은 폼 소유 계정의 X-AAG-Account를 보낸다. 불일치는 409이며 legacy endpoint는 헤더가 있을 때 검사한다.

## Review Focus

1. 정상 목적지와 인코딩된 open redirect 우회를 같은 규칙으로 처리하는가 → A1 목적지 fixture.
2. 늦은 401·저장 응답이 새 계정의 상태를 지우거나 저장하지 않는가 → A1 계정 전환 race.
3. 결정 폼과 코멘트가 동시에 dirty일 때 한 번만 경고하고 모두 보존하는가 → A2 다중 폼.
4. storage 불가·용량 초과·로그아웃 직후 cleanup이 초안을 재생성하지 않는가 → A2 quota/generation.
5. 동시 기본 보기 설정·검색 URL·뒤로가기가 서로 덮어쓰지 않는가 → A3 동시성·복귀.

## A1 로그인 복귀와 계정 바인딩

**수정 파일:** backend/aag/routes_identity.py, backend/aag/auth.py, backend/aag/models.py; frontend/src/api.ts, frontend/src/App.tsx, frontend/src/pages/Scans.tsx, frontend/src/pages/Reviews.tsx, frontend/src/pages/Boards.tsx, frontend/src/pages/Integrations.tsx, frontend/src/pages/Admin.tsx, frontend/src/pages/AdminKeys.tsx, frontend/src/pages/AccountSettings.tsx, frontend/src/notifications.tsx, frontend/src/pages/Notifications.tsx.

**생성 파일:** backend/aag/return_paths.py; frontend/src/returnPaths.ts, frontend/src/session.tsx; backend/tests/test_return_paths.py, backend/tests/test_session_return.py, backend/tests/test_account_bound_mutations.py; frontend/src/returnPaths.test.ts; frontend/e2e/session-return.spec.ts. 새 Alembic migration 이름은 session_return_target이며 revision 파일명은 생성 시 확정한다.

**인터페이스:** normalize_return_to(value: str | None) -> str. SessionCoordinator는 captured account_id/generation을 가진다. sendAsAccount<T>(path, body, accountId, method?) -> Promise<T>는 명시적 계정 헤더를 사용한다. GET /api/auth/oidc/login?return_to=...는 검증된 목적지를 state에 저장한다.

- [x] **1. 실패 사례 고정:** test_safe_return_path_preserves_finding_query는 유효 jobs/findings query 보존을 확인한다. test_unsafe_return_path_falls_back은 //evil.test, %2f%2fevil.test, 역슬래시, 개행, 이중 인코딩, /api, 2,049자 입력의 결과가 /임을 확인한다.
- [x] **2. 실패 확인:** uv run pytest backend/tests/test_return_paths.py backend/tests/test_session_return.py backend/tests/test_account_bound_mutations.py -q. 새 처리 부재로 실패하는지 확인한다.
- [x] **3. 서버 계약 구현:** nullable OIDCState.return_to를 추가하고 기존 state는 /로 처리한다. callback은 저장된 state만 참조한다. actor에서 interactive mutation의 계정 헤더가 있으면 불일치를409로 거부한다. 새 필수 endpoint는 누락도409다. 기존 PKCE·일회 소비·동시 실효 검증은 유지한다.
- [x] **4. 프런트 연결:** api의401 이벤트를 계정 generation에 결합하고 로그인 실패·403·503을 분리한다. 각 폼이 열릴 때의 accountId로 제출한다. 재로그인 안내 전 등록된 flush를 호출하고 POST를 자동 재전송하지 않는다.
- [x] **5. race 검증:** test_old_account_mutation_rejected는 오래된 계정 헤더+새 쿠키의 재검사/코멘트/게시글/키 발급이409이고 DB 변경0건임을 확인한다. E2E로 발견 링크→SSO 모의 callback→같은 항목, 두 탭 계정 전환, 중복401 안내 한 번,403/503에서 로그아웃 없음을 확인한다.
- [x] **6. PR:** 대상 pytest·returnPaths 단위·frontend build·session-return E2E·migration round trip을 통과시킨다. 복귀·만료 안내 PC/모바일 이미지와 함께 feat: preserve return destination and bind submissions to account로 커밋·PR을 만든다.

검증 기록: `backend/tests/test_return_paths.py`, `test_session_return.py`, `test_account_bound_mutations.py`, `frontend/src/session.test.ts`, `returnPaths.test.ts`, `frontend/e2e/session-return.spec.ts`. A1은 발견 query를 포함한 정확한 복귀 URL과 현재 허용된 결과 내용을 검증한다. 임의 finding/occurrence의 화면 선택은 E1 범위이며 F04 전체 완료를 앞당겨 주장하지 않는다. [PR #16](https://github.com/wontaeJeong/agent-admission-gate/pull/16)은 필수 CI 5개 job과 독립 검토 수정 확인 후 main `bf78cf6`에 병합됐다. 최종 A1 검증은 backend 172, frontend unit 65, 전체 browser 50, SQLite/PostgreSQL migration이다.

**완료:** F04의 로그인 복귀 기반. 후속 작업은 sendAsAccount와 SessionCoordinator의 flush/generation을 사용한다.

## A2 초안과 이탈 보호

**수정 파일:** frontend/src/main.tsx, frontend/src/App.tsx, frontend/src/pages/Scans.tsx, frontend/src/pages/Reviews.tsx, frontend/src/pages/Boards.tsx.

**생성 파일:** frontend/src/drafts.ts, frontend/src/useDraft.ts, frontend/src/DirtyForms.tsx, frontend/src/DraftRecovery.tsx, frontend/src/drafts.test.ts; frontend/e2e/drafts.spec.ts.

**인터페이스:** DraftKind는 scan_new/review_request/review_decision/scan_comment/board_post다. DraftEnvelope<T>는 schema_version/account_id/kind/target_id/base_revision/base_state/saved_at/fields를 가진다. base_revision은 nullable이고 C1 전에는 base_state(status/decided_at/review_id)와 최신 GET으로 충돌을 검사한다. readDraft(key, now), writeDraft(key, envelope, now), clearDraft(key), clearAccountDrafts(accountId)를 제공한다. useDraft는 복구 후보·dirty·flush·discard·markSubmitted를 반환한다. DirtyFormsProvider가 여러 폼을 등록받아 useBlocker를 한 번만 호출한다.

- [x] **1. 저장소 사례 고정:** fake Storage와 고정 now로24시간 경계,21번째 초안의 오래된 순 제거,256KiB 초과, schema 불일치, 같은 계정의 다른 target 분리, PAT/token/file 필드 제외를 확인한다.
- [x] **2. 실패 확인:** cd frontend && npm test -- drafts.test.ts. 미구현으로 실패하는지 확인한다.
- [x] **3. 저장과 라우터 구현:** kind별 필드 allowlist로300ms 저장하고 pagehide 등에서 동기 flush한다. main.tsx를 createBrowserRouter/RouterProvider 단일 root로 바꾸되 App의 경로를 유지한다. 하나의 DirtyFormsProvider에 모든 dirty 폼을 등록한다. SSO 전에는 A1 flush, hard reload에는 beforeunload를 적용한다.
- [x] **4. 폼 연결:** 최초 GET과 권한 확인 뒤 복구 후보를 보여주고 명시적 복구 없이 서버 값을 덮어쓰지 않는다. 검토 revision, 내부 코멘트 자격, 게시판 flag/revision을 재확인한다. 성공한 폼의 초안만 제거하고 로그아웃 뒤 cleanup의 재저장은 generation으로 차단한다.
- [x] **5. 브라우저 검증:** test_two_dirty_forms_preserved에서 결정 사유·코멘트를 모두 작성하고 이탈 취소/진행을 확인한다. test_account_switch_never_restores_foreign_draft, test_storage_error_is_visible, test_decided_review_preserves_readonly_draft, test_tab_change_flushes를 추가한다. PAT와 ZIP이 복구 대상이 아님을 확인한다.
- [ ] **6. PR:** drafts 단위·build·drafts E2E·기존 account/review E2E를 통과시킨다. 복구·저장 실패·충돌 PC/모바일 이미지와 함께 feat: retain account scoped form drafts로 커밋·PR을 만든다.

검증 기록: drafts 단위 15개를 포함한 frontend unit 80개, frontend build·format, drafts 23개를 포함한 집중 account/review/session E2E 46개와 전체 browser 73개, docs build를 통과했다. `frontend/src/drafts.test.ts`, `frontend/e2e/drafts.spec.ts`가 A2 검증을 제공한다. main.tsx의 data router 단일 root에서 한 blocker가 모든 열린 폼을 처리하고, 로컬 게시글 편집 닫기도 같은 확인을 사용한다. 검사·검토 대상 pathname 변경은 폼을 다시 마운트해 이전 target 입력을 분리한다. 저장소가 차단돼도 폼 편집·제출은 가능하며, 지원하지 않는 schema는 명시적으로 버린 뒤 작성한다. 같은 계정 만료는 null 계정 관찰을 발행하지 않으며 명시적 로그아웃만 null 관찰로 다른 탭의 초안을 정리한다. 기존 revision 없는 검토는 최신 GET의 status/decided_at/review_id를 대조하고, 게시글 제출은 편집 시작 또는 명시적 재편집 때 캡처한 revision을 사용한다. 인증 정보·query·fragment가 포함된 저장소 URL도 저장에서 제외하고 화면에 알린다. 화면 증거 7개: `docs/engineering/screenshots/convenience-a2/`. 합성 데이터의 복구 desktop dark/light와 mobile, 저장 실패·읽기 전용 충돌 desktop/mobile을 확인했으며 모바일 가로 넘침이 없다. 구현·로컬 검증 체크만 완료했으며 PR 번호·독립 검토·필수 CI·병합은 실행 담당자가 기록한다.

**완료:** F02. C2에서 새 검토 상태의 복구 허용 여부를 추가한다.

## A3 목록 복귀와 저장된 보기

**수정 파일:** backend/aag/models.py, backend/aag/main.py; frontend/src/pages/Scans.tsx, frontend/src/pages/Reviews.tsx.

**생성 파일:** backend/aag/routes_saved_views.py, backend/aag/saved_views.py; frontend/src/listNavigation.ts, frontend/src/SavedViews.tsx; backend/tests/test_saved_views.py; frontend/src/listNavigation.test.ts; frontend/e2e/saved-views.spec.ts. 새 migration 이름은 saved_views다.

**인터페이스:** SavedView DTO는 id/resource/name/filters/is_default/revision/usable/invalid_reason이다. GET/POST /api/saved-views, PATCH/DELETE /api/saved-views/{id}. filters는 resource별 versioned allowlist다. rememberList(accountId, resource, url, scrollY) / restoreList(accountId, resource)로 목록 상태를 보존한다.

- [ ] **1. 계약 사례 고정:** test_view_owner_isolation은 타인 ID404, test_view_limit은21번째409, test_view_revision_conflict는 오래된 revision409, test_one_default_after_race는 동시 설정 후 default 합계1을 확인한다. 공백 이름·미지원 필터·page/scroll 저장은422다.
- [ ] **2. 실패 확인:** uv run pytest backend/tests/test_saved_views.py -q.
- [ ] **3. 저장 계층 구현:** owner/resource/name unique와 DB partial unique index로 기본 보기를 최대1개로 제한한다. owner User 행의 update lock 이후 개수·기본 보기를 검증해 SQLite/PostgreSQL 모두 직렬화한다. default가 해제된 기존 행의 revision도 증가한다. 모든 작업은 interactive/account-bound이며 갱신은 CAS다.
- [ ] **4. 화면 구현:** listNavigation으로 URL+scroll을 보존하고 상세의 고정/jobs 링크를 바꾼다. 명시 query>저장 default>표준 순서로 적용하며 비교 화면의 복귀도 같은 계약을 사용한다. 권한을 잃은 보기는 usable=false로 표시하고 수정·삭제를 제공한다.
- [ ] **5. 브라우저 검증:** 필터된3페이지→상세→목록의 query/행/scroll, 직접 상세 진입, back/forward, 결과 감소로 무효가 된 페이지, 재로그인 뒤 default, staff 자격 상실, 다른 탭의 보기 수정 충돌을 확인한다.
- [ ] **6. PR:** SQLite/PostgreSQL 대상 pytest, 단위/build/saved-views E2E, migration round trip을 통과시킨다. 저장 보기·권한 무효 이미지와 함께 feat: restore list context and save personal views로 커밋·PR을 만든다.

**완료:** F03. C1/E2가 필터를 추가하면 allowlist와 저장 schema도 함께 갱신한다.
