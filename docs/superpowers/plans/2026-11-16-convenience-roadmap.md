# Agent Admission Gate 편의기능 실행 플랜

작성일: 2026-11-16 KST · 기준 main: 5ff646d3c0fed462bce5086fcc956caa057749ff · 상태: 14개 기능 PR 병합·최종 검토 수정 추적

앞서 정리한 10개 기능을 5개 작업 묶음과 14개 독립 PR로 구현한다. 이 문서는 구현 순서와 추적표이며 화면·API·권한·데이터의 기준은 [상세 설계안](../specs/2026-11-16-convenience-design.md)이다. 원래 설계·플랜 제안은 승인된 순서대로 구현됐다. 현재 전달과 전체 검토 수정은 아래와 영구 전달 기록을 따른다.

## 문서 구성

| 묶음 | 기능 | 상세 플랜 |
| --- | --- | --- |
| A 사용자 작업 보존 | 초안·목록 복원·저장된 보기·SSO 복귀 | [A 플랜](2026-11-16-convenience-a-workspace.md) |
| B 검사 반복과 비교 | 재검사·대상별 이력·결과 비교 | [B 플랜](2026-11-16-convenience-b-scans.md) |
| C 사람의 검토 | 담당자·철회·보완·후속 검토 | [C 플랜](2026-11-16-convenience-c-reviews.md) |
| D 만료 알림 | typed 알림·정기 감지·키 교체 준비 | [D 플랜](2026-11-16-convenience-d-expiry.md) |
| E 검색과 공유 | 발견 링크·읽기용 요약·통합 검색 | [E 플랜](2026-11-16-convenience-e-search-share.md) |

플랜의 파일·API·테스트명은 원래 책임 배분 기록이다. 실제 파일 배분 조정과 완료 근거는 각 플랜과 전달 기록에 명시한다. Alembic revision 파일명만 생성 도구에서 확정하고, 나머지 책임·인터페이스는 각 플랜에 적었다.

## 구현 순서와 의존성

| 순서 | PR 단위 | 범위 | 선행 작업 | 난이도 | 검증 핵심 |
| --- | --- | --- | --- | --- | --- |
| 1 | A1 | 세션 복귀·계정 바인딩 | 없음 | 중 | return_to 검증, 늦은401, 다른 계정 저장 차단 |
| 2 | A2 | 초안·이탈 보호 | A1 | 중 | 두 dirty 폼, quota, 로그아웃/복구 |
| 3 | A3 | 목록 복원·저장 보기 | A1 | 중 | query·페이지·스크롤, default 경합 |
| 4 | B1 (#19) | 조건 재사용·동일 커밋 | A1, A2 | 중 | checkout 전 실패 재시도, 소유권, ZIP 재업로드 |
| 5 | E1 (#20) | 발견 링크·요약·인쇄 | A1 | 중 | 중복 fingerprint, API 키 검토 정보 제외 |
| 6 | C1 | 담당자·검토 이력 | A1, A3 | 높음 | claim/결정 경합, reviewer/admin 직교 |
| 7 | C2 | 철회·보완·알림 | A2, C1 | 높음 | legacy 우회, 판정 불변, 초안 충돌 |
| 8 | C3 | 수정본의 후속 검토 | B1, C2 | 높음 | lineage, 후속 요청 unique, 승인 비전파 |
| 9 | B2 | 대상별 검사 이력 | B1, A3 | 중 | 다른 owner 차단, ZIP 계보, 페이지 |
| 10 | B3 | 결과 비교 | B2 | 높음 | 줄 이동·정책·coverage·suppression 차이 |
| 11 | E2 (#26) | 통합 검색·색인 | E1, C1 | 높음 | 권한 선적용, backfill, cursor, 실제 query plan |
| 12 | D1 | 알림 대상 일반화 | C2 | 높음 | Job 없는 대상, 개수·목록·변경의 같은 권한 |
| 13 | D2 | 만료 감지·운영 상태 | D1 | 중 | 시간 경계, 중복·중단·대량 후보 |
| 14 | D3 | 키 교체·예외 재검토 | D1, D2 | 중 | 원문 비저장, 이전 키 유지, 해시 범위 |

이 순서는 우선순위 제안이다. 독립 묶음도 실제 구현은 작은 PR 단위로 끝내고 다음으로 넘어간다. 한 거대 PR에서 스키마·인증·검토·알림을 동시에 변경하지 않는다. 일정은 운영 데이터량·SSO 검증 환경·PostgreSQL 제공 여부를 확인한 뒤 산정하며 근거 없는 일수는 약속하지 않는다.

## 구현 진행 현황

| PR 단위 | 구현 PR | 현재 상태 | 확인된 검증 |
| --- | --- | --- | --- |
| A1 로그인 복귀·계정 바인딩 | [#16](https://github.com/wontaeJeong/agent-admission-gate/pull/16) | 독립 검토·최종 CI 5개 성공 후 bf78cf6 병합 | tested bb6ccc7 · [CI 43902761944](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/43902761944) |
| A2 초안·이탈 보호 | [#17](https://github.com/wontaeJeong/agent-admission-gate/pull/17) | 독립 검토·최종 CI 5개 성공 후 bb467e5 병합 | tested 3fda6a5 · [CI 44003161915](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44003161915) |
| A3 목록 복귀·저장된 보기 | [#18](https://github.com/wontaeJeong/agent-admission-gate/pull/18) | 독립 검토·최종 CI 5개 성공 후 c38457b 병합 | tested c2d2e50 · [CI 44011709856](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44011709856) |
| B1 조건 재사용·동일 커밋 | [#19](https://github.com/wontaeJeong/agent-admission-gate/pull/19) | 독립 검토·최종 CI 5개 성공 후 4847eac 병합 | tested d060b12 · [CI 44016358266](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44016358266) |
| E1 발견 링크·요약 | [#20](https://github.com/wontaeJeong/agent-admission-gate/pull/20) | 독립 검토·최종 CI 5개 성공 후 bdf902e 병합 | tested c765828 · [CI 44022208395](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44022208395) |
| C1 담당자·업무 이력 | [#21](https://github.com/wontaeJeong/agent-admission-gate/pull/21) | 독립 검토·최종 CI 5개 성공 후 79def31 병합 | tested 58d907b · [CI 44029730790](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44029730790) |
| C2 철회·보완 | [#22](https://github.com/wontaeJeong/agent-admission-gate/pull/22) | 독립 검토·최종 CI 5개 성공 후 2b0e6df 병합 | tested e1e5a60 · [CI 44033776611](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44033776611) |
| C3 수정본 후속 검토 | [#23](https://github.com/wontaeJeong/agent-admission-gate/pull/23) | 독립 검토·최종 CI 5개 성공 후 57fdaf2 병합 | tested 20bce8b · [CI 44038309050](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44038309050) |
| B2 동일 대상 이력 | [#24](https://github.com/wontaeJeong/agent-admission-gate/pull/24) | 독립 검토·최종 CI 5개 성공 후 9350c98 병합 | tested 4494c0a · [CI 44042767053](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44042767053) |
| B3 저장 결과 비교 | [#25](https://github.com/wontaeJeong/agent-admission-gate/pull/25) | 독립 검토·최종 CI 5개 성공 후 425e6d4 병합 | tested b2b261c · [CI 44047254634](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44047254634) |
| E2 권한 범위 통합 검색 | [#26](https://github.com/wontaeJeong/agent-admission-gate/pull/26) | 독립 검토·최종 CI 5개 성공 후 f4dfe7c 병합 | tested d5846d1 · [CI 44053116094](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44053116094) |
| D1 알림 대상 일반화 | [#27](https://github.com/wontaeJeong/agent-admission-gate/pull/27) | 독립 검토·최종 CI 5개 성공 후 0882fe5 병합 | tested baa70b7 · [CI 44060107884](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44060107884) |
| D2 만료 감지·운영 상태 | [#28](https://github.com/wontaeJeong/agent-admission-gate/pull/28) | 독립 검토·최종 CI 5개 성공 후 6f84d0b 병합 | tested caec1dc · [CI 44068553899](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44068553899) |
| D3 키 교체·예외 재검토 | [#29](https://github.com/wontaeJeong/agent-admission-gate/pull/29) | 독립 검토·최종 CI 5개 성공 후 0172837 병합 | tested a3cc0a9 · [CI 44076378186](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44076378186) |

14개 기능 PR #16–#29가 모두 병합됐다. [전달 기록](../../engineering/2026-11-17-convenience-roadmap-delivery.md)에 정확한 head·CI·실제 로컬 검증·화면·원래 판단 22건과 최종 판단 2건(총 24건)의 비용·6개 Minor를 보존한다. 전체 검토 I1(생성 DTO 누락 복구)/I2(전달 추적)의 최종 수정은 별도 PR의 독립 범위 재검토·정확한 head 필수 CI 성공이 병합 조건이다. 운영 배포·migration·기능 활성화·실제 Cron 완료를 뜻하지 않는다.

## 10개 기능 추적표

| 기능 | 구현 PR | 사용자가 확인할 결과 |
| --- | --- | --- |
| F01 재검사 | B1 (#19) | 이전 URL/ref/profile 재입력 없이 latest/snapshot을 구분해 다시 제출 |
| F02 초안 | A2, C2 (#17, #22) | 새로고침·인증 만료·탭 이동 뒤 같은 계정 초안 복구 |
| F03 목록·저장 보기 | A3, C1 (#18, #21) | 같은 조건·페이지·위치로 복귀, 자주 쓰는 보기 저장 |
| F04 SSO 복귀 | A1, E1 (#16, #20) | 로그인 뒤 공유받은 정확한 발견 항목으로 이동 |
| F05 이력·비교 | B2, B3 (#24, #25) | 같은 대상의 변화와 비교 가능한 범위·한계 확인 |
| F06 담당자 | C1, C2 (#21, #22) | 내 담당·미배정·검토 중 상태와 중복 작업 방지 |
| F07 만료 알림 | D1, D2, D3 (#27, #28, #29) | 만료 전 알림에서 실제 키 교체·예외 재검토로 이동 |
| F08 검색 | E2 (#26) | 작업ID·CVE·규칙·경로·검토를 허용된 범위에서 찾기 |
| F09 공유·요약 | E1 (#20) | 발견 직접 링크, 공개 판정 요약 복사·다운로드·인쇄 |
| F10 검토 흐름 | C2, C3 (#22, #23) | 철회·보완·수정본 재요청을 원본 이력과 함께 추적 |

## 착수 시 확인할 기준

- 현재 main과 이 문서의 기준 SHA를 비교한다. 같은 기능이 먼저 구현됐으면 중복 개발 대신 해당 항목을 실제 PR·테스트에 연결한다.
- 저장소 AGENTS.md와 DESIGN.md가 우선한다. 로컬의 미완료 변경은 보존하고 독립 브랜치/작업 공간에서 구현한다.
- Python·프런트 버전과 잠금파일을 그대로 사용한다. 기능 구현과 무관한 대규모 리팩터링·업그레이드를 섞지 않는다.
- API schema·authorization·feature flag는 서버가 기준이다. UI 비노출만으로 권한·비활성 기능을 막지 않는다.
- 이번 문서의 수치·접근 방식은 검토 가능한 제안이다. 변경할 때는 설계와 해당 실행 플랜을 함께 갱신한다.

## 마이그레이션과 기능 활성화

| 단계 | 조치 | 되돌리기 기준 |
| --- | --- | --- |
| 스키마 준비 | nullable/additive 열·테이블·인덱스 추가, 한 Alembic head 유지 | 아직 새 데이터를 쓰지 않았을 때만 검증된 downgrade 사용 |
| 기존 데이터 보정 | 기존 state는 /, Job root=self, 미결 검토 waiting, 알림 target backfill | 원본 판정·결정·소유권은 변경하지 않음 |
| 읽기 호환 배포 | 확장 검토 상태·typed 알림을 읽을 수 있는 API/UI 배포 | 기존 데이터도 계속 조회 가능한 호환 버전 유지 |
| 기능별 쓰기 활성화 | 검토·검색·만료 flag를 stg에서 검증 후 prod 반영 | 신규 진입/감지만 끄고 기존 기록의 안전한 조회 유지 |
| 정기 작업 배포 | DB secret을 사용하는 제한된 CronJob, dry-run 확인 | 감지 중지·키/예외 원본은 변경하지 않음 |

review 상태를 이해하지 못하는 구형 decision handler로 돌아가거나, 새 이력·알림을 지우는 downgrade를 일반 롤백으로 사용하지 않는다. profile/policy/engine 출처의 과거 미보고 값을 임의로 채우지 않는다.

## 검증과 PR 완료 조건

각 작업은 상세 플랜의 실패 재현→최소 구현→해당 검증→커밋→독립 리뷰 순으로 끝낸다. 제품 변경 PR의 공통 검증 명령은 아래와 같고 관련 없는 검사를 습관적으로 반복하지 않는다.

~~~bash
uv run pytest -q
uv run ruff check backend
uv run ruff format --check backend
cd frontend
npm run build
npm test
npm run format:check
npm run test:e2e
cd ../docs
npm run build
~~~

마이그레이션은 격리 DB에서 upgrade/check/downgrade/upgrade를 실행한다. 운영 데이터를 되돌려 검사하지 않는다. claim·follow-up·default view·알림 중복은 SQLite 결과만으로 PostgreSQL 동작을 주장하지 않고 실제 PostgreSQL에서도 실행한다. 실패·생략한 검증은 PR에 이유와 함께 적는다.

UI PR은 합성 데이터로 desktop dark/light·mobile 및 핵심 정상/오류/빈 상태 이미지를 첨부한다. 키 원문·개인정보·사내 주소는 캡처에 넣지 않는다. 화면을 바꾸지 않는 기반 PR에는 불필요한 스크린샷을 만들지 않는다.

## 설계 자체의 검토 결과

독립 구현 가능성 검토에서 다음 네 계약을 구체화했다.

1. API 키 summary의 검토 상태·결정 사유를 제외해 기존 경계를 유지한다.
2. changes_requested에서 legacy claim/decision도 차단하고 stale release가 보완 대기를 보존한다.
3. 폼을 연 계정의 헤더를 모든 새 사용자 콘텐츠 제출에 적용한다.
4. Job에 요청 target_commit/rerun_mode를 기록해 checkout 전 실패 후에도 snapshot 의도를 보존한다.

문서 검토는 제품 구현·테스트 완료를 의미하지 않는다. 실제 완료 여부는 위 추적표를 구현 PR·검증 결과로 갱신하며 관리한다.
