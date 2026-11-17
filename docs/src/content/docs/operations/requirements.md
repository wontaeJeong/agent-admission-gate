---
title: 요구사항 추적과 검증 범위
---

2026-10-30까지 대화에서 확인된 제품 요구사항을 독립 저장소에 반영했습니다. 이 문서는 사내 코드와 동작이 완전히 같다는 주장이 아니라 구현 지점·검증 방식·외부 전제조건을 연결하는 기준입니다.

| 요구사항 | 구현 지점 | 검증/운영 전제 |
| --- | --- | --- |
| Git/ZIP, static/full, async/sync | service.py, routes_scans.py | source 경계/상태 전이 테스트; 실 Git 네트워크는 배포 검증 |
| 취소, 시간/용량/동시성, 재시작 | sources.py, service.py | subprocess timeout/cancel/복구 테스트 |
| 캐시·강제 재검사 | content hash + profile/policy/config | 소유자 격리, 캐시 재사용, 예외 재평가 |
| Cisco MCP/Skill | scanners.py, tools.json/SKILL.md 감지 | 실제 고정 버전 바이너리 smoke + 정상/집계 위험도/실패 계약 테스트 |
| Syft/Grype/Grant/OSV | native adapters, SBOM 전달/수 대조 | Syft/Grant 고정 바이너리 허용/거부 smoke; Grype DB·OSV 운영 확인 별도 |
| ALLOW/REVIEW/BLOCK + Action | policy.py, findings/action UI | critical block, incomplete review, model downgrade 금지 |
| 온프렘·Bedrock·SystemOne | llm.py | provider contract fixture, usage 결측/실패; 실 계정 별도 |
| Keycloak/SSO | routes_identity.py + identity_lifecycle.py | PKCE·서명·nonce/issuer/audience·만료·재사용 및 비활성/그룹 제거·장애 시 차단 테스트(모의 계약); 실제 Keycloak/상위 IdP 동기화·verifier 연결은 배포자 검증 필수 |
| 로그인 복귀·세션 만료·계정 바인딩 (A1) | return_paths.py, OIDCState.return_to, App.tsx, session.tsx, api.ts | test_return_paths/test_session_return: SSO·로컬 로그인 뒤 검증된 pathname/query 복귀, callback 목적지는 저장 state만 참조; test_account_bound_mutations: 이전 폼 계정과 새 쿠키 계정 불일치 409·쓰기 없음; session 단위/session-return E2E: 만료 전 flush·중복 401 병합·늦은 응답 폐기·403 권한 변경 안내·대시보드 복귀, GET 503/연결 오류의 명시적 재시도·mutation 미재전송·로그인 유지·두 탭 격리. 임의 발견 선택 연결은 E1/F09에서 검증하며 실제 IdP 연결 검증은 별도 |
| 계정별 초안·이탈 보호 (A2/F02) | drafts.ts, useDraft.ts, DirtyForms.tsx, DraftRecovery.tsx, main.tsx와 검사·검토·게시판 폼 | drafts 단위: 24시간 경계, 20개·합계 256KiB, schema와 account/target 격리, 원시 필드 allowlist·URL 인증 정보 제외. drafts E2E: 두 폼 단일 경고, 새로고침·SSO 뒤 명시적 복구, 탭 변경·visibility/pagehide 동기 flush, 저장 실패 표시와 폼 유지, 같은 target GET5xx/network·재시도 중 입력/초점 유지와 오류 표시(401/403/404는 캐시 제거), 로그아웃/계정 전환 정리와 stale cleanup 차단, 권한 재확인·내부 코멘트 자격 상실 제거, 결정 완료·mutation409·게시글 revision 변경의 읽기 전용 초안 및 새 revision 확인 뒤 명시적 재편집, 현재 admin만 공지 수정, 폼 수명/tuple 소유권/제출 버전 확인으로 늦은 응답의 새 초안 삭제·이동 차단, 게시판 flag. PAT·ZIP 본문/핸들·API 키 원문은 저장하지 않으며 같은 탭에서만 복구. C2 신규 검토 상태는 후속 범위 |
| 목록 복귀·저장된 보기 (A3/F03) | saved_views.py, routes_saved_views.py, SavedView migration, listNavigation.ts, SavedViews.tsx와 검사·검토 목록/상세 | test_saved_views: 본인/account-bound/interactive 제한, 20개·이름/필터 allowlist, revision CAS, 기본 보기 교체 시 이전 revision 증가, SQLite/PostgreSQL 실제 동시성·migration 왕복. listNavigation 단위와 saved-views E2E: query/페이지/행/스크롤 복귀·직접 진입·history·범위 밖 페이지 조정, 검색 debounce, 명시 URL 우선·재로그인 기본 보기, 권한 상실 안내·수정, 두 탭 충돌·명시적 재편집, 늦은 저장/조회 완료 보호. C1/E2 필터 확장 시 versioned allowlist도 함께 갱신. [PR #18](https://github.com/wontaeJeong/agent-admission-gate/pull/18): 동일 화면 쿼리 변경 시 요청 경로에 맞는 결과 이후에만 페이지·스크롤 복원; E1 검증 중 확인한 즉시 스크롤→필터/페이지/보기 적용 경계는 현재 계정·URL·결과를 확인한 rememberPosition을 탐색 직전에 호출해 보존; BFCache 없는 문서 간 실제 뒤로가기와 새 빈 쿼리 진입·재로그인·새로고침 구분 |
| 이전 조건으로 재검사 (B1/F01) | ScanRequest·Job lineage, scan_lineage migration, sources.clone, Scans.tsx·scanRerun.ts | 소유자/동일 소스 유형/정규 Git URL 확인, ZIP은 명시적 원본만 연결; checkout 전 snapshot 의도 저장, SHA-1/SHA-256 임시 Git fixture와 fetch 실패·timeout·HEAD 불일치의 latest 대체 금지; 기존 승인 복제 없음·캐시의 현재 예외 재평가; SQLite/PostgreSQL backfill·왕복; rerun E2E의 명시 제출·PAT/ZIP 재입력·초안 선택·불명확한 POST 후 최신 목록 확인·늦은 GET/POST 폐기. 신규 메타데이터 라벨 한·영 제공. 실 원격 서버의 임의 commit fetch 허용 여부는 배포 환경에 따름. [PR #19](https://github.com/wontaeJeong/agent-admission-gate/pull/19): 최종 검토·CI 대기 |
| 특정 발견 공유·읽기용 요약 (E1/F09) | findingSelection.ts, Scans.tsx, ScanSummary.tsx, scan_summary.py, routes_scans.py | 전체 저장 배열 기준 fingerprint/0-based occurrence, 중복·누락·잘못된 선택의 대체 금지, severity/engine/q와 로그인·polling·탭 이동 유지. owned_job/scan:read 요약은 명시 필드만 사용하며 API 키에는 검토 섹션 전체 제외; 현재 조회 가능한 세션에만 공개 검토 상태/결정 사유 포함. 심각도→engine/rule/path/line 상위20개·전체/생략 수·UTC·coverage/한계·원래/최종 판정, 사용자 Markdown escape·자격증명/오류/내부 코멘트/Raw JSON 제외. 인증된 요약 화면·복사 실패·Markdown 다운로드·모바일·print CSS와 한/영 문구를 검증. literal q=`all`/`allow`의 실제 순차 입력·URL 유지·필터 초기화 회귀 포함. [PR #20](https://github.com/wontaeJeong/agent-admission-gate/pull/20): 최종 CI·독립 재검토 대기 |
| user/admin + reviewer 직교 | auth.py + 모든 router | owner isolation, reviewer/admin, 비활성 사용자, last admin |
| 1회 노출·90일 API 키 | APIKey, 개인/관리자 화면 | 해시 보관·만료·폐기·scope ceiling |
| 8자리/10분 Device Code | DeviceClient/Grant | 승인/거절·poll interval·한 번 교환·만료·교환 시 사용자 확인; API 키 기본 비활성 |
| 검토·코멘트·감사 | Review/Comment/Audit | 자기 승인 금지, 중복 결정, 내부 코멘트 비노출 |
| 개인 알림함·벨·수신 설정 | notifications.py, routes_notifications.py, Notifications.tsx | 실제 검사/검토/공개 코멘트 연결, 읽음·보관·복원·필터·페이지, 트랜잭션 중복 방지, 세션/권한/내부본문 격리, 90일 보존, 브라우저·모바일·계정 전환 |
| 예외 allowlist | source/hash/fingerprint/expiry | 다른 소스/내용에 적용 금지, 다음 검사 적용 |
| 사이드바/라우트/8개 상세 탭 | App.tsx, Scans.tsx | 브라우저 탐색·모바일 overflow·실 데이터 |
| 사용자 설정·표시 이름 | routes_profile.py, AccountSettings.tsx | 본인 세션 전용·계정/감사 식별자와 분리, 이름 저장/초기화·이름 소유자 격리, 브라우저 로컬 화면 설정 구분 |
| 역할별 대시보드/Recharts | Dashboard.tsx, routes_metrics.py | UTC zero-fill, 7/14/30/90, role scope |
| API·토큰 사용량/CSV | Usage, routes_metrics.py | REST/MCP HTTP 요청과 이전 부분 MCP 도구 호출 구분, 역할 범위, onprem/bedrock/systemone 분리, null와 0 구분 |
| 공지/VOC/내부 검토 | routes_boards.py, Boards.tsx | Markdown XSS, visibility, revision conflict, 읽음/상태/고정 |
| stg 비노출 기능 개발 | AAG_BOARDS_ENABLED | false이면 메뉴와 API 모두 숨김 |
| Graphite & Plum / light·dark | styles.css | 6개 palette/mode 조합 대비 테스트 |
| CSS 기반 기존 로고 | Brand.tsx, original assets | 동일 SVG path, CSS+favicon 동시 변경 브라우저 테스트 |
| 웹폰트/코드 하이라이트 | Pretendard/D2Coding, Markdown | 자체 제공 폰트, 다크 코드 고정, raw HTML 미허용 |
| API/MCP 가이드·CLI | Integrations.tsx, cli.py, mcp_server.py | 공통 서비스/권한, CLI exit codes, 실제 MCP transport |
| Astro Starlight 문서 | docs/ | 문서 빌드 |
| 컨테이너/K8s/DB migration | Dockerfile, deploy/, Alembic | migration 및 구성 검증; 이미지·클러스터 실행 별도 |

## 범위 구분

실행 중인 임의 MCP 서버에 연결해 도구를 실행하거나 업로드 코드를 샌드박스에서 실행하는 제품이 아닙니다. 이 버전의 MCP 검사는 업로드/저장소의 `tools.json` 정적 메타데이터이며, 네트워크 endpoint와 stdio 실행 스캔은 기본 공격 표면에 포함하지 않습니다.

SystemOne은 현재 보조 검토 질문(noul)으로 통합했습니다. 임의 choice/score 질문 실행 서비스, 운영 과금 단가 편집, 지속적인 세션 포스트모템 수집은 이 제품의 구현 요구사항으로 확정되지 않았습니다. 특히 Claude Code 세션/커밋/릴리스 포스트모템 프롬프트 논의는 본 제품의 사용자 데이터 수집 기능으로 전환하지 않았습니다.

사내 인증·엔진·정책 코드가 제공되지 않았으므로 내부 구현의 모든 세부 동작을 재현했다고 주장하지 않습니다. 새로운 확정 요구사항은 이 표에 추가하고 실제 계약·UI·테스트와 함께 반영합니다.
