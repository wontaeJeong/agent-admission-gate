# 검토 담당과 보완 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 현재 요청은 설계·플랜 작성이며 이 문서 자체가 제품 구현 시작 지시는 아니다.

**Goal:** F06·F10의 담당자, 철회, 보완 요청·응답, 수정본의 후속 검토를 제공한다.

**Architecture:** 검토 전이는 서버의 단일 도메인 모듈과 revision CAS로 처리한다. status는 판정 종료 여부, workflow_state는 미결 업무의 차례를 표현한다. 변경·이벤트·감사·알림은 같은 트랜잭션에서 저장한다.

**Tech Stack:** Python >=3.12, FastAPI 0.141.1, SQLAlchemy >=2.0,<3, Alembic >=1.13,<2; React 19.2.8, TypeScript, 기존 알림함, Playwright.

**Spec:** [상세 설계6장](../specs/2026-11-16-convenience-design.md). A1/A2의 계정·초안 계약을 사용하고 C3는 B1에 의존한다.

## Global Constraints

- user/admin과 reviewer는 직교한다. API 키의 검토 mutation과 자기 claim/승인은 차단한다.
- reviewer_id는 실제 결정자, assignee_id는 사전 담당자다. 둘을 합치지 않는다.
- 새 mutation은 X-AAG-Account와 expected_revision을 요구한다. 불일치·경합은409다.
- 사유는5~4,000자. 원본 Job/result/hash는 편집하지 않으며 승인·예외를 후속 결과에 복제하지 않는다.
- 확장 flag off에서도 이미 생성된 상태의 조회와 담당자 결정 권한 검사는 유지한다.

## Review Focus

1. 두 claim·결정/철회 경합에서 하나만 성공하는가 → C1/C2 CAS.
2. 보완 대기 중 legacy decision으로 건너뛸 수 없는가 → C2 legacy gate.
3. 비활성·자격 상실 담당자의 해제 후에도 보완 대기가 보존되는가 → C1/C2 stale release.
4. 일반 admin의 운영 해제가 승인 자격을 만들지 않는가 → C1 권한 조합.
5. 후속 요청 중복·타인 작업·다른 소스·이전 승인 재사용이 차단되는가 → C3 lineage/unique.

## C1 담당자와 업무 이력

**수정 파일:** backend/aag/models.py, backend/aag/routes_scans.py, backend/aag/config.py, backend/aag/routes_identity.py, backend/aag/routes_admin.py; frontend/src/pages/Reviews.tsx, frontend/src/pages/Scans.tsx, frontend/src/pages/Dashboard.tsx, frontend/src/SavedViews.tsx, frontend/src/api.ts; backend/aag/saved_views.py. config 응답에 review_workflow_enabled를 추가한다.

**생성 파일:** backend/aag/review_workflow.py, backend/aag/review_query.py; backend/tests/test_review_claims.py, backend/tests/test_review_events.py; frontend/src/pages/ReviewActivity.tsx; frontend/e2e/review-claims.spec.ts. 새 migration 이름은 review_claims다.

**인터페이스:** transition_review(s, actor, review_id, expected_revision, action, reason=None) -> ReviewDTO. C1 action은 claim/release다. DTO에 assignee{id,name,active,qualified}/workflow_state/revision을 추가한다. POST claim/release와 GET events를 제공한다. review_queue_predicates(actor, tab, stage, assignee)는 목록과 대시보드가 공유한다.

- [x] **1. 상태·권한 고정:** test_two_claims_one_winner는 성공1건/409 한 건, test_self_claim_forbidden은403, test_admin_without_reviewer_cannot_claim은403, test_other_assignee_cannot_decide는409를 검증한다. test_stale_claim_release_requires_reason과 test_events_owner_visibility도 작성한다.
- [x] **2. 실패 확인:** uv run pytest backend/tests/test_review_claims.py backend/tests/test_review_events.py -q.
- [x] **3. 데이터·전이 구현:** assignee_id/claimed_at/revision/workflow_state와 ReviewEvent를 추가한다. 기존 pending은 waiting, 종료 건은 closed로 backfill한다. claim은 pending/waiting/미배정 조건 CAS이며 release는 담당자/admin 또는 stale claim 해제 자격을 검사한다. claim 이벤트의 reason은 null, 사용자가 요구받은 해제 사유는5~4,000자다.
- [x] **4. 기존 결정 경로 연결:** unclaimed pending/waiting은 legacy 결정을 같은 트랜잭션에서 self-claim할 수 있게 한다. in_review는 현재 담당자만 결정한다. 자기 승인·coverage_complete·현재 자격·중복 결정 조건을 전부 포함한다. PostgreSQL에서도 row 조건이 DB에 적용되는지 실제 동시 요청으로 확인한다.
- [x] **5. UI·query 구현:** 담당/해제/내 담당/미배정/대기시간/업무 이력을 제공한다. 기존 tab=pending은 모든 미결 건으로 유지하고 stage·assignee·q·sort를 추가한다. 저장된 보기 allowlist와 대시보드 count/link를 같은 predicate로 맞춘다. 새 메뉴는 flag off에서 숨기되 담당 권한은 서버가 계속 검사한다.
- [x] **6. PR:** SQLite/PostgreSQL 경합, 기존 review/self-approval/owner/API-key 회귀, frontend build, review-claims E2E를 통과시킨다. 미배정/담당/경합/권한 상실 PC·모바일 이미지를 첨부해 feat: claim reviews and record workflow activity로 커밋·PR을 만든다.

**완료:** F06의 담당·목록·감사. 알림 연결은 C2에서 확장한다.

C1 구현 검증 기록(2026-11-17): 전체 backend255개 통과(SQLite/PostgreSQL 포함), 실제 동시 HTTP claim/claim·decision/release·legacy decision/claim, migration backfill/왕복/새 이력 존재 시 downgrade 거부. frontend build/112 unit/format, 전체 browser129개(5.8m), docs11페이지 빌드도 통과했다. 세부 명령과 RED/GREEN은 task-6-report에 기록한다. [PR #21](https://github.com/wontaeJeong/agent-admission-gate/pull/21)은 독립 검토와 필수 CI 후 병합되었다.

분할 스키마 확인: C1은 assignee_id/claimed_at/revision/workflow_state와 ReviewEvent를 추가한다. closed_reason은 C2, previous_review_id는 C3의 선형 migration으로 추가한다. 최종 설계의 전체 컬럼 목록을 C1에 미리 만들지 않는다. Scans.tsx의 기존 snapshot→markSubmitted→검토 상세 링크를 재사용한다(755–786, 915–934). 담당 작업은 기존 상세 링크 한 단계 뒤에서 제공하며 binding C1에 inline 작업 요구는 없다. 컨트롤러가 Scans 파일 목록 조정을 확인했다. routes_admin.py는 실제 PostgreSQL 권한 변경/결정 경합에서 확인된 FK 교착을 해결하기 위해 active-admin 잠금을 FOR NO KEY UPDATE로 낮추며 last-admin 직렬화는 유지한다.

## C2 철회와 보완 요청·응답

**수정 파일:** backend/aag/review_workflow.py, backend/aag/models.py, backend/aag/routes_scans.py, backend/aag/schemas.py, backend/aag/notifications.py, backend/aag/routes_notifications.py; frontend/src/pages/Reviews.tsx, frontend/src/pages/Notifications.tsx, frontend/src/notifications.tsx, frontend/src/useDraft.ts, frontend/src/api.ts.

**생성 파일:** backend/tests/test_review_changes.py; frontend/e2e/review-changes.spec.ts. 새 migration 이름은 review_changes이며 closed_reason과 review_updates preference를 추가한다.

**인터페이스:** C1 action에 withdraw/request_changes/respond를 추가한다. POST /reviews/{id}/withdraw, /request-changes, /respond는 expected_revision/reason을 받는다. status=withdrawn, workflow_state=changes_requested를 추가한다. 알림 event kind는 상세 설계6장의 review.* 목록을 따른다.

- [x] **1. 전이 고정:** test_requester_withdraws_pending_without_changing_verdict, test_cannot_withdraw_decided, test_only_assignee_requests_changes, test_legacy_decision_cannot_bypass_changes, test_stale_release_keeps_changes_requested, test_respond_restores_current_assignee를 작성한다. 변경 전후 Job의 verdict/result/hash가 동일함을 assert한다.
- [x] **2. 실패 확인:** uv run pytest backend/tests/test_review_changes.py -q.
- [x] **3. 원자적 전이:** pending 소유자만 철회한다. request_changes는 in_review의 현재 담당자만 가능하다. changes_requested에서는 claim/decision을 legacy 호출까지 차단한다. 이 상태의 release는 담당만 제거하고 보완 대기는 유지한다. respond는 유효 담당이 있으면 in_review, 없으면 담당 제거 후 waiting이다.
- [x] **4. 이벤트·알림:** domain 변경, ReviewEvent, audit, emit_notification을 같은 트랜잭션에서 기록한다. 배정/해제는 요청자, 보완 요청은 요청자, 보완 응답/철회는 담당자에게 전달한다. 본인·중복은 제외하고 review_updates opt-out과 현재 권한을 적용한다. 알림에는 사유 본문을 복제하지 않는다.
- [x] **5. UI·초안:** 보완 요청/설명 보충/철회를 별도 버튼으로 제공한다. 승인된 결과 취소와 혼동시키지 않는 문구를 사용한다. 충돌409에서 최신 상태와 사용자의 사유 초안을 함께 보존하고, 철회/종료 후에는 읽기용 초안으로 전환한다.
- [x] **6. PR:** 결정/철회·응답/재요청 경합, 수신 설정·권한 상실, review-changes E2E와 알림 회귀를 통과시킨다. 각 상태·실패·모바일 이미지를 첨부해 feat: withdraw reviews and request supplementary evidence로 커밋·PR을 만든다.

**완료:** F10의 철회·보완. F06 변경 알림까지 연결한다.

C2 최종 검증(2026-11-17): backend305(SQLite/PostgreSQL 실제 경합·migration 포함), frontend112 unit, 전체 browser133, build/format/ruff/docs11페이지가 통과했다. 세부 RED/GREEN과 셸 wrapper 오류 구분은 task-7-report에 기록한다.

C2 구현은 ReviewActivity의 공통 전이 폼과 drafts.ts/DraftRecovery를 확장한다. 기존 useDraft의 제출 receipt와 api의 계정 바인딩을 그대로 사용하며 불필요한 파일 수정은 하지 않는다. 검증·화면 증거·독립 검토 기록은 task-7-report다. [PR #22](https://github.com/wontaeJeong/agent-admission-gate/pull/22)로 병합했다. previous_review_id는 C3에서 추가한다.

## C3 수정본의 후속 검토

**수정 파일:** backend/aag/models.py, backend/aag/review_workflow.py, backend/aag/routes_scans.py; frontend/src/pages/Reviews.tsx, frontend/src/pages/Scans.tsx.

**생성 파일:** backend/tests/test_review_followups.py; frontend/e2e/review-followups.spec.ts. 새 migration 이름은 review_followups다.

**인터페이스:** POST /api/reviews/{id}/follow-ups는 new_job_id/reason/expected_revision을 받고 새 ReviewDTO를201로 반환한다. Review.previous_review_id는 nullable unique다. 상세 응답은 권한 있는 previous/next 요청의 ID만 제공한다.

- [x] **1. 연결 조건 고정:** test_changes_followup_supersedes_previous, test_rejected_followup_keeps_original, test_approved_followup_rejected, test_foreign_job_hidden, test_git_identity_and_zip_lineage_enforced, test_two_followups_one_winner, test_approval_not_carried_forward를 작성한다.
- [x] **2. 실패 확인:** uv run pytest backend/tests/test_review_followups.py -q.
- [x] **3. 서버 구현:** 이전 상태는 rejected/changes_requested, 새 작업은 요청자 소유·COMPLETED·같거나 이후 생성 시각이어야 한다. Git 정규 URL/ZIP 계보를 검사한다. changes_requested는 withdrawn/superseded로 닫고 새 pending/waiting을 같은 트랜잭션에서 만든다. 이전 결정·담당은 복제하지 않는다. 기존 job_id unique와 previous_review_id unique로 중복을 차단한다.
- [x] **4. UI 연결:** '설명 보충'은 C2 respond로, '수정본 검사'는 B1의 원본 계보로 이동한다. 새 검사 완료 뒤 후속 요청을 만들며 이전/새 요청 양방향 링크와 각 content_hash를 보여준다. 중복409는 만들어진 새 요청으로 안내한다.
- [ ] **5. PR:** SQLite/PostgreSQL 중복 생성·다른 소스·coverage 미완료 승인 차단과 review-followups E2E를 검증한다. 이전 반려/보완 대기/새 요청 이미지와 함께 feat: link rescans to follow up reviews로 커밋·PR을 만든다.

**완료:** F10 전체. 기존 작업·검토 기록은 삭제하지 않는다.


C3 구현 기록: previous_review_id nullable unique와 기존 job_id unique를 유지하는 선형 review_followups migration을 추가한다. 반려 원본은 revision을 포함한 저장 기록을 그대로 두고 no-op CAS로 잠근다. 보완 대기는 withdrawn/superseded로 닫고 새 pending/waiting 및 공개 이력·감사를 같은 트랜잭션에 기록한다. 새 요청은 담당·결정·승인·예외를 복사하지 않는다.

알림 결정: 보완 대기 대체는 이전 담당자에게 기존 review.withdrawn 업데이트와 새 자격 검토자에게 review.requested를 함께 전달한다. 두 전달의 수신자 합집합을 한 번 정렬한 뒤 이벤트별 preference/현재 권한/자기 수신 제외를 적용한다. 같은 검토자가 서로 다른 두 업무 알림을 받는 것은 의도된 동작이며 같은 이벤트만 중복 제거한다. 반려 원본에는 가상의 철회 알림을 만들지 않는다.

UI는 B1의 기존 from/mode 재검사 경로와 원본 계보를 사용한다. 새 검사에서 원본 검토를 조회하여 후속 요청을 만들고, 양방향 요청 링크·각 content_hash를 표시한다. C2의 공통 폼과 강한 제출 receipt, 403 전체 초안 flush, 권위 있는409 읽기 전용 보존 및 GET 한 번의 불명확한 저장 확인을 재사용한다. 링크 ID와 해시는 권한을 함께 검사한다. 검증 및 화면 증거는 task-8-report에 기록하며 C3 PR·독립 검토·병합은 컨트롤러가 처리한다.
