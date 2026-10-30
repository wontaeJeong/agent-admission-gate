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
| Keycloak/SSO | routes_identity.py | PKCE·서명·nonce/issuer/audience·만료·재사용 테스트; 실제 IdP 연결 별도 |
| user/admin + reviewer 직교 | auth.py + 모든 router | owner isolation, reviewer/admin, 비활성 사용자, last admin |
| 1회 노출·90일 API 키 | APIKey, 개인/관리자 화면 | 해시 보관·만료·폐기·scope ceiling |
| 8자리/10분 Device Code | DeviceClient/Grant | 승인/거절·poll interval·한 번 교환·만료 |
| 검토·코멘트·감사 | Review/Comment/Audit | 자기 승인 금지, 중복 결정, 내부 코멘트 비노출 |
| 예외 allowlist | source/hash/fingerprint/expiry | 다른 소스/내용에 적용 금지, 다음 검사 적용 |
| 사이드바/라우트/8개 상세 탭 | App.tsx, Scans.tsx | 브라우저 탐색·모바일 overflow·실 데이터 |
| 역할별 대시보드/Recharts | Dashboard.tsx, routes_metrics.py | UTC zero-fill, 7/14/30/90, role scope |
| API·토큰 사용량/CSV | Usage, routes_metrics.py | onprem/bedrock/systemone 분리, null와 0 구분 |
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
