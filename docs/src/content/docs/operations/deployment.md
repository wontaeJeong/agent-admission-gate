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
4. Keycloak confidential client에 정확한 `{PUBLIC_URL}/sso/callback` redirect URI와 PKCE S256을 설정합니다. 자체 user/admin/reviewer 권한은 DB에서 관리하며 아래 lifecycle 검사가 추가 상한을 적용합니다. `AAG_OIDC_ADMIN_SUBJECTS`는 새 사용자의 초기 관리자 지정에만 쓰며 username/email과 비교하지 않습니다.
5. namespace/config/secret을 먼저 제공한 뒤 `alembic upgrade head`를 한 번 실행합니다. ArgoCD 예제 migration은 **Sync wave -1**, deployment는 기본 wave 0입니다. DB/config/secret도 먼저 존재해야 합니다.
6. 단일 replica를 배포하고 readiness, OIDC 로그인, 권한, Git/ZIP, 실제 engine/model 응답, 예외·승인·취소를 검증합니다.

Ingress는 21 MB 본문과 90초 응답 대기를 예시로 제한합니다. cluster egress는 DNS, 승인 Git host, OIDC/Keycloak, 상위 DS verifier, PostgreSQL, 선택된 모델, 업데이트 proxy만 허용하세요. 일반 Kubernetes NetworkPolicy는 FQDN 필터를 제공하지 않으므로 CNI FQDN 정책 또는 egress proxy로 보완합니다. 제공된 ingress 정책의 controller namespace는 환경에 맞게 수정하세요.

`AAG_ENVIRONMENT=stg|prod`는 HTTPS URL, secure cookie, OIDC를 강제합니다. 공지/VOC는 기본 비활성화되므로 공개 시점을 운영자가 설정합니다. 인증정보를 생성 프롬프트/스크린샷/저장소에 넣지 마세요.

## SSO 계정·그룹 수명주기와 API 키

**API 키는 기본 차단입니다.** `AAG_API_KEYS_ENABLED=false`이면 기존 Bearer 키의 REST/MCP 사용, 키 발급, Device Code 발급·교환이 모두 차단됩니다. 기존 키 목록과 폐기는 계속 사용할 수 있습니다. 로컬 개발에서만 키가 필요하면 명시적으로 `true`로 설정하세요. OIDC 키와 Device Code는 별도로 아래 두 정보원이 모두 작동해야 합니다. 이 저장소는 상위 DS verifier를 제공하지 않으며, Keycloak/DS 연동을 실제 검증했다고 주장하지 않습니다.

`AAG_OIDC_LIFECYCLE_SYNC_CONFIRMED=false`인 기본 구성에서는 기존 대화형 OIDC 로그인과 세션이 계속 동작합니다. 이때 앱은 저장된 로컬 활성 상태·역할을 사용하며, 이미 로그인한 사용자의 상위 계정 비활성화나 그룹 제거를 감지하지 못합니다. 이 제한을 운영 위험으로 취급하고 라이프사이클 연동을 구성·검증하기 전에는 상위 IdP의 변경이 세션에 반영된다고 가정하지 마세요. 확인을 마친 후 이 설정을 `true`로 켜면 대화형 로그인과 모든 세션도 두 정보원을 매 요청 확인하고 오류 시 차단됩니다.

1. Keycloak issuer가 `https://<host>[/prefix]/realms/<realm>` 형식이고 `sub`가 해당 realm의 불변 user ID여야 합니다. 별도의 최소 권한 confidential service account를 생성하고 `AAG_OIDC_LIFECYCLE_CLIENT_ID`와 Secret인 `AAG_OIDC_LIFECYCLE_CLIENT_SECRET`을 설정합니다. 해당 계정은 대상 사용자와 그 직접 그룹 전체를 Keycloak Admin REST API로 읽을 수 있어야 합니다. 기본 로그인 client보다 권한을 넓히지 마세요.
2. `AAG_OIDC_ACCESS_GROUP_ID`, `AAG_OIDC_ADMIN_GROUP_ID`, `AAG_OIDC_REVIEWER_GROUP_ID`에 이름이나 경로가 아닌 불변 Keycloak 그룹 ID를 설정합니다. 세 ID가 모두 필요합니다. 접근 그룹은 모든 로그인 및 API 접근에 필수입니다. 관리자/검토자 그룹은 DB에서 이미 부여된 자격의 상한일 뿐 새로운 권한을 부여하지 않습니다. 직접 그룹만 사용하므로 중첩·상속 그룹은 필요한 직접 멤버십으로 별도 구성하고 테스트하세요.
3. 조직이 운영하는 **상위 DS의 authoritative verifier**를 TLS로 배포하고 `AAG_OIDC_UPSTREAM_VERIFIER_URL`과 별도 Secret인 `AAG_OIDC_UPSTREAM_VERIFIER_SECRET`을 설정합니다. 아래 계약을 구현해야 합니다. Keycloak broker 프로필 또는 그룹이 로그인 시에만 갱신되거나 캐시될 수 있으므로 Keycloak의 성공 응답만으로 상위 DS가 정상인지 판단할 수 없습니다. verifier가 실제 DS에 매 요청 조회하지 않거나 장애 때 캐시된 성공을 돌려주면 이 보안 경계는 성립하지 않습니다. TLS 인증서/신뢰 체인, 서비스 계정 권한, Keycloak subject와 상위 DS 계정의 정확한 매핑을 운영자가 관리하세요. 기본 신뢰 저장소에 없는 사설 CA는 PEM 번들을 안전하게 mount하고 `AAG_OIDC_LIFECYCLE_CA_BUNDLE` 경로로 지정합니다. lifecycle HTTP 연결은 환경 proxy와 `SSL_CERT_FILE`을 자동으로 사용하지 않으므로 Keycloak과 verifier에 직접 연결할 수 있어야 합니다.
4. 실제 환경에서 계정 비활성·삭제, 접근/관리자/검토자 그룹 제거, 재활성화, Keycloak 장애, DS/verifier 장애 및 stale cache를 각각 테스트합니다. 세션, 이미 발급된 키, 승인 대기·승인된 device grant, REST와 MCP를 모두 확인하세요. 그룹 멤버십 전달 지연과 provider별 동기화 주기를 측정하고 허용 가능한지 결정하세요. 이후에만 `AAG_OIDC_LIFECYCLE_SYNC_CONFIRMED=true`로 설정합니다. 이 값은 운영자의 확인 선언이며 서비스가 동기화를 검증했다는 자동 증거가 아닙니다. API 키가 필요하면 검증 후 별도로 `AAG_API_KEYS_ENABLED=true`를 설정합니다.

라이프사이클 확인을 켠 뒤 인증 시 Keycloak과 verifier를 매번 확인하며 둘의 그룹 교집합만 적용합니다. Keycloak이 계정 비활성을 명시하거나 verifier가 상위 DS 계정 비활성·삭제, 상위 DS 접근 그룹 제거 또는 Keycloak 접근 그룹 제거를 명시적으로 확인하면 세션, 발급된 키, 승인되지 않았거나 교환되지 않은 grant를 영구 폐기하고 해당 사용자의 device client를 비활성화합니다. Keycloak의 404는 gateway 오류와 구별할 수 없고, 페이지 단위 그룹 조회는 변경 중 누락될 수 있습니다. 이런 결과를 verifier가 확인하지 못하면 503으로 차단하되 자격증명은 폐기하지 않습니다. 복구 후 이전 키는 다시 유효해지지 않으므로 새 세션/키가 필요합니다. 관리자/검토자 그룹 제거는 다음 요청부터 해당 권한만 제거합니다. 연결 오류·거부·잘못되거나 오래된 응답은 503으로 차단하지만 일시 장애만으로 키를 영구 폐기하지 않습니다. 이미 실행 중인 요청은 소급 취소되지 않습니다. 일반 REST 요청마다 Keycloak service token 발급, 사용자 조회, 그룹 페이지 전체 조회(빈 마지막 페이지 포함), verifier 조회가 발생합니다. MCP 전송과 도구 실행은 각각 인증하므로 도구 호출에서 이 검사가 두 번 실행될 수 있습니다. 실제 페이지 수·왕복 지연·동시성·provider 부하와 장애 시 가용성을 부하 시험으로 측정하세요. 호출/지연 수치는 실환경에서 검증되지 않았습니다. health/readiness는 이 연동의 동작을 증명하지 않습니다.

### 상위 DS verifier 계약

서비스는 설정한 HTTPS URL에 `POST`하고 `Authorization: Bearer <verifier secret>`을 보냅니다. 본문은 `{"issuer":"<정확한 OIDC issuer>","subject":"<Keycloak sub>","access_group_id":"<필수 Keycloak 그룹 ID>","nonce":"<요청별 난수>"}`입니다. verifier는 서비스 인증을 검증하고, 매 요청 authoritative DS를 직접 확인하며 성공 시 다음 JSON을 반환해야 합니다(예시의 문자열은 자리표시자).

```json
{
  "issuer": "https://identity.example.com/realms/workspace",
  "subject": "immutable-keycloak-user-id",
  "access_group_id": "immutable-keycloak-access-group-id",
  "nonce": "same-request-nonce",
  "source_available": true,
  "enabled": true,
  "keycloak_access": true,
  "groups": ["immutable-keycloak-access-group-id"],
  "checked_at": 1790000000
}
```

`issuer`, `subject`, `access_group_id`, `nonce`는 요청과 정확히 일치해야 하고, `enabled`, `source_available`, `keycloak_access`는 명시적 boolean, `groups`는 위 Keycloak 그룹 ID로 매핑된 **완전한** 상위 DS 그룹 문자열 배열이어야 합니다. `enabled`는 상위 DS 계정 상태이며 `keycloak_access`는 동일 subject가 요청의 `access_group_id`로 지정된 Keycloak 필수 접근 그룹에 속하는지 독립적으로 확인한 결과입니다. verifier는 매 요청 상위 DS와 Keycloak을 신뢰할 수 있는 최신 원천에서 조회해야 하며, Keycloak의 페이지 누락·중간 변경 또는 단순 404를 제거 확인으로 취급해서는 안 됩니다. Keycloak 멤버십 확인은 일관된 스냅샷 또는 이와 동등하게 권위 있는 조회로 수행해야 하고, 어느 정보원이라도 연결 실패·상태 불명·부분 결과이면 `source_available:true` 또는 `keycloak_access:false`를 추측해 반환하지 말고 non-2xx로 실패해야 합니다. `keycloak_access:false`는 기존 자격증명의 영구 폐기를 일으킵니다. `checked_at`은 DS와 Keycloak 양쪽 조회를 완료한 시각의 Unix 초이며 서비스 시각 기준 최대 30초 전부터 5초 후까지 허용합니다. 누락된 필드로 활성 상태를 추론하지 않습니다. 사용자가 존재하지 않을 때도 연결이 정상적으로 확인되었다면 `enabled:false`와 빈 그룹 배열을 반환하고, DS 연결 실패·매핑 모호함·부분 그룹 결과일 때는 non-2xx로 실패해야 합니다. verifier는 해당 nonce에 맞는 신선한 조회 결과만 반환하고 요청·응답 및 인증 비밀을 로그에 남기지 않아야 합니다. 타임스탬프와 nonce는 잘못된 응답을 거르지만 verifier의 진실성이나 DS 동기화를 자동 증명하지 못합니다.

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
