# 만료 알림과 교체 준비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 현재 요청은 설계·플랜 작성이며 이 문서 자체가 제품 구현 시작 지시는 아니다.

**Goal:** F07의 키·예외 만료 알림과 실제 관리 화면까지의 동선을 제공한다.

**Architecture:** 검사 중심 알림을 typed target으로 먼저 일반화한다. 만료 감지는 별도 CLI/CronJob에서 수행하고 DB unique와 수신자 sequence로 원자적으로 전달한다. 키 교체는 신규 발급과 기존 키 폐기를 분리한다.

**Tech Stack:** Python >=3.12, Typer 0.27.1, FastAPI 0.141.1, SQLAlchemy >=2.0,<3, Alembic >=1.13,<2; Kubernetes CronJob, React 19.2.8, 기존 알림함.

**Spec:** [상세 설계7장](../specs/2026-11-16-convenience-design.md).

## Global Constraints

- Notification.job_id를 nullable로만 바꾸고 끝내지 않는다. 목록·개수·변경·이동·권한·정리를 모두 일반화한다.
- 수신자 sequence·읽음 경계·90일 보존과 기존 검사/검토 알림 계약을 유지한다.
- D7/D1/만료 후24시간 단계 중 한 실행에서 가장 긴급한 하나만 발행한다.
- batch_size=500, max_batches=20, 최대10,000건 후보, 매시5분 UTC, 실행10분 제한이다.
- AAG_EXPIRY_REMINDERS_ENABLED는 새 감지만 제어한다. 기존 typed 알림 조회는 flag off에서도 지원한다.

## Review Focus

1. Job join 제거 후 계정·예외 권한이 개수에서 누출되지 않는가 → D1 공통 predicate.
2. 동시에 실행되거나 중단 후 다시 실행되어도 중복이 없는가 → D2 unique/sequence.
3. 수신 거부·발행 완료 후보가 앞부분을 차지해 뒤 대상이 영원히 누락되지 않는가 → D2 keyset/anti-join.
4. 작업 지연 후 D7/D1/expired가 한꺼번에 쌓이지 않는가 → D2 시간 경계.
5. 교체 준비가 기존 키를 먼저 폐기하거나 새 토큰을 저장하지 않는가 → D3 발급/폐기 분리.

## D1 typed target 알림 기반

**수정 파일:** backend/aag/models.py, backend/aag/notifications.py, backend/aag/routes_notifications.py; frontend/src/notifications.tsx, frontend/src/pages/Notifications.tsx, frontend/src/pages/Integrations.tsx, frontend/src/pages/Admin.tsx.

**생성 파일:** backend/aag/notification_targets.py; backend/tests/test_notification_targets.py; frontend/e2e/notification-targets.spec.ts. 새 migration 이름은 notification_targets다.

**인터페이스:** emit_resource_notification(s, kind, resource_type, resource_id, recipients, event_key). target visibility/label/href는 registry에서만 만든다. 기존 emit_notification은 scan/review adapter로 유지한다. DTO의 기존 source/href와 새 resource_type/resource_id를 함께 반환한다.

- [ ] **1. 마이그레이션·권한 고정:** test_old_scan_notifications_backfill, test_key_notification_owner_only, test_exception_notification_requires_current_admin_creator, test_count_list_mutation_share_visibility, test_nonjob_notifications_no_fake_job, test_read_all_sequence_preserved를 작성한다.
- [ ] **2. 실패 확인:** uv run pytest backend/tests/test_notification_targets.py -q.
- [ ] **3. 데이터·registry 구현:** resource_type/resource_id를 추가하고 job_id를 nullable로 변경한다. scan은resource_id=job_id/review_id 없음, review는resource_id=review_id/job_id 있음, key/exception은job_id/review_id 없음의 CHECK를 둔다. 존재·관계는 생성 시 검증하며 기존 kind/review_id로 backfill한다. credentials/exceptions preference·category를 추가한다.
- [ ] **4. 공통 조회 구현:** 기존 Job inner join 대신 resource별 EXISTS/union predicate를 사용한다. 목록·unread count·read-all·단건 mutation에 같은 가시성 함수를 적용한다. 과거 알림은 폐기 상태를 표시하며 읽을 수 있지만 대상 소유권·현재 역할은 계속 확인한다. 삭제된 대상은 숨긴다.
- [ ] **5. 화면·이동 연결:** 키/예외 유형·안전한 이름·현재 상태를 표시한다. /api-keys?key=ID 및 /admin?tab=allowlist&exception=ID에서 해당 항목을 선택하되 권한 확인 전에 데이터를 보여주지 않는다. query가 무효면 일반 목록과 찾을 수 없음 안내를 제공한다.
- [ ] **6. PR:** SQLite/PostgreSQL migration, 기존 알림 snapshot/race 회귀, target E2E와 계정 전환을 검증한다. 검사/키/예외 혼합 알림의 PC dark/light·모바일 이미지를 포함해 feat: support typed notification resources로 커밋·PR을 만든다.

**완료:** F07 기반. 기존 알림 소비자는 source/href를 계속 사용할 수 있다.

**D1 구현 결정(2026-11-17):** 기존 키 목록500건·예외 목록1,000건 제한 밖의 유효 대상도 선택할 수 있어야 한다. 기존 GET의 선택적 key/exception query로 정확한 대상 하나만 현재 권한으로 조회하여 일반 목록 뒤에 추가한다(최대501/1,001건). 기본 응답 형태와 제한은 유지하며, 다른 소유자의 키·삭제된 대상·관리 권한 상실은 추가 데이터를 노출하지 않는다. 이를 위해 routes_identity.py와 routes_admin.py를 D1 수정 범위에 포함한다.

## D2 만료 감지와 운영 확인

**수정 파일:** backend/aag/cli.py, backend/aag/config.py, backend/aag/models.py, backend/aag/routes_admin.py; frontend/src/pages/Admin.tsx; deploy/k8s/base/kustomization.yaml; docs/src/content/docs/guides/notifications.md, docs/src/content/docs/operations/deployment.md.

**생성 파일:** backend/aag/expiration_reminders.py; deploy/k8s/base/expiration-reminders.yaml; backend/tests/test_expiration_reminders.py; frontend/e2e/expiration-reminders.spec.ts. 새 migration 이름은 maintenance_runs다.

**인터페이스:** due_stage(expires_at: float, now: float) -> Literal['7d','1d','expired'] | None. emit_due_expirations(db, *, now, batch_size=500, max_batches=20, dry_run=False) -> ReminderRunResult. CLI aag remind-expirations. 관리자 운영 응답에 마지막 실행 집계만 추가한다.

- [ ] **1. 시각·중복 고정:** test_7d_1d_exact_boundaries, test_expired_24h_cutoff, test_catchup_only_most_urgent, test_two_runs_one_delivery, test_optout_and_revocation_not_candidates, test_later_batches_not_starved, test_dry_run_writes_nothing을 작성한다.
- [ ] **2. 실패 확인:** uv run pytest backend/tests/test_expiration_reminders.py -q.
- [ ] **3. 감지 구현:** DB 시각을 한 실행에 고정하고 expires_at/id keyset 및 recipient/event_key anti-join으로 처리한다. 폐기·비활성·수신 거부를 후보 query에서 제외하고, 트랜잭션 안에서 다시 대상·수신자를 검사한다. 삽입 충돌은 중복 발행으로 세지 않는다. --dry-run은 알림·sequence·MaintenanceRun까지 모든 쓰기를 하지 않는다.
- [ ] **4. 운영 구현:** MaintenanceRun에 실행·성공/실패·집계·안전한 error_code를90일 저장하고 일반 실행에서 만료 이력을 최대1,000개씩 정리한다. 전역 실패는 비정상 exit code, 개별 실패는 건수와 재시도 가능한 대상 상태를 남긴다. CronJob은 기존 이미지·DB secret을 참조하고 Forbid/10분 제한·이력1/3을 설정한다. 감지 활성화 뒤2시간 무성공은 관리자 화면에 지연으로 표시한다.
- [ ] **5. 검증·PR:**1만 건 초과 synthetic 후보, 작업 겹침·중간 실패·재실행·시간 변경, 옵트아웃을 SQLite/PostgreSQL에서 검증한다. Cron YAML과 dry-run 안내, 만료 알림·운영 지연 이미지를 포함해 feat: emit bounded expiration reminders로 커밋·PR을 만든다.

**완료:** F07 자동 감지. 발송 성공·사용자 확인을 혼동하지 않고 in-app 저장 건수로 보고한다.

## D3 키 교체 준비와 예외 재검토 동선

**수정 파일:** frontend/src/pages/Integrations.tsx, frontend/src/pages/Admin.tsx; docs/src/content/docs/guides/integrations.md, docs/src/content/docs/guides/scanning.md.

**생성 파일:** frontend/e2e/key-replacement.spec.ts. 서버의 기존 키 발급·폐기·예외 API를 재사용한다.

**인터페이스:** '새 키로 교체 준비'는 기존 name/scopes만 발급 폼에 채운다. 새 키 발급이 성공해도 이전 key_id는 유지한다. A1 account-bound 송신을 사용하고 토큰은 A2 초안 대상에서 제외한다.

- [ ] **1. 브라우저 실패 사례:** test_replacement_keeps_old_key_active, test_new_key_shown_once_not_in_storage, test_issuance_disabled_not_bypassed, test_old_key_revocation_requires_reason, test_exception_changed_hash_not_reused를 작성하고 미구현 실패를 확인한다.
- [ ] **2. UI 구현:** 새 키 원문을 한 번 보여주고 복사·안전한 저장 안내를 제공한다. 도구 반영 후 사용자가 기존 키 폐기를 별도로 실행하게 한다. 네트워크 오류 시 발급 성공 여부 확인 없이 자동 재발급하지 않는다. 예외는 기존 hash/fingerprint 확인과 해당 소스 재검사·새 예외 검토로 연결한다.
- [ ] **3. PR:** 기존 발급/폐기 권한 회귀와 key-replacement E2E를 검증한다. 교체 전후·비활성 발급·예외 재검토 이미지를 포함해 feat: guide key replacement and exception revalidation로 커밋·PR을 만든다.

**완료:** F07 전체. 자동 연장이나 자동 폐기는 추가하지 않는다.
