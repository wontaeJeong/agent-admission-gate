---
title: 실행 가이드
---

Python 3.12+, Node 24, Git과 uv를 설치하세요.

```bash
cp .env.example .env
# AAG_BOOTSTRAP_PASSWORD를 설정합니다.
uv sync --frozen
cd frontend && npm ci && npm run build && cd ..
uv run uvicorn aag.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

브라우저에서 `http://localhost:8000`에 접근하고 `admin`과 지정한 비밀번호를 사용합니다. 개발 전용 계정만 제공합니다. 스테이징/운영은 OIDC와 HTTPS를 사용해야 합니다.

추가 개발 사용자:

```bash
uv run aag create-local-user alice
```

첫 검사는 짧은 텍스트 파일을 담은 ZIP으로 확인할 수 있습니다. `SKILL.md` 또는 `tools.json`을 포함하면 각각의 외부 검사기가 필요합니다. Full 프로필은 설정되지 않은 엔진이나 모델이 있으면 REVIEW로 남습니다.

공지·VOC를 개발 중 확인할 때만 `AAG_BOARDS_ENABLED=true`로 켜세요. 기본값과 배포 예제는 모두 false입니다.

프론트 개발 서버를 사용한다면 `AAG_PUBLIC_URL=http://localhost:5173`으로 백엔드를 띄우고 `cd frontend && npm run dev`를 실행합니다. Origin 검증과 OIDC redirect URI는 실제 브라우저 origin과 같아야 합니다.
