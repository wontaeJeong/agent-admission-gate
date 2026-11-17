---
title: REST·MCP·CLI·Device Code
---

REST 명세는 실행한 서버의 `/api/docs`, JSON 계약은 `/api/openapi.json`에서 확인합니다.

```bash
curl "$AAG_URL/api/scans?wait=30" \
  -H "Authorization: Bearer $AAG_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/owner/repository","profile":"full","force_rescan":true}'
```

기본 비동기 접수는 202, 대기 안에 완료되면 200입니다. 대기 시간이 지나도 작업을 취소하지 않습니다. `GET /api/scans/{id}`, `POST /api/scans/{id}/cancel`, `/export?format=sarif`로 진행 상태·취소·내보내기를 제공합니다.

`AAG_API_KEYS_ENABLED`는 기본 `false`입니다. 운영자가 [SSO 계정·그룹 동기화](../operations/deployment/)를 검증한 후 명시적으로 켜기 전에는 기존 키 사용과 새 키 발급이 차단됩니다.

Remote MCP는 `/mcp/`의 Streamable HTTP이며 `scan`, `get_scan`, `list_scans` 도구를 제공합니다. Bearer API 키가 필요하고 REST와 같은 ScanService를 호출합니다. stdio MCP/로컬 SDK는 이 버전의 공식 인터페이스가 아닙니다.

Device Code Flow는 **서비스 자체 API 키 발급 프로토콜**입니다. OAuth provider의 동적 client registration 구현이 아닙니다.

1. 웹의 도구 연결 등록에서 이름과 Client ID를 생성합니다.
2. 도구가 `POST /api/device/authorize`에 `client_id`를 전달합니다.
3. 응답의 8자리 `user_code`를 로그인한 웹에서 확인합니다. 등록 도구·등록자·권한을 확인하고 승인 또는 거절합니다.
4. 도구는 5초 이상 간격으로 `/api/device/token`에 `client_id`, `device_code`를 전달합니다.
5. 한 번만 반환되는 `aag_sk_` 키를 안전하게 보관합니다. 코드는 10분, 키는 90일 유효합니다.

`authorization_pending`, `slow_down`, `access_denied`, `expired_token`을 처리해야 합니다. 키 원문은 서버에서 다시 조회할 수 없습니다. 연결 등록 비활성화는 미완료 grant를 거절하며 이미 발급된 키는 API 키 화면에서 별도로 폐기합니다.

```bash
aag device-login CLIENT_ID
aag scan https://github.com/owner/repository --profile full --wait
aag upload package.zip --profile static
aag get SCAN_ID
```

CLI는 완료된 비허용 판정에 exit code 2, 실행 실패·취소에 1을 반환합니다. 무기한 API 응답을 기다리지 않도록 요청 timeout과 서버 검사 전체 timeout을 적용합니다.

## 기존 키 교체 준비

API 키 화면에서 **새 키로 교체 준비 (Prepare replacement key)**를 선택하면 서버에서 현재 계정과 발급 가능 상태, 해당 키를 다시 확인하고 이름·권한만 발급 폼에 채웁니다. 만료 기간은 별도로 선택합니다. 발급·폐기 권한은 기존 서버 API에서 다시 검사합니다.

1. 새 키를 발급하고 한 번 표시되는 원문을 비밀 저장소에 보관하세요. 원문은 URL, 브라우저 저장소, 초안, 감사 기록에 저장하지 않으며 다시 조회할 수 없습니다.
2. 연결된 도구의 키를 바꾸고 실제 요청이 성공하는지 확인하세요. 새 키 발급은 이전 키를 폐기하지 않습니다.
3. 도구 반영을 확인한 후 이전 키의 **폐기 (Revoke)**를 선택하고 사유를 입력하세요. 자동 폐기나 기존 키의 자동 연장은 제공하지 않습니다.

응답이 유실되어 발급 여부가 불명확하면 **현재 키 목록 확인 (Check current keys)**으로 서버 목록을 확인합니다. 자동으로 발급 요청을 재전송하지 않습니다. 이미 발급되었지만 원문을 받지 못한 키는 사용할 수 없으므로 별도로 폐기하고, 필요하면 명시적으로 새 키를 발급하세요. 발급이 비활성화되거나 SSO 계정·그룹 확인이 불가능한 상태에서는 교체 준비로 제한을 우회할 수 없습니다.
