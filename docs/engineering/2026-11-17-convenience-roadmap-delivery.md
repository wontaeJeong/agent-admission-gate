# 편의기능 로드맵 전달 기록

기록일: 2026-11-17. A1 → A2 → A3 → B1 → E1 → C1 → C2 → C3 → B2 → B3 → E2 → D1 → D2 → D3의 14개 기능 PR #16–#29가 독립 검토와 최종 head 필수 CI를 거쳐 병합됐다. 기능별 실행 보고서 14개, 병합·CI 확인 기록, 전체 범위 검토를 공개 가능한 근거로 정리한다. 임시 실행 파일 없이 아래 PR·커밋·CI·테스트·화면 증거에서 확인할 수 있다.

전체 검토 범위는 원래 기준 a2b83c12791782a1cd4bd2b0c46fb3d18609dc4c부터 a3cc0a927eac7f3bc1875860f280f06a5df0ad6a까지다. PR #29 squash 01728376b14f795223553568bf8bd7c9eab7403c는 검토 head와 같은 제품 트리다. 기능 PR 병합과 전체 검토 I1/I2의 최종 수정은 구분한다.

## 14개 기능의 정확한 전달 이력

아래 각 run에서 **backend, web, docs, container(runtime), container(scanners) 5개 job이 success**인 것을 실행 담당자가 확인한 뒤 squash 병합했다. 이전 head의 CI 성공을 대신 사용하지 않았다. 각 squash 트리와 tested head 트리의 일치도 확인했다.

| 순서·기능 | PR | 최종 tested head | squash/merged head | 필수 CI run |
| --- | --- | --- | --- | --- |
| 1 · A1 로그인 복귀·계정 바인딩 | [#16](https://github.com/wontaeJeong/agent-admission-gate/pull/16) | `bb6ccc7392eafd6d42dd63f4a0f750102a5ee597` | `bf78cf61a9c236eabd37f9c2354872267d7da509` | [43902761944](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/43902761944) |
| 2 · A2 초안·이탈 보호 | [#17](https://github.com/wontaeJeong/agent-admission-gate/pull/17) | `3fda6a5bfba340a73ab1589ce8ae56db0ecd6d55` | `bb467e5785bb6d077bf3bb18812eed18a6c97596` | [44003161915](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44003161915) |
| 3 · A3 목록 복귀·저장된 보기 | [#18](https://github.com/wontaeJeong/agent-admission-gate/pull/18) | `c2d2e509b701ef1be7252af4a667283d640e1cdf` | `c38457b24f68c9b2679a4fd6e25d9d3dc240a26c` | [44011709856](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44011709856) |
| 4 · B1 조건 재사용·동일 커밋 | [#19](https://github.com/wontaeJeong/agent-admission-gate/pull/19) | `d060b12d6a5675a78a181042870b67ba899719bb` | `4847eac7b8f1da6e6208e6872338f073811463dc` | [44016358266](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44016358266) |
| 5 · E1 발견 링크·요약 | [#20](https://github.com/wontaeJeong/agent-admission-gate/pull/20) | `c765828b324859c34061efca187f90913aed2091` | `bdf902e611d6447b2a0c8ac394c5e8b380cf0814` | [44022208395](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44022208395) |
| 6 · C1 담당자·업무 이력 | [#21](https://github.com/wontaeJeong/agent-admission-gate/pull/21) | `58d907bf8afdbdfc76f6a81e93398e6481e2f5ce` | `79def319421151658878d7d2f6f4dd29f062c43c` | [44029730790](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44029730790) |
| 7 · C2 철회·보완 | [#22](https://github.com/wontaeJeong/agent-admission-gate/pull/22) | `e1e5a602e3fd6cae446886e30d1eeff49878d93a` | `2b0e6df8cef85ada616548e229befc16d840a90b` | [44033776611](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44033776611) |
| 8 · C3 수정본 후속 검토 | [#23](https://github.com/wontaeJeong/agent-admission-gate/pull/23) | `20bce8bcced9dd60dd0db3370f43e99786822d7b` | `57fdaf24d3ac8f22ab6003901efd3fd63dbcaf45` | [44038309050](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44038309050) |
| 9 · B2 동일 대상 이력 | [#24](https://github.com/wontaeJeong/agent-admission-gate/pull/24) | `4494c0a22ebcbd92a60f4f7f70d2dd2e79315dab` | `9350c98e6cff62257886b7f485a93126127abb62` | [44042767053](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44042767053) |
| 10 · B3 저장 결과 비교 | [#25](https://github.com/wontaeJeong/agent-admission-gate/pull/25) | `b2b261c0e6fdf69175383de3f0dcc5e4e2dd97b0` | `425e6d4282e8c51463d359dfba23a5e2a11d7033` | [44047254634](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44047254634) |
| 11 · E2 권한 범위 통합 검색 | [#26](https://github.com/wontaeJeong/agent-admission-gate/pull/26) | `d5846d10ffda840600670c35d859a72092160fea` | `f4dfe7c8a264ab7882363c66c40b5572b61f3b0b` | [44053116094](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44053116094) |
| 12 · D1 알림 대상 일반화 | [#27](https://github.com/wontaeJeong/agent-admission-gate/pull/27) | `baa70b72cfe3332a049f4294ca9ecbc56fee761b` | `0882fe5f9d8e31dd6bf9f28ee7ba8b35346086d8` | [44060107884](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44060107884) |
| 13 · D2 만료 감지·운영 상태 | [#28](https://github.com/wontaeJeong/agent-admission-gate/pull/28) | `caec1dc2c66217bb78fb04b363642c9944a4119b` | `6f84d0b399a87a70825df8b09d3a4443cf0e3a05` | [44068553899](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44068553899) |
| 14 · D3 키 교체·예외 재검토 | [#29](https://github.com/wontaeJeong/agent-admission-gate/pull/29) | `a3cc0a927eac7f3bc1875860f280f06a5df0ad6a` | `01728376b14f795223553568bf8bd7c9eab7403c` | [44076378186](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44076378186) |

## 로컬 검증 범위

숫자는 각 기능의 당시 실행 결과이며 서로 더해 고유 테스트 총수로 해석하지 않는다. 이번 문서 수정에서 다시 실행한 결과도 아니다. 아래에서 broad 이후 집중 수정 검증을 구분했고, 정확한 최종 전체 검증은 위 CI를 따른다.

- **A1 로그인 복귀·계정 바인딩:** backend 172·unit 65·전체 browser 50·build/format/docs, SQLite/PostgreSQL migration 왕복.
- **A2 초안·이탈 보호:** 최종 unit 87·전체 browser 89·build/format/docs. frontend 전용 수정으로 backend 재실행 없음. monotonic receipt 재수정 뒤 집중 6개 포함.
- **A3 목록 복귀·저장된 보기:** backend 183은 frontend 최종 수정 전. 최종 unit 99·집중 browser 71·build/format/docs. 앞선 전체 browser 105는 최종 URL/history 수정 전.
- **B1 조건 재사용·동일 커밋:** backend 212·unit 99·전체 browser 116 이후 메타데이터 한/영 문구 수정. 수정 뒤 build/format·집중 browser 1·새 캡처. 두 DB lineage migration.
- **E1 발견 링크·요약:** backend 217은 요약 escape 수정 전, 최종 요약 backend 5. unit 111·목록/공유 browser 26 이후 literal q 수정과 공유 6·build/lint/format/docs. 앞선 전체 browser 120/121의 실제 scroll 실패는 수정 후 집중 26개와 최종 CI로 검증.
- **C1 담당자·업무 이력:** 최종 backend 255·unit 112·전체 browser 129·build/lint/format/docs. 두 DB CAS/migration 및 PostgreSQL admin/decision 교착 RED/GREEN.
- **C2 철회·보완:** 최종 backend 305·unit 112·전체 browser 133·build/lint/format/docs. 두 DB 전이/rollback/migration. browser 자식은 성공했으나 셸 wrapper readonly 변수 오류는 별도 도구 실패로 기록.
- **C3 수정본 후속 검토:** backend 359·unit 112·전체 browser 138·build/lint/format/docs. 두 DB follow-up unique/CAS·동시 HTTP·이벤트/감사/알림 rollback·migration.
- **B2 동일 대상 이력:** backend 374·unit 113·전체 browser 144는 한국어 라벨 수정 전 bundle. 최종 문구 뒤 build/unit/format·집중 browser 6·새 캡처. 두 DB history/권한/URL.
- **B3 저장 결과 비교:** backend 402·unit 113·전체 browser 151·build/lint/format/docs. 두 DB 권한·각 1,000개 결과 유한 처리와 모바일 키보드 스크롤.
- **E2 권한 범위 통합 검색:** backend 429·전체 browser 155는 cursor/독립 review projection/선택 탭 최종 수정 전. 이후 두 DB 집중 backend 31·search browser 4·unit 114·build/lint/format/docs. 합성 10만 발견 측정 포함.
- **D1 알림 대상 일반화:** 최종 backend 467·집중 78·lint/format/docs. backend 권한 수정 전 UI unit 114·전체 browser 159·build/format. 실제 OIDC Actor 약화/persisted 역할 교집합 RED 8개→GREEN.
- **D2 만료 감지·운영 상태:** 최종 backend 538·집중 readonly CLI 15·lint/format/docs. backend 시작 경로 수정 전 UI unit 114·전체 browser 166·build/format. stg/prod Cron render와 두 DB 실험.
- **D3 키 교체·예외 재검토:** 수정 전 backend 538·전체 browser 179·docs/lint. 최종 응답/refresh 수정 뒤 RED 6개→browser 18·unit 114·build/format. 이전 broad 결과를 최종 수정 재실행으로 표시하지 않음.

공통 명령은 루트의 uv run pytest -q --tb=short, uv run ruff check backend, uv run ruff format --check backend, frontend의 npm run build / npm test / npm run format:check / npm run test:e2e, docs의 npm run build다. 관련 범위를 집중 실행한 경우를 위에 구분했다. DB 테스트는 임시 DB/스키마를 소유하고 정리했으며 운영 데이터를 변경하지 않았다. 로컬 scanner 격리는 프로젝트 가상환경의 도구 경로를 사용했다.

## 화면 증거와 실제 검토

합성 데이터와 계정을 사용했다. 토큰·PAT·실 사용자 정보가 없음을 확인했고 D3의 발급 원문은 닫은 후 캡처했다. root 검토자는 대표 desktop dark/light, mobile, 핵심 상태와 오류/빈 상태를 실제로 열어 확인했다. 전체 파생 이미지가 모두 독립 검토됐다는 뜻은 아니다.

| 기능 | 영구 화면 증거 | PR |
| --- | --- | --- |
| A1 | [convenience-a1](screenshots/convenience-a1/) | [#16](https://github.com/wontaeJeong/agent-admission-gate/pull/16) |
| A2 | [convenience-a2](screenshots/convenience-a2/) | [#17](https://github.com/wontaeJeong/agent-admission-gate/pull/17) |
| A3 | [convenience-a3](screenshots/convenience-a3/) | [#18](https://github.com/wontaeJeong/agent-admission-gate/pull/18) |
| B1 | [convenience-b1](screenshots/convenience-b1/) | [#19](https://github.com/wontaeJeong/agent-admission-gate/pull/19) |
| E1 | [convenience-e1](screenshots/convenience-e1/) | [#20](https://github.com/wontaeJeong/agent-admission-gate/pull/20) |
| C1 | [convenience-c1](screenshots/convenience-c1/) | [#21](https://github.com/wontaeJeong/agent-admission-gate/pull/21) |
| C2 | [convenience-c2](screenshots/convenience-c2/) | [#22](https://github.com/wontaeJeong/agent-admission-gate/pull/22) |
| C3 | [convenience-c3](screenshots/convenience-c3/) | [#23](https://github.com/wontaeJeong/agent-admission-gate/pull/23) |
| B2 | [convenience-b2](screenshots/convenience-b2/) | [#24](https://github.com/wontaeJeong/agent-admission-gate/pull/24) |
| B3 | [convenience-b3](screenshots/convenience-b3/) | [#25](https://github.com/wontaeJeong/agent-admission-gate/pull/25) |
| E2 | [convenience-e2](screenshots/convenience-e2/) | [#26](https://github.com/wontaeJeong/agent-admission-gate/pull/26) |
| D1 | [convenience-d1](screenshots/convenience-d1/) | [#27](https://github.com/wontaeJeong/agent-admission-gate/pull/27) |
| D2 | [convenience-d2](screenshots/convenience-d2/) | [#28](https://github.com/wontaeJeong/agent-admission-gate/pull/28) |
| D3 | [convenience-d3](screenshots/convenience-d3/) | [#29](https://github.com/wontaeJeong/agent-admission-gate/pull/29) |

C1/C2/C3는 각각 대표 10개를 검토했고 추가 색상/크기 변형 전체를 검토했다고 주장하지 않는다. B3/D1/D2 각 10개, D3 9개, A3 5개, B1 7개, E1 9개를 확인했다. A2 기존 7개와 수정 6개도 검토했다. 새 최종 수정 캡처는 AAG_CAPTURE_EVIDENCE=1에서만 생성한다.

## 최종 전체 검토와 이번 수정

최초 전체 검토는 **Critical 0, Important 2, 비차단 Minor 5, 수정 후 합류 가능**이었다. 권한/트랜잭션·fail-closed·22개 판단을 함께 검토했으며 14개 기능 검토를 반복한 것은 아니다.

- **I1 — 성공 HTTP의 생성 DTO 누락:** 기존 api()는 성공 JSON 해석 실패를 빈 객체로 바꿔 새 검사/재검사/검토 요청/C3 후속 요청/새 게시글이 초안을 지우고 undefined 대상으로 이동할 수 있었다. 이번 수정은 본문 해석 실패를 불명확한 결과로 처리하고 생성 ID 확인 뒤에만 강한 receipt 초기화·이동을 허용한다. 명시적인 HTTP 204/205 무본문과 text 응답은 유지한다. 새 검토/게시글에도 명시적인 현재 리소스 GET을 제공하고 그 전 재제출을 막는다. polling이 새 검토를 발견해도 입력은 유지한다. 필수 ID가 누락된 GET 응답은 확인 완료로 처리하지 않는다. 검토 상태의 잘못된 falsy 값에 대한 잔여 처리는 아래 M6에 남긴다. 게시글의 확인 GET은 주변 현재 목록도 갱신하며 새 입력을 지우지 않는다.
- **I2 — 오래된 전달 추적:** 이 문서와 로드맵·A/B/C/D/E 원본 플랜·요구사항을 14개 실제 병합으로 맞췄다. ignored 실행 파일만을 근거 링크로 쓰지 않는다. 이전 판단/비용·Minor·운영하지 않은 영역을 남긴다.

수정은 [PR #30](https://github.com/wontaeJeong/agent-admission-gate/pull/30), 브랜치는 fix/convenience-final-response-recovery, 기준은 PR #29 squash다. 독립 범위 재검토는 I2를 해결로 확인했고 I1의 초안 손실·undefined 이동을 수정한 뒤 아래 M6만 비차단으로 남겼다. Critical/Important 잔여는 없다. 원래 판단 22건에 최종 잔여 판단과 CI 호환성 판단 각 1건을 추가해 현재 24건이다. **정확한 최종 head 필수 CI 5개 성공이 병합 조건**이며 실제 head·CI run·병합 SHA는 PR #30에 기록한다. 제품 코드는 11e69e5에서 검증한 뒤 같고 이후 변경은 최종 판단의 문서 기록과 기존 브라우저 테스트 기대의 계약 정합화다. 미래 CI/병합 성공을 만들거나 PR #29 검증을 이번 수정의 CI로 대체하지 않는다.

### 최종 CI 호환성 검증

수정 전 [CI 44085112810](https://github.com/wontaeJeong/agent-admission-gate/actions/runs/44085112810)은 browser 198/199 통과(12.5분), 기존 review-revisit.spec.ts의 503 뒤 즉시 버튼 활성화 기대 1개 실패였다. backend·docs·container(runtime)·container(scanners) 4개 job은 성공했다. 승인된 불명확 생성의 명시적 현재 리소스 GET 계약과 충돌하는 테스트 기대이며 인프라 실패가 아니다. 새 포트에서 해당 사례 단독 RED 1개를 재현한 뒤 제품 코드 없이 기대만 정합화했다. 입력 보존·busy·상태 없음 검증을 유지하고, POST 1회·강제 submit 차단·GET 완료 전 비활성·literal null 확인 후 활성화를 검증한다.

수정 후 review-revisit.spec.ts 6개와 creation-recovery.spec.ts 15개가 **21/21 통과(54.2초, retry/skip 없음)**했다. format:check와 변경된 요구사항의 docs 11페이지 build도 통과했다. 이전 로컬 118개 집합에 기존 재방문 테스트를 빠뜨린 원인과 예방은 실패 교훈에 기록했다. 제품 코드·M6·화면 증거는 그대로이며 새 전체 CI 결과를 이 집중 검증으로 대신하지 않는다. 새 정확한 head 필수 CI 성공은 여전히 PR #30 병합 조건이다.

### 최종 수정 재현과 검증

[API 단위 회귀](../../frontend/src/api.test.ts)와 [생성 복구 브라우저 회귀](../../frontend/e2e/creation-recovery.spec.ts)가 근거다. 실제 서버 POST commit 뒤 응답 본문만 empty/truncated/ID 없는 JSON으로 바꿨다. 다섯 소비자 × 세 응답의 15개가 원래 빌드에서 복구 동작 부재로 실패했다. 수정 검증은 입력 보존, undefined 이동 없음, 한 번의 POST, 강제 submit 이벤트의 재전송 차단, 명시적 GET, 실제 생성 리소스로 복구를 확인한다. 지연 응답 도중 새 편집과 잘못된 검증 GET도 포함한다. API 단위는 중단된 body reader의 TypeError, JSON SyntaxError, account-generation 우선, text 및 204/205를 확인한다.

최종 로컬 npm run build·npm test(unit 121/9 files)·npm run format:check 검증이 통과했다. board 목록 일관성 추가 assertion은 RED 1개 후 수정·GREEN 1개(6.0초)를 확인했다. 최종 변경 소스의 집중 browser 118/118(5.8분, retry/skip 없음)이 통과했다. 새 생성 복구 15, D3 18, drafts 39, review changes 4, follow-ups 5, saved views 21, rerun 8, session return 8을 포함한다. 실행은 capture off였고 새 기능 전체 browser의 반복 실행으로 표시하지 않는다. docs build 11페이지와 diff/링크/14개 정확한 전달표 대조도 통과했다. backend/스키마/배포 코드는 이번 수정 대상이 아니며 종전 broad 검증을 재실행했다고 주장하지 않는다.

## 비차단 후속 항목

최초 검토의 다섯 Minor는 이번 수정에 선택적으로 추가하지 않았다. 단 한 번의 최종 범위 재검토에서 발견한 비차단 M6를 추가해 후속 항목은 여섯 개다.

| ID | 제한과 판단 | 후속 종료 조건 |
| --- | --- | --- |
| M1 · A2 | 변경 없는 flush의 saved_at 유지 로직은 정적 검토상 맞지만 hook 수준 회귀가 없다. 확인된 TTL 갱신 버그는 아니다. | 고정 시계로 visibility/pagehide/unmount 반복이 시각을 갱신하지 않고 실제 편집만 갱신함을 hook에서 검증. |
| M2 · B3 | 모든 비교 422에 미연결 ZIP 확인이 표시된다. 다른 owner/source/Git도 안내를 받지만 서버는 계속 거부한다. 권한 우회는 아니다. | 안전한 구조화 오류 코드를 보존하고 unlinked_zip에만 확인을 표시. |
| M3 · B3 | ComparisonFinding의 TypeScript Pick이 실제 projection의 null/primitive 허용보다 엄격해 새 소비자에 잘못된 보장을 준다. | 보수적 projection 타입 또는 서버 정규화, nullable/malformed fixture. |
| M4 · 공통 | 알려진 도구 경고와 예상 부정 stderr가 남았다. green을 warning-free라고 부르지 않는다. | 도구 잡음 별도 정비, 의도된 부정 사례의 실패 계약 유지. |
| M5 · 통합 탐색 | search → detail → summary에서 list context, history → compare 복귀에서 history query가 사라질 수 있다. 기본 jobs fallback/브라우저 Back은 가능하다. | 같은 계정의 검증된 상속 context와 별도 허용 history return URL, 중첩 탐색 회귀. 임의 URL allowlist 확장 금지. |
| M6 · 최종 I1/R1 | 검토 상태 확인 GET의 review가 false/0/빈 문자열이면 유효한 null처럼 확인 완료로 처리될 수 있다. 사용자가 직접 누르는 재시도만 열리며 서버의 기존 검토 검사·job_id unique·경합 409와 프런트 409 입력 보존으로 중복 생성·초안 삭제·자동 POST는 없다. | literal null 또는 유효한 검토 ID만 허용하고 falsy primitive 회귀를 추가. 서버 중복 차단 계약이 바뀌면 우선 재평가. |

M4는 반복 관찰을 합친 한 정비 항목이다. launcher VIRTUAL_ENV 불일치, Starlette/httpx deprecation, Node module registration deprecation, NO_COLOR/FORCE_COLOR 충돌, Astro 빈 i18n/missing-404는 도구/문서 경고다. MCP의 존재하지 않는 scan 부정 테스트에서 나오는 Scan not found stack은 의도한 assertion의 stderr로 실패와 구분한다. 이번 수정의 도구 오류/timeout도 [실패 교훈](lessons-learned.md)에 원인·해결·예방을 기록한다.

**해결된 C1 M1:** 불명확한 수락 mutation 뒤 두 번 확인해야 했던 문제는 C2에서 해결했다. 한 번의 현재 성공 GET으로 불명확 상태를 해제하고 사유의 충돌/읽기 전용은 유지한다. C2 독립 검토와 accepted-write/lost-response 브라우저 근거가 확인했으므로 열린 Minor로 다시 분류하지 않는다.

B1의 초기 메타데이터 한/영 누락은 Minor로 잘못 분류됐다가 필수 계약 위반 Important로 바로잡아 원래 수정 라운드에서 해결했다. A2/A3/B1/E1/C1/C2/C3/B2/B3/E2/D1/D2/D3 반복 경고는 M4다. 최종 I1은 다른 소비자의 새 통합 결함이며 D3의 국소 재검토가 틀렸다는 주장이 아니다.

## 운영·증거 한계

- 실제 배포·운영 DB migration·클러스터 Cron·flag 활성화를 수행했다고 주장하지 않는다. workflow/search/expiry default/stg/prod 예제는 false, Cron은 suspended, web은 한 process/replica다.
- D2 stg/prod render는 UTC 5 * * * *, Forbid, 600초, 성공 이력 1/실패 3, 같은 이미지/DB 설정과 suspend를 검증했다. 실제 운영 스케줄 성공 증거가 아니다. 2시간 지연 판단에는 유효한 활성화 기준 또는 적절한 성공 기록이 필요하다.
- 실제 SQLite/PostgreSQL migration·동시 HTTP·rollback을 검증했지만 운영 destructive downgrade를 승인하지 않는다. 새 이력이 생기면 flag off와 읽기 호환 schema를 유지한다.
- SQLite dry-run은 mode=ro/query_only와 정상 locking으로 논리 데이터/스키마·durable DB hash/content/journal mode를 바꾸지 않고 없는 DB/부모를 만들지 않는다. 정상 WAL 조정용 transient WAL/shm sidecar는 생길 수 있다. immutable/nolock은 쓰지 않는다. PostgreSQL 실제 read-only transaction 쓰기 거부도 검증했다.
- E2 합성 100 jobs × 1,000 findings = 100,000에서 HTTP 최초/다음 페이지는 SQLite 92.79/84.45ms, PostgreSQL 45.89/37.02ms였다. 실제 EXPLAIN/ANALYZE를 확인했고 PostgreSQL page query는 0.676/0.693ms였다. HTTP에는 count/완전성/auth도 포함한다. 당시 로컬 측정이며 운영 SLA·보편적 지연 보장이 아니다.
- 실 기업 IdP/verifier·scanner DB/모델 계정·원격 Git host 임의 SHA fetch 정책은 별도 운영 검증이다. 정확한 SHA 실패를 latest로 바꾸지 않는다. 누락된 scanner/engine/DB provenance나 예외 원본 job ID를 추정하지 않는다.
- 응답을 잃은 키 원문은 복구하지 못한다. 메모리 전용 키 입력은 탐색 후 복구되지 않는다. 목록 확인 뒤 사용자가 별도 발급/이전 키 폐기를 선택한다. 자동 폐기/연장·이전 승인/예외의 새 내용 전파는 없다.
- 미지의 근거/엔진 누락/모델 실패는 ALLOW가 아니다. 제출 소스 실행·의존성 설치·제출 MCP 시작을 하지 않았다. API 키 scope ceiling, 독립 reviewer·자기 승인 금지·서버 소유권·exact-content 예외를 유지한다.

## 설계 판단 22개와 비용 — 원래 순서

전체 검토는 각 판단을 개별 평가했고 추가 구조 차단 사유로 보지 않았다. 아래 원문과 비용은 기계적으로 붙은 단어와 대체된 판단까지 보존한다.

역사 설명: A3 초기 document-local 방식은 새 문서로 돌아오는 queryless Back에서 현재 default가 적용되는 비용을 수용했으나 binding URL 복원 계약을 만족하지 못했다. 7번은 그 예외를 철회하고 검증된 entry identity 보존의 추가 조정/회귀 비용을 선택했다. E1 초기 capture-phase 비용(8번)은 9번의 탐색 직전 명시 callback 의무로 대체됐다. 역사적 예외를 현재 계약으로 남기지 않는다.

1. Ruling: Existing design and plans approved by the user's instruction to implement every PR — no duplicate design approval required — cost if wrong: implementation rework.

2. Ruling: Use subagent-driven-development for the long roadmap; implementation sequential, independent review per PR — preserves context and review boundaries — cost: review overhead.

3. Ruling: Source plans use A1 headings unsupported by task-brief; generated ignored aggregate plan preserves full task text under Task N headings — avoids modifying approved plan content just for tooling — cost: regenerate if source plans change.

4. Ruling: A1 preserves the validated exact route/query through login; E1 owns full arbitrary finding/occurrence UI selection — roadmap F04 spans A1 and E1; A1 evidence must not claim selection already complete — cost if wrong: staged deep-link experience until E1 merges.

5. Ruling: Successful SSO identity observation must automatically broadcast a detected account change across tabs, with loop suppression and no authorization trust in storage — A1 requires clearing stale account data/forms; polling-only detection leaves stale content until next poll — cost if wrong: additional browser storage coordination complexity.

6. Ruling: Legacy profile endpoint remains optional-header compatible; new personal endpoints require X-AAG-Account — spec section3 simultaneously preserves header-less legacy calls and calls personal settings mandatory; A1 plan applies mandatory binding to new endpoints and does not change routes_profile, so preserve existing profile API tests while every new UI save sends captured owner — cost if wrong: legacy header-less profile callers retain the old shared-cookie intent ambiguity and would need a compatibility change. Initial independent review explicitly accepted this compatibility interpretation.

7. Ruling: Supersede earlierA3querylesscross-documentcostacceptance; persistvalidatedhistoryrestorationidentityacrossdocumentswhilefreshquerylessentryusescurrentdefault — bindingURL/backrestorationspecwinsafterreviewidentifiedgap — costifwrong: additionalminimalrouterhistorystatecoordinationandregressionwork. Userdidnotapproveaspecamendmentandnoneisneededtofix.

8. Ruling: Include minimal outgoing-list-scroll persistence repair in E1 after actual full-regression failure — A3 restoration is load-bearing for later roadmap features and original assertion must remain intact — costifwrong: additional bounded capture-phase list-context writes, verified by focused regression and independent E1 diff review. No unrelated A3 redesign or broad test relaxation.

9. Ruling: Refine outgoing-scroll repair to explicit validated capture immediately before query navigation — it covers change and click paths without global interception — costifwrong: future list controls must call the shared capture callback; handoff contract and focused tests enforce this. This supersedes the provisional capture-phase mechanism/cost in the prior ruling, not the need for the repair.

10. Ruling: C1 adds only assignee_id/claimed_at/revision/workflow_state plus ReviewEvent; closed_reason remains C2 and previous_review_id remains C3 — final spec schema is delivered through explicitly allocated linear feature migrations — costifwrong: later features must add their columns before use, with read compatibility and migration tests. No unused future columns in C1.

11. Ruling: Leave frontendScans unchanged for C1 — focusedcontrollerinspection confirmslines755–786 existingreview_requestreceiptguardandsnapshot plus915–934minimalid/statuslink alreadydelegateworkflowtoreviewdetail; C1newcontrolsandrevisiondraftsliveReviews — costifwrong: workflowactionsremainoneexistinglinkawayfromscanoverview, and a later requirement for inline controls would need a targeted change. No no-op hunk to satisfy a file list; update source plan rationale and independently review actual behavior.

12. Ruling: Preserve required page/page_size and permit the existing additive after cursor for stable activity continuation — explicit page API remains supported while current UI keyset behavior stays stable — costifwrong: an additional mutually constrained query option must remain documented/tested; it grants no new access.

13. Ruling: C3 changes_requested supersession delivers old review.withdrawn and normal new review.requested in the same transaction, rejected history gets no artificial withdrawal — explicit closure and new-request semantics both remain observable — costifwrong: a reviewer in both recipient groups receives two legitimate distinct notifications and a bounded producer refactor. Lock/allocate globally sorted recipient union after domain/events/audit, never independently sorted subsets across two deliveries; preserve per-event dedup/preferences/visibility/self-exclusion and cover overlapping-recipient concurrency/rollback. DTO authorized link IDs/hashes omitted together.

14. Ruling: B2 compare entry uses spec URL /jobs/{current_id}/compare?baseline={baseline_id} with a minimal handled authorized selected-pair metadata screen and working scan/history/back links — B2 is independently runnable before B3 comparison classifications arrive — costifwrong: a temporary metadata screen is replaced/extended next PR. No dead route, premature comparison DTO/classification or implementation label B3 in product UI. Safe denied/invalid states for eachside; sourceplan records necessary route/file allocation refinement.

15. Ruling: B3 leaves Scans.tsx unchanged because B2 already provides ListLink at809–810 tohistory and mountedScanHistory at917, whileApp replaces thathistorypairdestination withactualScanCompare — focusedcontrollerinspection confirms existingentryfulfillsB3behavior withoutno-ophunk — costifwrong: comparison remains onehistoryselectionstep fromdetail; targeted inlineentry could beadded laterifrequired. Report/sourceplan records allocationrationale forindependentreview.

16. Ruling: E2 reuses existing shared predicates without no-op edits to routes_scans/routes_metrics — controller focused inspection confirms scans122/437 and metrics34/121/128 already use job_scope_filters/review_queue_predicates, search24/26/83/165 calls the same helpers — cost if wrong: a future predicate contract change must preserve all three consumers; focused independent review and final aggregate audit cover that boundary. Source-plan completion/PR trace is reconciled in final delivery documentation, not fabricated before merge.

17. Ruling: D1 optional exact-target query on existing key/allowlist GETs retains ordinary capped list and appends at most one specifically authorized older target — required notification deep links must not treat valid targets outside latest500keys/latest1000exceptions as absent — cost if wrong: one optional GET branch and max cap+1 response. Server rechecks current ownership/existing admin read permission; invalid/foreign/deleted reveal no extra data, safe not-found UI; key ceiling unchanged. Additional routes_identity/routes_admin files and capped-old-target/foreign/role-loss tests are necessary allocation refinement, document in source plan/report.

18. Ruling: D2 adds optional finite Unix AAG_EXPIRY_REMINDERS_ENABLED_AT as operator-declared activation baseline — bool alone cannot establish two-hour no-success interval across restarts/reactivation — cost if wrong: one optional setting and operator activation step. Disabled flag stays disabled; enabled with no success and missing/invalid/future baseline is explicit configuration-required/unknown, never falsely healthy or invented delayed. Valid baseline uses activation or later qualifying success; pre-reactivation success does not reset it. Existing successful history supports recency without baseline. Document/test restart/reactivation semantics; examples false.

19. Ruling: D2 adds nullable Notification expiry snapshot Float in its linear migration — exact expiry/recipient/type/id/stage anti-join must precede limit without cross-DB float-cast precision loss — cost if wrong: one nullable column and bounded producer extension. Capture validated new emission facts only; do not infer/backfill unknown historical expiry from current targets. Canonical exact event key plus unique remain; document old-null compatibility, guard destructive downgrade, recheck current target/recipient inside transaction. Smallest compatible actual-insert-count return allowed, legacy adapter behavior/sortedInbox preserved. Shared global candidate cap across key/exception types.

20. Ruling: D2 dry-run uses genuine SQLite mode=ro/query_only with normal locking and may create transient WAL/shm coordination sidecars — binding spec forbids database/application writes, not a custom zero-filesystem-effect VFS; officialSQLite WAL behavior requires coordination — cost if wrong: ordinary transient sidecars may appear, explicitly documented. Guarantee no logical rows/schema, durable DB hash/content/journal-mode mutation, or missing DB/parent creation; PG readonly intact. No immutable/nolock/exclusive/customVFS. This refines any broader controller filesystem-zero implication, not I1actualmode/filecreation defect.

21. Ruling: D3 key forms use focused in-memory receipt guards with existing account/generation primitives, no new persisted DraftKind — existing key forms have no A2 draft kind and tokens/keyfields must remain transient — cost if wrong: memory-only edits do not recover after navigation. Preserve monotonic edit version on reset/prefill/discard, strong destructive-success/weak pending cleanup and delayed/account-switch tests; no second full draft subsystem.

22. Ruling: D3 exception revalidation shows exact source/hash/fingerprint and links /new for manual source/file selection plus explicit existing new-exception form focus — API has no originating job ID, so guessing one or copying old hash would falsely imply lineage/scope — cost if wrong: one manual source selection step. Do not overwrite dirty input or silently reuse old hash; existing server validates exact new scope. Document source-plan rationale and changed-hash regression; no new API.

## 최종 수정 화면 QA

실행 담당자가 아래 8개를 실제로 열어 확인했다. desktop dark의 다섯 생성 소비자, mobile light의 검토/게시글, desktop light의 확인 완료 게시글을 포함한다. 입력/버튼이 읽히고 모바일 sidebar가 닫혔으며 원문 자격증명이 없다. 마지막 게시글 확인 화면은 현재 목록의 실제 1건과 복구 카드가 일치하도록 수정 후 다시 검토했다.

- [scan-unknown-desktop-dark](screenshots/convenience-final/scan-unknown-desktop-dark.png)
- [rerun-unknown-desktop-dark](screenshots/convenience-final/rerun-unknown-desktop-dark.png)
- [review-unknown-desktop-dark](screenshots/convenience-final/review-unknown-desktop-dark.png)
- [followup-unknown-desktop-dark](screenshots/convenience-final/followup-unknown-desktop-dark.png)
- [board-unknown-desktop-dark](screenshots/convenience-final/board-unknown-desktop-dark.png)
- [review-unknown-mobile-light](screenshots/convenience-final/review-unknown-mobile-light.png)
- [board-unknown-mobile-light](screenshots/convenience-final/board-unknown-mobile-light.png)
- [board-verified-desktop-light](screenshots/convenience-final/board-verified-desktop-light.png)

## 최종 범위 재검토의 추가 판단과 비용

23. Ruling: Final scoped residual I1/R1 is parked as nonblocking M6 — malformed falsy review state can enable only a manually chosen retry; unchanged server existing-review check, unique job_id and race-to-409 prevent duplicate creation, and the frontend retains input with no automatic POST — cost if wrong: misleading verification and one avoidable server-rejected retry until literal-null-or-valid-review validation is tightened; revisit if server duplicate guards change.

24. Ruling: Update the legacy review-revisit 503 assertion to require explicit current-resource GET before retry — final CI proved its immediate-enable expectation contradicts the approved uncertain-write recovery contract, while all 198 other browser cases pass — cost if wrong: the test is coupled to that retry policy and must change if the contract changes, plus one additional exact-head CI cycle. Product code and parked M6 remain unchanged; this is CI compatibility validation, not a second product fix wave.
