# 작업 중 실수와 재발 방지

작업 중 확인한 실수와 실패를 날짜순으로 기록한다. 각 항목에는 현상, 원인, 해결 또는 현재 상태, 다음에 적용할 구체적인 예방 조치를 남긴다. 비밀정보, 개인정보, 원본 민감 로그는 기록하지 않는다.

## 2026-10-31: GitHub CLI 인증 실패

- 현상: `gh auth status`가 현재 GitHub CLI 계정의 인증을 실패로 보고했다.
- 원인: 로컬 CLI에 저장된 토큰이 유효하지 않다고 표시됐다.
- 대응: 별도로 연결된 GitHub 앱의 저장소 접근 권한을 확인했다. CLI 인증 문제는 앱 연결의 성공 여부와 별개로 취급한다.
- 예방: PR 작업을 시작하기 전에 사용할 GitHub 경로의 인증과 저장소 권한을 확인하고, 인증정보 자체는 문서나 로그에 기록하지 않는다.

## 2026-10-31: 샌드박스에서 Python 테스트 캐시 접근 실패

- 현상: `uv run pytest`가 기본 사용자 캐시 디렉터리에 접근하지 못하고 시작 전에 종료됐다.
- 원인: 해당 캐시가 이 작업의 쓰기 허용 경로 밖에 있다.
- 대응: 임시 캐시로 재실행했지만 네트워크 제한 때문에 의존성 다운로드가 실패했다. 저장소의 고정 의존성 설치를 권한이 허용된 환경에서 실행해 해결했다.
- 예방: 제한된 환경에서 `uv`를 실행할 때 캐시 위치와 프로젝트 가상환경의 쓰기 권한을 먼저 확인한다.

## 2026-10-31: 테스트에서 API 키 발급 경로를 잘못 지정

- 현상: 감사 내보내기 권한 테스트의 준비 단계가 405로 실패했다.
- 원인: 기존 라우터의 경로를 확인하지 않고 API 키 생성 경로를 추측했다.
- 대응: 실제 라우터에 정의된 경로를 확인해 테스트를 수정했다. 실패 출력에 일회용 테스트 토큰이 포함되어 해당 요청의 응답을 변수에 저장하고 별도로 상태를 검사하도록 변경했다.
- 예방: 기존 API를 이용하는 테스트를 작성하기 전에 라우터와 기존 테스트의 요청 경로를 확인하고, 인증 헤더를 포함한 호출을 assertion 안에 직접 넣지 않는다.

## 2026-10-31: 문서 의존성 확인 경로 오류

- 현상: 문서 디렉터리 안에서 의존성 설치 여부를 검사하면서 디렉터리 이름을 중복해 붙였다.
- 원인: 명령의 작업 디렉터리를 경로 계산에 반영하지 않았다.
- 대응: 현재 작업 디렉터리 기준 경로로 다시 확인했다. 로컬 문서 의존성은 설치되지 않았으므로 문서 빌드는 CI에서 확인한다.
- 예방: 명령에 작업 디렉터리를 지정할 때 상대 경로가 그 위치를 기준으로 해석되는지 먼저 확인한다.

## 2026-10-31: subprocess 종료 테스트의 간헐적 권한 오류

- 현상: 전체 Python 테스트에서 출력 한도 초과 후 프로세스 그룹 종료가 `PermissionError`로 한 차례 실패했다. 변경 전 전체 실행과 이후 해당 테스트 단독 실행은 통과했다.
- 원인: 종료 시점의 권한 오류까지 확인했지만 간헐적 발생 원인은 아직 특정하지 못했다.
- 대응: 실패를 숨기지 않고 기록했으며 CI 결과와 추가 실행을 확인한다.
- 예방: 프로세스 종료 관련 테스트 실패는 재실행 결과뿐 아니라 최초 오류와 재현 여부를 함께 기록하고, 원인을 확인하기 전 환경 문제로 단정하지 않는다.

### Browser installation mirror (2026-11-02)

- Failure: the first Playwright Chromium download returned a truncated archive in this environment.
- Resolution: Playwright retried against its alternate mirror and the browser tests ran successfully.
- Prevention: verify browser installation and run the browser suite before relying on screenshots; retain the retry output when diagnosing download failures.

### Mobile account submenu (2026-11-02)

- Failure: the nested account menu extended beyond a 390px viewport despite being visible to the browser.
- Resolution: reduce menu widths on small screens and verify the submenu's bounding box.
- Prevention: inspect narrow viewport screenshots and assert horizontal menu bounds, not visibility alone.

### Profile migration lint (2026-11-02)

- Failure: the new migration did not meet Ruff import ordering.
- Resolution: sorted the imports and reran lint and migration checks.
- Prevention: run both Ruff check and format checks on migrations before the full test suite.
- A temporary Playwright config in the frontend root was picked up by the formatting glob. It was formatted for local verification and excluded from the PR; keep local test configuration formatted or outside checked globs.

### Profile save during session changes (2026-11-02)

- Failure: a delayed profile-save response could update a later login session's sidebar, and typing during a pending save could be overwritten.
- Resolution: re-fetch authoritative profile data for the current account after each completed save, keep successful saves synchronized after navigation, and disable the input during save.
- Prevention: exercise delayed responses across logout and login in a browser test, including unchanged identity data.
### Review revisit verification (2026-11-02)

- Failure: a browser-test setup command used repository-relative paths while already in the frontend directory, so it could not create the test files.
- Cause and resolution: the command's working directory was overlooked; the files were created from the repository root and the test was rerun.
- Prevention: check paths against the command's declared working directory before creating files or launching a test.

- Failure: the first mobile screenshot captured the sidebar halfway through its closing animation, obscuring the review panel.
- Cause and resolution: the capture followed the viewport resize before the CSS transition settled. The test now enables reduced motion and waits until the sidebar is outside the viewport.
- Prevention: wait for the final responsive layout before taking screenshots, and inspect the captured image as well as checking for overflow.

- Failure: an exact label lookup stopped resolving after a controlled textarea had been filled, although the textbox retained the correct accessible name and value.
- Resolution: the browser test now locates the control by its textbox role and accessible name.
- Prevention: use accessible role-and-name selectors for assertions on populated form controls and inspect the accessibility snapshot when selectors behave unexpectedly.

- Failure: the frontend formatting check picked up an unformatted temporary Playwright configuration and failed; a subsequent forced-remove command was rejected by the command policy.
- Cause and resolution: the temporary file matched the check's `*.ts` glob. It was removed by its exact path without force, after which the formatting check passed.
- Prevention: remove temporary configuration files before repository-wide format checks and use a specific non-forced removal command.

### Scan scope regression verification (2026-11-02)

- Failure: an authorization test initially assumed the bootstrap administrator was not reviewer-qualified, but the fixture creates that administrator with the reviewer flag enabled. The test now explicitly removes the qualification and checks the administrator and API-key boundaries separately.
- Prevention: inspect fixture roles and permissions before asserting role-specific behavior, and use concise test tracebacks so fixture data such as temporary test tokens is not printed.
- Failure: the first browser assertion ran after the URL changed but before the lazy-loaded scans screen replaced the dashboard, and an initial mobile screenshot captured the sidebar mid-transition. The test now waits for the scans heading and the sidebar's final position before taking screenshots.
- Prevention: wait for the destination UI and completed responsive transitions, not only the navigation URL, before inspecting controls or capturing screenshots.
- Failure: a file-creation command used a repository-relative prefix while already in the frontend directory. It was rerun from the repository root with the correct paths.
- Prevention: check the command's working directory before constructing relative output paths.

### Parallel changes to lessons (2026-11-02)

- Failure: independent branches appended to the same end of the lessons file and Git reported a merge conflict.
- Resolution: retained both branches’ entries and verified the merged diff.
- Prevention: rebase each PR on current main and review shared documentation before merging.
### Review branch refresh (2026-11-02)

- Failure: a connector upload helper assumed that temporary orchestration metadata from an earlier task was still available after the handoff.
- Resolution: reconstruct the file list and object hashes from the committed Git tree before uploading.
- Prevention: derive handoff state from durable repository objects rather than in-memory tool state.

### Usage accounting formatting check (2026-11-02)

- Failure: the first `ruff format --check` run reported unformatted new tests and metric helpers.
- Cause: the format check was run before formatting the edited files.
- Resolution: ran the repository formatter on the changed Python files.
- Prevention: format changed files before running the final lint and format checks.

### Usage browser verification setup (2026-11-02)

- Failures: a formatter ran from the repository root and found none of the frontend paths; the first usage browser test expected an API-key creation response of 200 instead of 201.
- Cause: the command's working directory and the existing route's documented status were not checked first.
- Resolution: reran the local formatter from `frontend` and corrected the browser test to expect 201.
- Prevention: confirm the command directory and inspect route status codes before writing browser setup assertions.

### Usage screenshot timing (2026-11-02)

- Failure: the first mobile screenshot caught the sidebar sliding out and the chart bars still animating.
- Cause: the capture followed a viewport change and data load before animations had finished.
- Resolution: request reduced motion, disable screenshot animations, and wait for a populated chart bar before capture.
- Prevention: inspect screenshots at each viewport and wait for visible chart geometry rather than only page visibility.

### Unobserved usage history and repeatable browser tests (2026-11-02)

- Failures: review found that pre-collection MCP HTTP days appeared as zero, and a second browser test run on the same database failed its absolute count assertions.
- Cause: zero-filled buckets assumed data existed before collection began, while the browser fixture reused its database across runs.
- Resolution: persist the collection-start boundary, mark earlier days unknown and the first day partial, and compare browser counts to scoped baselines with a unique key.
- Prevention: test the collection boundary explicitly and rerun stateful browser scenarios against the same database.

### Responsive chart capture retry (2026-11-02)

- Failure: the browser test timed out while waiting for a chart bar after resizing.
- Cause: the chart replaced its SVG path during a responsive rerender, leaving an in-page wait attached to a detached element.
- Resolution: poll a fresh locator and wait for its geometry to stabilize.
- Prevention: reacquire responsive chart elements while waiting instead of holding a DOM node through a resize.

### Coverage note browser assertion (2026-11-02)

- Failure: a browser assertion still expected the original sentence after adding the rollback limitation.
- Cause: the test matched an entire sentence whose wording had intentionally changed.
- Resolution: assert the two meaningful coverage statements independently.
- Prevention: keep browser assertions focused on the behavior or facts the UI must communicate.

### Dashboard scope fixture after integration (2026-11-02)

- Failure: two dashboard-scope browser tests timed out after merging the usage changes.
- Cause: their mocked metrics response lacked the new REST and MCP fields needed by the dashboard.
- Resolution: update the fixture to include the corresponding usage fields and rerun the combined suite.
- Prevention: inspect and update shared API response fixtures whenever a screen gains required response fields.

### Git push authentication (2026-11-02)

- Failure: direct Git push could not authenticate without an interactive credential prompt.
- Cause: the local Git remote lacked usable push credentials in this environment.
- Resolution: publish the branch through the connected GitHub service.
- Prevention: verify the intended publication channel before attempting a push and keep credential prompts disabled in automation.

### Main refresh object race (2026-11-02)

- Failure: an immediate object lookup failed while a concurrent fetch was still updating the local object store.
- Cause: the lookup ran before the fetch completed.
- Resolution: retried after the fetch reported the updated branch and verified the commit before rebasing.
- Prevention: wait for the fetched ref or object before starting dependent Git operations.
