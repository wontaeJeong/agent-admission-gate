---
title: 배포·운영·확장
---

## 단일 서비스 배포

웹 정적 빌드·REST·MCP·Runner를 한 컨테이너, 한 프로세스, 한 replica로 시작합니다. SQLite는 개발, 운영은 PostgreSQL입니다. 이 저장소는 실제 클러스터에 배포하지 않으며 이미지 registry나 DNS를 자동 생성하지 않습니다.

기본 Docker target `runtime`에는 Git/내장 정적 검사기만 있습니다. `scanners` target은 고정된 Syft/Grype/Grant 이미지의 바이너리와 격리된 Cisco Python tool 환경을 추가합니다. 모델 endpoint/권한, Grype DB 준비, 필요시 OSV 설치는 별도입니다. 미설정 엔진은 REVIEW이므로 기능을 테스트하려면 관리자 운영 상태에서 설치 상태부터 확인하세요.

```bash
docker build --target runtime -t aag:local .
docker build --target scanners -t aag:scanners .
```

운영 배포 전에 실제 이미지 tag 또는 digest로 예제 manifest를 변경합니다. 예제 registry 태그는 게시된 이미지를 보장하지 않습니다.

## Kubernetes / Keycloak

`deploy/k8s/overlays/stg`와 `prod`는 각각 독립 namespace를 사용합니다. 서로 다른 DB/Secret/IdP Client redirect URI를 지정합니다. 예제 네임스페이스는 참고용이며 기존 GitOps 구조에 맞게 조정합니다.

1. PostgreSQL(예: CNPG)과 TLS/Ingress를 준비하고 backup/restore를 검증합니다.
2. `aag-secrets`에 DB URL, OIDC client secret, 최초 관리자 subject를 넣습니다. 예제 Secret을 그대로 적용하지 않습니다.
3. `aag-config`의 HTTPS public URL/issuer/client ID를 실제 공개 설정으로 교체합니다. 공용 Keycloak realm에서 서비스별 client를 분리할 수 있습니다. 기업 SSO broker 구성은 해당 환경에서 관리합니다.
4. Keycloak confidential client에 정확한 `{PUBLIC_URL}/sso/callback` redirect URI와 PKCE S256을 설정합니다. 자체 user/admin/reviewer 권한은 DB에서 관리합니다. `AAG_OIDC_ADMIN_SUBJECTS`는 새 사용자의 초기 관리자 지정에만 쓰며 username/email과 비교하지 않습니다.
5. namespace/config/secret을 먼저 제공한 뒤 `alembic upgrade head`를 한 번 실행합니다. ArgoCD 예제 migration은 **Sync wave -1**, deployment는 기본 wave 0입니다. DB/config/secret도 먼저 존재해야 합니다.
6. 단일 replica를 배포하고 readiness, OIDC 로그인, 권한, Git/ZIP, 실제 engine/model 응답, 예외·승인·취소를 검증합니다.

Ingress는 21 MB 본문과 90초 응답 대기를 예시로 제한합니다. cluster egress는 DNS, 승인 Git host, OIDC, PostgreSQL, 선택된 모델, 업데이트 proxy만 허용하세요. 일반 Kubernetes NetworkPolicy는 FQDN 필터를 제공하지 않으므로 CNI FQDN 정책 또는 egress proxy로 보완합니다. 제공된 ingress 정책의 controller namespace는 환경에 맞게 수정하세요.

`AAG_ENVIRONMENT=stg|prod`는 HTTPS URL, secure cookie, OIDC를 강제합니다. 공지/VOC는 기본 비활성화되므로 공개 시점을 운영자가 설정합니다. 인증정보를 생성 프롬프트/스크린샷/저장소에 넣지 마세요.

## 외부 엔진과 오프라인 운영

Syft는 native `syft-json`으로 SBOM을 만들고 Grype/Grant에 동일 파일을 전달합니다. Grant 패키지 수가 Syft와 다르면 부분 검사로 처리합니다. UNKNOWN·복합 라이선스는 REVIEW입니다. 기본 허용 목록은 코드에 버전 관리됩니다.

Grype는 데이터베이스가 없거나 만료/오류로 검사에 실패하면 통과시키지 않습니다. 별도 운영 작업에서 검증된 DB를 반입하고 `AAG_GRYPE_DB_CACHE_DIR`로 읽을 경로를 지정할 수 있습니다. `AAG_SCANNER_REVISION`은 engine/DB/policy 갱신마다 변경합니다. 캐시 TTL은 최대 유효기간일 뿐 최신 취약점 보증이 아닙니다. 필요하면 TTL을 0으로 두거나 강제 재검사하세요.

스캐너 stdout/stderr는 크기를 제한해 캡처하지만 raw 출력은 그대로 영구 저장하지 않습니다. normalized findings, exit code, duration, engine error category를 보존합니다. 원본 파서 진단이 필요하면 같은 engine 버전의 격리된 환경에서 재현하세요.

## 관측과 비용

REST와 MCP는 각각 서버가 받은 HTTP 요청을 기록합니다. MCP 초기화, 도구 목록 조회, 도구 호출, 오류 응답도 각각 HTTP 요청 한 건입니다. HTTP 오류는 상태 코드 400 이상이며 MCP 도구 오류가 HTTP 200으로 전달될 수 있으므로 도구 성공률이 아닙니다. MCP HTTP 기록은 이 버전 배포 이후부터 수집됩니다. 이전에 기록된 일부 MCP 도구 호출은 별도 항목으로 보존하고 HTTP 요청으로 환산하지 않습니다. 인증 실패 등으로 사용자가 확인되지 않은 요청은 관리자 전체 범위에만 표시됩니다. 요청 본문·인증정보·쿼리 문자열·임의 MCP 경로는 usage에 저장하지 않습니다.

시작 표식은 최초 수집 시점만 기록합니다. 이후 이전 버전으로 되돌리거나 서비스가 중단된 기간의 수집 공백은 자동 감지하지 못하므로 시작 이후 값도 불완전할 수 있습니다. 배포·복구 이력과 함께 해석하세요.

`GET /api/metrics`는 `rest`, `mcp`, `legacy_mcp_tool_calls`와 일별 `rest_http_requests`, `mcp_http_requests`, `legacy_mcp_tool_calls`를 반환합니다. `mcp_http_observed_since`는 MCP HTTP 집계 시작 시각(Unix 초)입니다. 일별 `mcp_http_coverage`는 시작 전 `unknown`(요청 수 null), 첫날 `partial`, 이후 `possibly_partial`입니다. 이후에도 공백이 없었다고 보장하지 않습니다. 내부 시작 시각 표식은 사용 이벤트나 CSV에 포함되지 않으므로 보존 정책에서 삭제하지 않아야 합니다. 표식이 없으면 시작 시각과 일별 MCP 데이터는 null입니다. 기존 `api`와 `series.api_requests`는 호환성을 위해 유지되지만 사용 중단 예정이며 REST HTTP와 이전의 일부 MCP 도구 호출이 섞여 있고 새 MCP HTTP 요청은 포함하지 않습니다. 총 요청 수로 사용하지 말고 새 필드로 전환하세요. `deprecated_fields`가 이 필드를 식별합니다. CSV는 기존 `kind`를 유지하고 `protocol`과 `unit`을 추가해 `http_request`, `legacy_partial_tool_call`, `model_request`를 구분합니다. 개인·검토 범위의 usage는 본인 기록이며 전체 범위는 관리자 전용입니다.

LLM provider/model/latency/status와 input/output/cache token도 기록합니다. 7/14/30/90일 UTC 집계와 CSV를 제공합니다. 모델 호출은 자동 재시도하지 않으므로 하나의 실제 호출을 하나의 usage record로 기록합니다. 응답에 토큰이 없으면 null이며 결측 요청 수를 함께 보여줍니다. 비용 단가/청구서가 없으면 0으로 계산하지 않습니다.

관리자는 대화형 로그인 세션으로 `GET /api/admin/audit/export?days=30`에서 감사 기록 CSV를 내려받을 수 있습니다. `days`는 1~90일이며 `action`으로 정확히 일치하는 이벤트를 선택할 수 있습니다. 한 번에 10만 건을 초과하면 더 짧은 기간을 선택해야 합니다. API 키로는 접근할 수 없으며, 내려받은 파일은 조직의 감사 기록 접근·보관 정책에 따라 보호해야 합니다.

서비스의 정상 상태는 외부 엔진 전부가 준비되었다는 뜻이 아닙니다. 운영 상태 화면과 full smoke test를 별도로 확인하세요. 감사·사용량 테이블의 장기 보관/삭제 정책과 백업 접근 권한은 조직 기준에 맞게 정하세요.

## 확장 계획

현재 구현은 3만 사용자/고가용성을 검증한 구조가 아닙니다. 사용자가 늘어나기 전에 다음을 단계적으로 전환합니다.

- 프로세스 큐 → durable broker + lease/idempotency/worker heartbeat; DB 상태 전이의 원자적 claim. 업로드는 암호화 객체 저장소와 보관 정책으로 이동합니다.
- 일시 clone credentials는 DB 평문 저장 대신 짧은 수명의 외부 credential broker로 이동합니다.
- API와 격리 scan worker 분리, CPU/memory quota, engine별 풀·timeout·rate limit. 이후에 API replica를 늘립니다.
- PostgreSQL HA, 복구 리허설, 인덱스/파티셔닝/통계 rollup, 감사 장기 보관. 현재 관리자 목록은 사용자 1000, 키/예외 500/1000 표시 상한이 있습니다.
- 조직/프로젝트 tenancy, 명시적 공유 모델과 접근 정책은 별도 설계합니다. 이번 모델은 개인 소유 + 검토/관리자 운영 범위입니다.

운영 릴리스 전에는 실제 engine 바이너리, 최신 취약점 DB, IdP, Bedrock/온프렘 네트워크, PostgreSQL 및 Kubernetes 검증과 부하/보안 검토가 필요합니다.
