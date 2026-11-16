# Agent Admission Gate 편의기능 상세 설계안

작성일: 2026-11-16 KST · 상태: 검토용 설계 제안 · 기준: main 5ff646d3c0fed462bce5086fcc956caa057749ff

검사 접수부터 재검사, 결과 공유, 사람의 검토까지 반복 업무에서 끊기는 동선을 보완한다. 앞서 확인한 10개 기능을 모두 포함하며 이 문서의 화면·계약·수치는 구현을 위한 제안이다. 이 문서를 추가하는 PR은 제품 동작을 변경하지 않는다.

## 1. 범위와 구현 순서

| ID | 기능 | 현재 구현과 공백 | 실행 플랜 |
| --- | --- | --- | --- |
| F01 | 이전 조건으로 재검사 | force_rescan은 있으나 상세에서 설정을 가져오는 동선이 없다 | B1 |
| F02 | 작성 내용 자동 보존 | 검토 사유·코멘트에 자동 복구가 없다. 게시판의 수동 draft와 별개다 | A2 |
| F03 | 목록 상태 복원과 저장된 보기 | 검색조건은 URL에 있지만 상세의 목록 링크는 /jobs로 고정된다 | A3 |
| F04 | SSO 후 원래 화면 복귀 | OIDC callback이 /로 이동한다 | A1 |
| F05 | 대상별 이력과 결과 비교 | 개별 작업은 조회하지만 동일 대상의 변화를 비교하는 화면은 없다 | B2, B3 |
| F06 | 검토 담당자와 검토 중 표시 | reviewer_id는 결정 시점의 검토자이며 사전 담당자가 아니다 | C1 |
| F07 | API 키·예외 만료 알림 | 만료일은 있지만 현재 알림은 검사·검토·공개 코멘트에 한정된다 | D1, D2, D3 |
| F08 | 검색 범위 확장 | 작업 검색은 Job.source, 발견 필터는 심각도 중심이다 | E2 |
| F09 | 특정 발견 공유와 읽기용 요약 | JSON/SARIF는 있지만 선택한 발견의 URL과 Markdown 요약은 없다 | E1 |
| F10 | 요청 철회·보완·후속 검토 | 현재 검토는 pending/approved/rejected이며 보완 상태와 연결된 재요청은 없다 | C2, C3 |

추천 순서는 A1 → A2 → A3 → B1 → E1 → C1 → C2 → C3 → B2 → B3 → E2 → D1 → D2 → D3다. 각 항목은 독립 PR로 검증한다. B2는 B1 이후, C3는 B1·C2 이후, B3는 B2 이후, D2는 D1 이후에 진행한다. 상세 플랜은 [플랜 인덱스](../plans/2026-11-16-convenience-roadmap.md)에 있다.

## 2. 기존 계약과 설계 선택

### 유지할 기반

- Python >=3.12, FastAPI 0.141.1, uvicorn 0.52.1, Typer 0.27.1, SQLAlchemy >=2.0,<3, Alembic >=1.13,<2, psycopg[binary] >=3.1,<4, fastmcp >=3.4.2,<4.
- React 19.2.8, Vite 8.2.2, TypeScript, react-router-dom ^7.13.0, Tailwind CSS 4.3.3, Radix UI, Recharts. 현재 저장소의 npm 잠금파일과 Astro Starlight를 따른다.
- Graphite & Plum, Pretendard Variable 1.3.9, D2Coding, 현재 다크/라이트 및 팔레트 토큰을 사용한다. 새 색상이 필요한 경우 DESIGN.md와 대비 테스트를 함께 수정한다.
- user/admin 역할과 reviewer 자격은 직교한다. admin도 reviewer 없이 검토 결정을 할 수 없다. API 키는 기존 scan:read/write 범위이며 사람의 검토·개인 설정·키 관리에는 사용하지 못한다.
- 한 프로세스·한 replica 운영을 유지한다. 재검사는 기존 ScanService로 제출하며 업로드 코드나 대상 MCP 서버를 실행하지 않는다.
- 승인·예외는 다른 내용에 전파하지 않는다. 엔진 누락·실패·미확인 비교는 ALLOW나 안전 확인으로 바꾸지 않는다.

### 접근 방법

| 접근 | 장점 | 비용과 제약 | 채택 |
| --- | --- | --- | --- |
| 화면 상태만 보완 | 초안·복귀·재검사 입력 보완에 적합 | 담당자·비교·만료 이벤트의 서버 정합성을 해결하지 못한다 | A의 로컬 상태에 적용 |
| 기존 모놀리스에 도메인별 모듈 추가 | 기존 권한·트랜잭션·세션·알림을 재사용한다 | 큰 화면 파일에서는 필요한 기능만 작은 모듈로 분리해야 한다 | 전체 기본안 |
| 외부 검색·워크플로·메시지 인프라 도입 | 대규모 검색과 분산 작업에 유리하다 | 현재 편의기능 범위에 비해 도입·운영 비용이 크다 | 이번 범위에서 제외 |

초안은 같은 탭의 sessionStorage, 저장된 보기는 계정별 DB, 검색은 관계형 DB의 제한된 파생 색인, 만료 감지는 별도 CLI/CronJob을 선택한다. 모두 작성자의 설계 제안이며 사용자가 별도로 확정한 선택으로 간주하지 않는다. 메일 발송·게스트 공유·예약 검사·외부 검색 엔진·다중 replica 전환은 포함하지 않는다.

## 3. 공통 화면과 API 원칙

- 기존 사이드바를 유지하고 상단 검색 진입점만 추가한다. 새 주 메뉴를 기능 수만큼 만들지 않는다.
- 대기/성공/실패/권한 없음/조회 결과 없음/저장 중을 분리한다. 실패 시 입력을 유지하고 재시도 버튼을 제공한다.
- 주요 동작은 키보드로 접근하며 모바일에서는 행 메뉴 또는 줄바꿈된 버튼으로 제공한다. 자동 새로고침이 포커스·작성 내용·선택을 초기화하지 않는다.
- 현재 상태 조회와 서버 권한 검사를 기준으로 버튼을 표시한다. 다른 계정·권한 없는 ID의 상세·개수·자동완성을 노출하지 않는다.
- 새 프런트는 모든 인증된 사용자 콘텐츠 mutation에 폼을 연 계정의 X-AAG-Account 헤더를 사용한다. 재검사·코멘트·게시글·키 발급도 포함한다. 기존 endpoint는 헤더가 있을 때 세션 계정과 다르면 409로 거부하며 header-less legacy 호출의 기존 계약은 유지한다. 개인 설정·새 검토 mutation·기존 알림은 헤더를 필수로 요구한다. 클라이언트는 계정별 generation으로 늦은 응답을 폐기한다.
- 새 검토 mutation에는 expected_revision을 요구한다. 409이면 최신 상태를 다시 보여주되 사용자가 입력한 사유는 보존한다. 서버가 의미를 이해하지 못한 필드는 422로 거부한다.
- 인증 만료 시 POST를 자동 재전송하지 않는다. 네트워크 단절로 저장 여부가 불명확하면 최신 리소스를 확인한 뒤 명시적으로 재시도한다.
- 문구와 접근성 이름은 한국어·영어를 함께 제공한다. 시각적 배지 색상만으로 상태를 구분하지 않는다.

## 4. A 사용자 작업 보존

### A1 세션 만료와 로그인 복귀 F04

SSO 링크에 return_to를 전달하고 검증된 내부 목적지를 OIDCState.return_to에 저장한다. callback은 검증한 state에 연결된 값만 사용하며 query의 새 목적지는 받지 않는다. 로컬 로그인도 같은 목적지 정규화 규칙을 사용한다.

허용 목적지는 현재 SPA 라우트와 이 설계의 새 라우트다. /api, /health, /mcp, callback 및 로그인 재진입은 제외한다. 길이는 최대 2,048자이며 scheme·host·userinfo·역슬래시·제어문자·protocol-relative URL·중첩 인코딩 우회·경로 traversal은 거부하고 /로 복귀한다. 라우트별로 알려진 query만 유지하며 credential/token/password류 값은 보관하지 않는다.

| 상황 | 동작 |
| --- | --- |
| 검사 링크 → SSO | 로그인 후 같은 작업·탭·발견 항목으로 복귀 |
| 401 발생 | account generation을 확인하고 초안 flush 후 재로그인 안내. 다른 화면의 동시 401은 하나로 합침 |
| 403 발생 | 권한 변경 안내와 허용된 화면으로 이동. 자동 로그아웃하지 않음 |
| 네트워크 오류·503 | 연결 문제를 표시하고 읽기 요청에만 재시도. 로그인 화면으로 보내지 않음 |
| 복귀 대상 권한 상실 | 로그인 성공 뒤에도 현재 권한으로 404/접근 불가를 표시 |
| 다른 계정으로 로그인 | 이전 계정의 화면 데이터·초안·개인 보기 캐시를 폐기 |

APIError의 status는 유지하고 공통 인증 이벤트를 추가한다. /auth/login의 잘못된 비밀번호 응답은 전역 만료 이벤트에서 제외한다. OIDCState의 기존 PKCE·nonce·만료·일회 교환 검사는 그대로 사용한다.

### A2 초안 자동 보존 F02

대상은 새 검사 설정, 검토 요청 사유, 결정 사유, 검사 코멘트, 게시판 작성·수정이다. 게시판은 AAG_BOARDS_ENABLED가 켜졌을 때만 적용한다. 새 검사에서 PAT·파일 본문·파일 핸들은 보관하지 않는다. API 키 원문과 인증 화면은 초안 대상이 아니다.

키는 account_id/form_kind/target_id로 구성한다. schema_version, saved_at, nullable base_revision, base_state(status/decided_at/review_id)와 허용된 필드만 저장한다. C1 전처럼 검토 revision이 없는 버전에서는 base_state와 최신 GET을 대조하고, revision이 제공되면 이를 우선한다. 탭별 sessionStorage에 마지막 변경 후 300ms debounce로 기록하고 라우트 이동·SSO 시작·visibilitychange/pagehide에는 동기 flush한다. 유지 기간은 마지막 수정 후 24시간, 최대 20개·합계 256KiB이며 오래된 초안부터 제거한다. 저장 실패나 용량 초과는 화면에 표시하며 자동 저장됐다고 주장하지 않는다.

복구는 같은 계정 인증과 대상 권한 재확인 후에만 제안한다. '이전 작성 내용 복구' / '버리기'를 보여주며 새 서버 데이터를 자동으로 덮어쓰지 않는다. 검토가 이미 결정됐거나 게시글 revision이 바뀌었다면 읽기용 초안과 최신 내용을 보여주고 명시적 재편집을 요구한다. 내부 코멘트 자격을 잃으면 해당 초안을 표시하지 않고 제거한다.

임시저장 여부와 저장 시각을 표시한다. 저장 성공을 확인한 뒤 해당 초안만 제거한다. dirty 상태의 SPA 이동과 탭 닫기는 이탈 확인을 제공한다. 현재 main.tsx의 BrowserRouter를 data router 진입점으로 바꾸고 기존 경로·App UI는 유지한다. SPA 이탈은 useBlocker, 탭 닫기·hard reload는 beforeunload로 다룬다. 상세의 탭 변경으로 폼이 unmount되는 경우도 이탈 범위다. 명시적 로그아웃·다른 계정 감지·TTL 만료 시 제거하고, 같은 계정의 인증 만료에는 유지한다. 기기 간·탭 간 동기화는 제공하지 않으며 화면에 '이 탭에 임시저장'이라고 표기한다.

### A3 목록 복귀와 저장된 보기 F03

일반 진입은 URL이 기준이며 브라우저 뒤로가기와 복원도 이를 따른다. 목록→상세 이동 시 내부 list_url과 scroll_y를 라우터 state에 넣고 sessionStorage에 계정·목록별 마지막 상태를 저장한다. 상세의 '목록으로'는 이 값을 사용한다. 직접 링크로 진입한 경우 같은 계정의 유효한 마지막 목록, 없으면 기본 목록으로 이동한다.

검색 변경은 입력을 debounce하고 page를 1로 재설정한다. 복귀 시 조회 후 행/스크롤을 복원하며 삭제되거나 범위를 벗어난 페이지는 마지막 유효 페이지로 조정한다. 기존 URL의 scope/days/status/verdict/q/page는 유지한다. 현재 권한에서 쓸 수 없는 staff scope를 개인 scope로 몰래 바꾸지 않고 수정 안내를 표시한다.

SavedView는 id, owner_id, resource(jobs/reviews), name(1~40), filters(JSON allowlist), is_default, revision, created_at, updated_at을 가진다. 계정당 최대 20개, 같은 resource에서 이름 유일성·기본 보기 최대 1개를 보장한다. page·scroll·비밀 값은 저장하지 않는다. query가 명시된 URL이 기본 보기보다 우선한다. 기존 쿼리 없는 탐색 진입에서만 기본 보기를 적용한다.

| API | 계약 |
| --- | --- |
| GET /api/saved-views?resource=jobs | 본인 보기만 반환, 현재 권한에서의 usable/invalid_reason 포함 |
| POST /api/saved-views | name/resource/filters, 201; 제한·중복 409/422 |
| PATCH /api/saved-views/{id} | expected_revision과 변경 필드, 기본 보기 교체도 단일 트랜잭션 |
| DELETE /api/saved-views/{id} | expected_revision, 본인만 삭제 |

## 5. B 검사 반복과 비교

### B1 조건 재사용 F01

검사 상세에 '같은 조건으로 다시 검사'를 제공한다. Git은 '브랜치/태그의 현재 내용'과 '기록된 동일 커밋'을 구분하고 실행 전 URL·ref/commit·profile·캐시 사용 여부를 확인한다. 실행 버튼은 편집 가능한 새 검사 화면에서 누르며 페이지를 여는 것만으로 제출하지 않는다.

새 URL은 /new?from={job_id}&mode=latest|snapshot이다. latest는 기존 ref를 사용하고 비어 있으면 현재 기본 브랜치를 검사한다. snapshot은 기록된 resolved_commit을 사용한다. 기록이 없으면 snapshot을 비활성화한다. PAT는 다시 입력하며 ZIP은 파일을 다시 선택한다. 새 검사에는 원본 검사 링크를 남기고 기존 승인·예외를 자동 복제하지 않는다.

기존 POST /api/scans 및 /api/scans/upload를 재사용한다. 선택 필드 origin_job_id와 Git의 rerun_mode를 추가하고 서버는 본인 원본 작업·동일 source_type·Git의 동일 정규 URL을 검사한다. 다른 사용자 검사에서 자신의 작업을 파생시키는 기능은 이번 범위에서 제공하지 않는다. ZIP의 연결은 사용자가 명시한 계보이며 같은 파일명이라는 이유로 연결하지 않는다.

Job에는 nullable origin_job_id, lineage_root_id, target_commit과 rerun_mode(latest/snapshot/null)를 추가한다. target_commit은 요청 시 기록하므로 checkout 전에 실패해도 snapshot 재시도 의도를 보존한다. snapshot 재시도의 기준은 저장된 target_commit, 없으면 resolved_commit이다. 생성 시 원본의 root 또는 원본 ID를 복사하고, 없는 새 작업은 자신의 ID를 root로 한다. 기존 작업은 root=self로 backfill한다. 원본 관계는 이후 수정하지 않는다.

동일 커밋은 ScanRequest.target_commit(40 또는 64자리 hex, ref와 동시 지정 금지)으로 구분한다. 현재 git clone --branch 경로에 SHA를 넣지 않는다. 승인된 URL에 제한된 init/fetch --depth=1/checkout --detach 경로를 추가하고 resolved_commit 일치를 확인한다. redirect·submodule·hook·protocol·시간·디스크 제한은 동일하게 적용한다. 서버가 해당 commit fetch를 허용하지 않으면 실패를 명확히 표시하고 최신 브랜치로 대체하지 않는다.

### B2 이력 F05

GET /api/scans/{id}/history는 Git의 정규화된 Job.source와 같은 owner를 기준으로 조회한다. 현재 validate_git_url의 정규화 결과를 재사용하고 별도 느슨한 URL 비교를 추가하지 않는다. ref/profile/status 필터와 page_size=25, 최대 100을 지원한다. API 키는 scan:read와 본인 범위를 유지한다. staff도 기준 작업 소유자의 이력을 조회하며 다른 소유자 전체 결과를 자동으로 섞지 않는다.

ZIP은 lineage_root_id로 명시 연결된 업로드만 묶는다. 기존 ZIP은 단독 이력이며 파일명 기반 추정은 하지 않는다. 표에는 시각·ref/commit·profile·원래/최종 판정·엔진 범위·캐시·검토 상태를 보여준다. 두 행 선택 또는 상세의 '이전 검사와 비교'로 B3에 진입한다.

### B3 결과 비교 F05

화면은 /jobs/{id}/compare?baseline={baseline_id}, API는 GET /api/scans/{id}/compare?baseline_id={baseline_id}다. 양쪽 모두 현재 actor가 조회할 수 있어야 한다. 서로 다른 owner·source_type 또는 다른 Git 저장소는 422로 거부한다. 연결되지 않은 같은 owner의 ZIP은 명시적 확인 후 allow_unlinked=true로 비교할 수 있지만 대상 동일성 미확인 경고를 유지한다.

응답은 baseline/current 메타데이터, comparability, summary, items다. comparability에는 same_source, same_profile, same_policy, same_scanner_revision, coverage_complete, provenance_known를 각각 반환한다. 완료 전 검사는 409, 실패·취소 결과는 상태 메타데이터만 보여주고 '해소' 수를 만들지 않는다.

| 분류 | 기준과 표시 |
| --- | --- |
| persisting | 동일 fingerprint로 일치. severity·suppressed 변경은 별도 flags로 표시 |
| moved_candidate | fingerprint가 다르지만 engine/rule/path/title 조합이 유일한 1:1일 때 이동 후보. 확정 일치로 숨기지 않음 |
| new | 현재 결과에서만 관측됨 |
| not_observed | 이전 결과에서만 관측됨. '미검출 · 해소 확인 필요'로 표시 |
| unmatched | 중복·모호한 후보. 양쪽 항목을 그대로 남김 |

현재 fingerprint는 line과 title을 포함하므로 줄 이동을 단순 해소+신규로 단정하지 않는다. 프로필·정책·scanner revision·필수 엔진 범위가 다르거나 engine/취약점 DB 출처가 미보고라면 비교 제한을 요약 위에 표시한다. 기존 기록의 출처를 추정하여 채우지 않는다. 예외로 suppressed가 된 항목과 실제 미검출도 구분한다. 비교는 저장된 사실을 설명하며 새 판정이나 승인 효력을 만들지 않는다.

## 6. C 사람의 검토 흐름

### 상태와 데이터 F06 F10

Review.status는 pending/approved/rejected를 유지하고 withdrawn을 추가한다. 담당 중·보완 대기는 workflow_state로 분리한다. reviewer_id는 실제 결정자 의미를 유지하고 assignee_id를 새로 추가한다.

| status | workflow_state | 의미 | 허용 동작 |
| --- | --- | --- | --- |
| pending | waiting | 미배정 | claim, 요청자 withdraw |
| pending | in_review | 담당자가 검토 중 | release, decide, request-changes, 요청자 withdraw |
| pending | changes_requested | 요청자 보완 대기 | respond, follow-up, 요청자 withdraw |
| approved/rejected/withdrawn | closed | 종료 | 조회, eligible follow-up만 허용 |

추가 필드는 assignee_id, claimed_at, revision(default 1), workflow_state, closed_reason, previous_review_id(nullable unique)다. ReviewEvent는 review_id/actor_id/kind/from_state/to_state/reason/created_at을 저장하며 내부 코멘트와 분리된 공개 업무 이력이다. 사유는 5~4,000자이며 민감한 원본 오류·자격증명은 넣지 않는다. 기존 결정 기록은 closed, 기존 pending은 waiting으로 backfill한다.

### C1 담당자 F06

'내가 검토하기'는 reviewer이고 요청자 본인이 아닐 때 제공한다. assignee_id가 비어 있고 status=pending/workflow_state=waiting인 경우에만 CAS update로 claim한다. 동시에 두 명이 누르면 한 명만 성공하고 다른 사람은 409와 최신 담당 정보를 확인한다. 요청자 본인은 자신의 요청을 claim할 수 없다.

담당 해제는 담당자 또는 사유를 입력한 admin만 가능하다. admin의 해제 권한이 승인 자격을 주지는 않는다. 시간 경과만으로 자동 해제하지 않는다. 비활성화되거나 reviewer 자격을 잃은 담당자는 결정을 할 수 없으며 서버가 비활성·자격 상실을 확인한 stale claim은 현재 유효한 reviewer/admin이 사유와 함께 해제할 수 있다. 다른 사용자의 SSO 상태를 확인할 수 없으면 임의로 stale이라고 판단하지 않고 admin의 사유 해제를 사용한다. 담당자 목록은 필요한 id/name/active만 반환하며 자격 배지는 확인된 로컬 상태를 나타낸다. 실제 결정은 현재 Actor의 검증된 자격으로 검사한다.

기존 decision API의 구형 호출은 pending/waiting/unclaimed 요청을 결정과 같은 트랜잭션에서 claim하는 방식으로 지원한다. in_review는 현재 담당자만 결정하고 changes_requested의 claim/decision은 legacy 호출도 409다. release는 waiting/in_review에서 waiting으로, changes_requested에서는 담당자만 제거하고 changes_requested를 유지한다. 다른 사람이 claim한 요청의 결정은 409다. 새 UI는 expected_revision을 보내며 중복 결정·동시 철회·권한 변경을 원자적으로 검사한다. 기존 자기 승인 금지와 coverage_complete 조건을 유지한다.

검토 목록에 담당자·workflow 배지·대기시간을 추가한다. assignee=me|unassigned|any, stage, q, sort=newest|oldest를 지원한다. 내 요청과 내가 담당한 요청을 구분한다. 기존 tab=pending은 모든 status=pending을 유지하고 새 '내가 처리할 요청' 필터는 waiting/in_review에만 적용한다. 대시보드에서 내려오는 개수와 링크는 공통 쿼리 predicate를 공유한다.

### C2 철회와 보완 F10

요청자는 pending인 자신의 요청을 사유와 함께 철회한다. approved/rejected를 철회로 바꾸거나 최종 판정을 취소하는 기능은 제공하지 않는다. 철회는 검토 업무만 닫고 Job.verdict/effective_verdict를 변경하지 않는다.

담당 검토자는 보완 요청 사유를 남겨 changes_requested로 전환한다. 보완 필요는 반려와 구분하며 이 동작도 Job 판정을 바꾸지 않는다. 요청자는 설명만 보충하는 respond를 할 수 있다. 유효한 담당자가 있으면 in_review로, 없으면 waiting으로 복귀한다. 이미 검사한 파일·result·content_hash를 편집할 수는 없다.

| 새 API | 요청 필드 | 권한 |
| --- | --- | --- |
| POST /api/reviews/{id}/claim | expected_revision | 유효 reviewer, 요청자 제외 |
| POST /api/reviews/{id}/release | expected_revision, reason | 담당자/admin 또는 stale claim 해제 자격 |
| POST /api/reviews/{id}/withdraw | expected_revision, reason | 요청자 |
| POST /api/reviews/{id}/request-changes | expected_revision, reason | 담당 reviewer |
| POST /api/reviews/{id}/respond | expected_revision, reason | 요청자, changes_requested 상태 |
| GET /api/reviews/{id}/events | page, page_size | 기존 검토 조회 권한 |

새 이벤트 review.claimed/released/changes_requested/responded/withdrawn은 업무 변경과 같은 트랜잭션에서 생성한다. 배정·해제는 요청자, 보완 요청은 요청자, 보완 응답·철회는 현재 담당자에게 알린다. 본인에게 보낸 이벤트와 중복 수신자는 제외한다. review_updates 수신 설정을 추가하고 기존 알림 preference를 유지한다. 내부 코멘트의 본문은 알림에 복제하지 않는다.

### C3 수정본과 후속 검토 F10

코드를 수정했다면 B1으로 새 검사를 제출한 후 POST /api/reviews/{id}/follow-ups에 new_job_id/reason/expected_revision을 보낸다. 이전·새 작업의 소유자는 모두 요청자여야 하고 새 작업은 COMPLETED이며 이전 작업보다 같거나 늦게 생성되어야 한다. Git은 같은 정규 URL, ZIP은 이전 작업의 동일 계보여야 한다. 승인된 요청에서는 follow-up을 만들지 않고 별도의 신규 검사·요청을 사용한다.

이전 상태는 rejected 또는 changes_requested만 허용한다. changes_requested는 withdrawn/closed_reason=superseded로 닫고 새 pending/waiting 요청과 previous_review_id로 연결한다. rejected는 기록을 유지한다. previous_review_id의 unique 제약과 job_id의 기존 unique 제약으로 동시 생성은 하나만 성공한다. 중복 409에서는 이미 만들어진 후속 검토의 허용된 ID만 안내한다.

이전 승인·담당자·결정 이유를 새 판정에 적용하지 않는다. 화면에는 '이전 요청'과 '수정 후 요청'을 양방향으로 제공하며 각 결과의 content_hash를 명시한다. 사유만 보충하는 respond와 새 내용을 검사하는 follow-up을 별도 버튼으로 제공한다.

## 7. D 만료 알림 F07

### D1 알림 대상 일반화

현재 Notification.job_id는 NOT NULL이며 목록·개수·변경이 Job join에 의존한다. nullable 변경만으로 끝내지 않고 조회·권한·응답·이동·정리를 함께 일반화한다.

Notification에 resource_type(scan/review/api_key/exception), resource_id를 추가하고 job_id를 nullable로 전환한다. 기존 scan/review의 job_id/review_id와 응답의 source/href는 유지한다. 기존 행은 kind와 review_id로 backfill하고 새 credential 이벤트에는 존재하지 않는 job을 만들지 않는다. resource_type과 참조 필드 조합은 CHECK 제약과 생성기 검증으로 일치시킨다.

서버의 target registry가 허용된 event kind, 대상 권한, 안전한 label, 내부 href를 생성한다. 임의 payload의 URL을 이동에 사용하지 않는다. 새 키 이벤트는 소유자에게만, 예외 이벤트는 작성자이면서 현재 admin인 사용자에게만 제공한다. 비활성 사용자와 권한을 잃은 계정에는 전달·목록·개수·변경 모두 노출하지 않는다. 삭제되거나 폐기된 대상은 조회 시 다시 확인한다.

credentials/exceptions 카테고리와 수신 설정을 추가한다. X-AAG-Account, 수신자 sequence, read-all 경계, 90일 보존, 읽음·보관·복원과 최근 5개 벨 미리보기를 유지한다. 목록 조회의 Job inner join을 대상별 가시성 query로 교체하고 본문·개수·mutation 모두 같은 predicate를 사용한다. 비검사 항목의 source는 안전한 리소스 표시명이며 종류를 함께 표시한다.

### D2 시간 기반 감지와 관리 동선

| 이벤트 | 감지 조건 | 수신자와 이동 |
| --- | --- | --- |
| key.expiring_7d | 만료까지 1일 초과~7일 이하 | 활성 소유자 → /api-keys?key={id} |
| key.expiring_1d | 만료까지 0초 초과~1일 이하 | 활성 소유자 → 같은 키 |
| key.expired | 만료 후 24시간 이내 | 활성 소유자 → 같은 키 |
| exception.expiring_7d/expiring_1d/expired | 동일 시간 규칙, active 예외 | 현재 admin인 작성자 → /admin?tab=allowlist&exception={id} |

한 번의 실행에서는 대상별 가장 긴급한 단계 하나만 전달한다. 7일 전에 실행되지 않았다면 1일 전 단계만 전달하며 과거 단계 알림을 한꺼번에 쌓지 않는다. 폐기·비활성·이미 지난 만료 24시간 초과 항목은 제외한다. event_key는 종류/대상 ID/expires_at/단계로 만들며 recipient+event_key unique와 같은 트랜잭션의 sequence 갱신을 사용한다.

CLI는 aag remind-expirations --batch-size 500 --max-batches 20와 --dry-run을 제공한다. DB 기준 시각과 (expires_at,id) keyset을 사용하고 최대 10,000개 후보를 처리한다. 이미 발행된 이벤트를 anti-join으로 제외하고 수신 거부·무효 대상도 후보 단계에서 제외하여 다음 실행이 같은 앞부분에 갇히지 않게 한다. 동시 실행도 DB unique로 중복을 방지한다. dry-run은 알림·sequence·운영 이력을 포함해 DB에 쓰지 않는다.

Kubernetes CronJob은 매시 5분(UTC), concurrencyPolicy=Forbid, 실행 제한 10분, 성공 이력 1개·실패 3개를 기본으로 한다. 웹 프로세스 안의 타이머를 추가하지 않는다. MaintenanceRun에 job_name/start/finish/status/scanned/emitted/skipped/error_code를 90일 보관하고 관리자 운영 화면에 마지막 성공·실패·지연을 표시한다. 일반 실행마다 오래된 운영 이력을 최대 1,000개씩 정리하며 dry-run에서는 정리하지 않는다. 키·사용자·사유 본문은 운영 로그에 기록하지 않는다. 감지가 활성화된 뒤 2시간 이상 성공이 없으면 운영 점검 대상으로 표시한다.

### D3 키 교체 준비와 예외 재검토

키 상세의 '새 키로 교체 준비'는 기존 name/scopes를 채운 발급 폼을 연다. 현재 발급 가능 상태와 권한을 다시 검사하고 새 키는 한 번만 보여준다. 사용자가 도구에 반영한 뒤 사유를 입력해 이전 키를 폐기하며 자동 폐기·자동 연장은 하지 않는다. 토큰을 URL·초안·감사에 저장하지 않는다. 예외는 기존 hash/fingerprint를 보여주고 재검사·새 예외 검토로 연결하며 다른 content_hash에 연장하지 않는다.

## 8. E 검색과 공유

### E1 발견 링크와 요약 F09

발견 화면의 severity/engine/q/finding/occurrence를 URL에 둔다. 공유 주소는 /jobs/{id}?tab=findings&finding={fingerprint}&occurrence={n}이다. 중복 fingerprint는 저장된 결과 배열에서의 0-based occurrence로 구분한다. 없는 항목은 '이 결과에서 항목을 찾을 수 없습니다'를 표시하고 다른 발견을 선택한 것처럼 보이지 않게 한다. 자동 갱신은 유효한 선택을 유지한다.

'발견 링크 복사', '판정 요약 복사', 'Markdown 다운로드', '인쇄'를 상세 도구 메뉴에 제공한다. 링크 복사는 접근 권한을 부여하지 않으며 비로그인 사용자는 A1을 통해 같은 항목으로 돌아온다. 읽기용 화면 경로는 /jobs/{id}/summary이며 인쇄는 이 인증된 화면과 print CSS를 사용하고 브라우저의 PDF 저장을 이용한다.

GET /api/scans/{id}/summary?format=markdown은 기존 scan:read/owned_job 권한을 따른다. 출력에는 소스/ref/commit/hash, 생성 시각(UTC), profile, 원래·최종 판정, coverage와 제한, 심각도별 개수, 상위 20개 발견, 원본 링크를 포함한다. 공개 검토 상태·결정 사유는 현재 해당 검토를 조회할 수 있는 interactive session에만 추가하고 API 키 응답에서는 검토 섹션을 완전히 제외한다. 전체 개수와 생략 개수를 명시하며 순서는 심각도→engine/rule/path/line이다. 내부 코멘트·초안·자격증명·원본 오류·전체 Raw JSON은 제외한다. Markdown의 사용자 문자열은 escape하고 raw HTML 및 임의 URL을 만들지 않는다.

### E2 통합 검색 F08

상단 검색 버튼과 /search 페이지를 제공한다. 기본 범위는 personal이며 staff에게 review/all을 선택할 수 있게 한다. 결과 유형은 scans/reviews/findings이고 탭별로 조회한다. 보드는 별도의 기존 검색을 유지한다. 전역 단축키는 Cmd/Ctrl+K이며 입력창·IME 조합 중에는 가로채지 않는다.

GET /api/search는 interactive session 전용이며 q(2~200자, 최대 8개 토큰), type, scope, page_size(기본 25, 최대 50), cursor를 받는다. 지원 필드는 작업 ID·소스·ref/commit, 검토 대상·요청/결정 사유, 발견 title/rule/path/engine/action이다. CVE는 엔진이 보고한 rule/title에 존재하는 값만 검색하고 원본 소스를 재수집하지 않는다. 내부 코멘트·키 원문·초안·전체 증거 JSON은 색인하지 않는다.

권한 predicate를 limit/count보다 먼저 적용한다. staff review scope는 기존 검토 접근 범위와 일치시키고, 검색 문서만의 권한 규칙을 만들지 않는다. 결과 개수·snippet·자동완성에도 같은 범위를 적용한다. 조회는 escaped literal token AND이며 SQL wildcard·정규식·고급 DSL은 제공하지 않는다. 정렬은 created_at desc, ID desc 및 발견 ordinal로 결정하고 cursor도 그 순서를 포함한다.

FindingIndex는 job_id, ordinal, fingerprint, engine, rule, severity, title, path, line, action, search_text, schema_version을 가진다. unique(job_id,ordinal), job_id·fingerprint·rule·job-created 순서의 인덱스를 둔다. Job.finding_index_version으로 색인 상태를 기록한다. 완료된 결과와 projection은 같은 트랜잭션에서 저장하고 캐시 재사용도 새 job 소유권으로 색인한다. 검토 최종 판정은 원본 Job/Review join으로 현재 값을 읽는다.

기존 결과는 aag reindex-findings --batch-size 100으로 keyset backfill한다. 누락·이전 버전 색인은 index_complete=false로 표시하고 '검색 결과 0개'와 '검색 준비 중'을 구분한다. PostgreSQL과 SQLite의 같은 fixture 결과를 확인한다. 외부 검색 서버를 도입하지 않으며, 실제 데이터량에서 지연이 큰 경우에만 별도 인덱스 최적화를 후속 검토한다.

## 9. 데이터 변경과 공통 권한

| 데이터 | 변경 | 주요 제약 |
| --- | --- | --- |
| OIDCState | return_to nullable | 기존 state는 / 복귀 |
| SavedView | 신규 | owner/resource/name unique, 기본 보기 교체 직렬화, revision |
| Job | origin_job_id, lineage_root_id, target_commit, rerun_mode, finding_index_version | 본인 계보 검증, 실패한 snapshot 의도 보존, 기존 root backfill |
| Review | assignee/claimed/revision/workflow/closed_reason/previous_review_id | 자기 claim/승인 차단, 후속 하나, CAS |
| ReviewEvent | 신규 | 기존 검토 조회 권한·사유 길이·안정적 페이지 |
| Notification | typed resource, nullable job_id | 유효 target 조합, 수신자+event_key unique 유지 |
| NotificationPreference | review_updates, credentials, exceptions | 추가 필드는 기본 수신, null patch 금지 |
| MaintenanceRun | 신규 | 민감 본문 없는 집계, 최신 실행 조회 |
| FindingIndex | 신규 | job/ordinal unique, 원본 권한 선적용 |

마이그레이션은 기능 PR 순서대로 선형 연결한다. 먼저 additive schema와 읽기 호환을 배포하고 데이터를 backfill한 뒤 새 쓰기를 켠다. 운영 데이터가 생긴 뒤 다운그레이드로 신규 이력·알림을 지우지 않는다. 롤백은 새 동작을 끄고 읽기 호환 버전을 유지한다. 과거 데이터를 임의의 권한·엔진 버전·검토 담당자로 추정 보정하지 않는다.

개인 보기·검토 mutation·설정·초안 복구는 interactive session 기준이다. 재검사·이력·비교·요약은 기존 scan:read/write scope ceiling을 유지한다. 관리자의 전체 조회 능력이 다른 사용자의 이름으로 검사나 검토 요청을 만드는 권한을 주지는 않는다.

## 10. 배포와 완료 기준

- A의 복귀·초안·목록 복원은 서버와 프런트가 같은 계약을 지원하는 버전에서 활성화한다. 새 초안 schema를 읽지 못하면 복구하지 않고 삭제 여부를 안내한다.
- review/search/expiry 확장에는 AAG_REVIEW_WORKFLOW_ENABLED, AAG_SEARCH_ENABLED, AAG_EXPIRY_REMINDERS_ENABLED를 둔다. API와 UI에서 모두 검사하며 default/stg/prod 예시는 검증 전 false다. 기존 검토 결정과 기존 알림은 flag off에서도 동작한다.
- review 확장 데이터를 쓰기 시작한 뒤에는 workflow를 이해하지 못하는 구형 decision handler로 롤백하지 않는다. flag off 시 새 전이는 차단하되 기존 확장 상태의 안전한 조회와 이미 배정된 요청의 권한 검사는 유지한다.
- 만료 알림 flag off는 새 감지만 멈추며 기존 알림의 조회·읽음·보관과 typed target 권한 검사는 유지한다.
- 새 API는 권한·동시성·미지의 입력을 검증하고 의미 있는 backend/Playwright 회귀를 추가한다. UI 변경 PR마다 desktop dark/light, mobile, empty/error 및 핵심 상태 스크린샷을 포함한다.
- PR별로 관련 검증을 실행하고, 제품 기능을 출시할 때 Python lint/format/pytest, frontend build/unit/format/e2e, Astro build, SQLite와 PostgreSQL의 실제 migration 및 동시성 시나리오를 확인한다. 문서 PR에서 제품 테스트가 통과했다고 대체 주장하지 않는다.

| 기능 | 사용자가 확인할 수 있는 완료 기준 |
| --- | --- |
| F01 | 기존 작업에서 세 필드 재입력 없이 재검사하고 이전 작업으로 이동할 수 있다. snapshot 실패가 latest로 바뀌지 않는다 |
| F02 | 새로고침·세션 만료 뒤 같은 계정의 초안을 복구하고 다른 계정에서는 보이지 않는다 |
| F03 | 필터된 3페이지에서 상세를 보고 목록으로 돌아오면 같은 조건·위치이며 저장된 보기가 다음 로그인에도 남는다 |
| F04 | 로그아웃 상태의 발견 링크로 SSO 후 해당 발견으로 돌아온다 |
| F05 | 정책 변경·엔진 누락·줄 이동·예외 적용을 실제 해소와 혼동하지 않고 두 검사를 비교한다 |
| F06 | 동시 claim은 하나만 성공하고 다른 담당자의 결정은 차단된다 |
| F07 | 겹쳐 실행한 감지에서도 단계별 알림은 하나이며 만료 전에 교체 준비 화면으로 이동한다 |
| F08 | 허용된 ID·CVE·파일 경로로 찾을 수 있고 숨겨진 작업의 개수·snippet은 나오지 않는다 |
| F09 | 공유 링크가 같은 발견을 선택하며 요약에 coverage/원래·최종 판정과 생략 수가 포함된다 |
| F10 | 철회·보완·후속 검토의 원래 기록이 남고 이전 승인 효력이 새 내용으로 넘어가지 않는다 |

## 11. 기준 소스

모든 경로는 기준 main의 실제 파일이며 향후 생성할 파일은 각 실행 플랜에서 별도로 표시한다.

- [검사 화면](../../../frontend/src/pages/Scans.tsx), [검토 화면](../../../frontend/src/pages/Reviews.tsx), [공통 상태 처리](../../../frontend/src/components.tsx), [앱·로그인](../../../frontend/src/App.tsx).
- [검사·검토 API](../../../backend/aag/routes_scans.py), [소스 접수](../../../backend/aag/sources.py), [공통 서비스](../../../backend/aag/service.py), [발견 fingerprint](../../../backend/aag/policy.py).
- [현재 모델](../../../backend/aag/models.py), [인증](../../../backend/aag/auth.py), [OIDC·키 API](../../../backend/aag/routes_identity.py), [알림 생성](../../../backend/aag/notifications.py), [알림 API](../../../backend/aag/routes_notifications.py).
- [React Router navigation blocking](https://reactrouter.com/how-to/navigation-blocking), [useBlocker](https://reactrouter.com/api/hooks/useBlocker): SPA 이탈 차단과 hard reload의 처리 범위를 구분하는 기준.

