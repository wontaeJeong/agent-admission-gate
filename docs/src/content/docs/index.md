---
title: Agent Admission Gate
description: 에이전트 반입 전 근거 기반 검사와 검토
---

Agent Admission Gate는 MCP 패키지·Agent Skill의 등록 또는 배포 전에 소스를 검사하고 **ALLOW / REVIEW / BLOCK** 판정과 근거를 남기는 독립 서비스입니다. Cisco 제품이 아니며 Cisco의 오픈소스 검사기는 여러 외부 엔진 중 하나입니다.

웹·REST·Remote MCP·CLI가 같은 검사 서비스, 저장소와 권한 검증을 사용합니다. 모델은 보조 판단을 제공하고, 권한과 최종 정책은 결정적인 코드로 강제합니다.

1. Git URL 또는 ZIP을 접수합니다.
2. 정적 규칙과 해당 패키지의 엔진을 실행합니다.
3. Full 프로필은 SBOM·CVE·라이선스·모델 보조 검토를 추가합니다.
4. 근거와 엔진 실행 범위를 저장하고 판정합니다.
5. 필요한 경우 다른 검토자가 사유를 남기고 결정합니다.

사내 코드를 반출한 버전이 아니라 대화에서 확인한 요구사항으로 만든 독립 구현입니다. 외부 인증·모델·엔진의 실제 배포 검증은 [운영 가이드](./operations/deployment/)를 확인하세요.
