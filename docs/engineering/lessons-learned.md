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

### Admin key verification (2026-11-02)

- Failure: the first browser-test setup used paths relative to the repository while already inside the frontend directory, and assumed the login form followed the selected language. A later fixture edit also changed an expected count without adding its intended row.
- Cause: commands and fixtures were written before checking their exact working directory, existing labels, and resulting test data.
- Resolution: corrected the paths and labels, added the missing synthetic row, and reran the tests. Synthetic credential-bearing responses were separated from assertions so failure output does not print their values.
- Prevention: inspect the command working directory and existing UI labels first; verify fixture changes before relying on a failing assertion, and keep credentials out of assertion expressions and fixture output.

### Admin key state and usage windows (2026-11-02)

- Failure: returning from a revoked key initially showed the old list state, and future-dated records were included in a rolling 30-day total. A mobile capture also caught the sidebar mid-transition.
- Cause: the list retained its previous fetch, the usage window had no upper bound, and the screenshot was taken immediately after changing viewport size.
- Resolution: refresh and clamp the list on return, bound the usage window at the current time, and wait for the sidebar to finish moving before capture. Apply the same wait to the account-settings mobile capture, which independently had the same issue.
- Prevention: test return navigation after mutations, seed records on both sides of time windows, and check mobile element bounds before screenshots.

### Isolated browser configuration and pagination bounds (2026-11-02)

- Failure: the first complete browser suite failed on a boards workflow, and the formatting check reported a temporary configuration file. Oversized page numbers also caused a database offset overflow during regression testing.
- Cause: the isolated test configuration did not reproduce the normal boards flag, its temporary TypeScript file was not formatted before the check, and page inputs had no database-safe upper bound.
- Resolution: match the normal test flags, format and remove the temporary configuration, and validate pagination inputs before querying.
- Prevention: compare isolated test settings with the repository configuration before running the suite, exclude temporary files from final checks, and test extreme numeric inputs at API boundaries.

### Admin key API and MCP event compatibility (2026-11-02)

- Failure: the first admin-key implementation changed an existing array response and counted historical MCP tool events as HTTP requests.
- Cause: the admin endpoint's external consumers and the concurrent MCP HTTP instrumentation were not accounted for in the initial design.
- Resolution: retain the array endpoint, provide a separate paginated search endpoint, and label REST HTTP, MCP HTTP and legacy tool records separately with explicit MCP collection coverage.
- Prevention: check existing endpoint contracts and coordinate event units and collection boundaries across concurrent features before defining metrics or UI labels.

### Concurrent lessons entries (2026-11-02)

- Failure: integrating the current main branch produced a conflict in the lessons log.
- Cause: independent feature branches appended entries at the same end of the file.
- Resolution: preserve both sets of entries and verify the combined branch.
- Prevention: merge concurrent append-only entries deliberately and check for conflict markers before committing.

### Cross-branch integration setup (2026-11-02)

- Failure: an integration worktree command used the new directory as its working directory before it existed. The first combined browser suite also failed two dashboard tests after MCP metrics changed the response shape.
- Cause: setup order and independently changed mock fixtures were missed.
- Resolution: create the worktree from the existing checkout, and coordinate the dashboard fixture updates with the MCP metrics work.
- Prevention: create a worktree before selecting it as a working directory, and run combined browser tests when concurrent features share an API response.

### Browser verification after main update (2026-11-02)

- Failure: five review browser checks used an older frontend entrypoint after new hashed assets had been built.
- Cause: the served `dist/index.html` still referenced the earlier bundle; the reason it was stale has not been established.
- Resolution: rebuild, verify the entrypoint references the new bundle, and rerun the browser suite.
- Prevention: verify the generated entrypoint after rebuilding an integrated branch before using browser-test failures to diagnose source changes.

### Identity lifecycle tests and browser captures (2026-11-02)

- Failure: the existing successful OIDC login test returned 503 after the new lifecycle gate was introduced; its fixture supplied an identity token but no authoritative lifecycle response.
- Cause and resolution: a valid identity token is not proof of a currently enabled upstream account. The OIDC test now explicitly supplies a mocked lifecycle result, while separate tests exercise missing and unavailable sources.
- Prevention: update authentication fixtures when adding a new mandatory trust boundary and test both the missing-provider and successful-provider cases.
- Failure: initial screenshot capture could not connect to a server launched in a different execution session, and an immediate mobile capture caught a responsive transition mid-animation.
- Resolution and prevention: start the server and browser in the same execution session, wait for readiness, and wait for responsive transitions before capturing each layout. Captures contain only synthetic data.

### Identity revocation review (2026-11-02)

- Failure: review reproduced a credential issued after a concurrent revocation sweep and a device grant exchanged after it expired during provider checks.
- Cause and resolution: authorization and issuance used separate transactions, and polling reused a timestamp captured before network calls. Single-process revocation generations now guard issuance, and exchange checks expiry again immediately before consumption.
- Prevention: exercise concurrent deactivation between identity verification and each credential write, and advance the clock across external calls in expiry tests.
- Failure: a Keycloak gateway 404 or a group moving between paginated reads could be mistaken for an authoritative removal and permanently revoke an active user's credentials.
- Resolution and prevention: ambiguous results now fail closed without a destructive sweep; the verifier must independently confirm Keycloak access and upstream status, bound to the requested access-group ID. Test gateway errors, moving membership, and independently confirmed removal separately.
- Failure: an initial browser-test command used a path prefixed with `frontend/` while already running in that directory, so the intended test file was not created.
- Prevention: resolve paths against the command's actual working directory and check that targeted tests are discovered before interpreting a browser run.

### Noninteractive Git push (2026-11-02)

- Failure: pushing the reviewed branch failed because Git had no noninteractive GitHub credentials available.
- Resolution: publish the same committed tree using the connected GitHub app instead; no credentials are stored in the repository.
- Prevention: verify the available authenticated publishing path before relying on command-line push.

### Migration validation scratch database (2026-11-02)

- Failure: a migration-test setup command was rejected because it attempted to remove a fixed temporary database path.
- Resolution: use a unique new temporary SQLite path for each validation run.
- Prevention: avoid deleting a pre-existing path as test setup; select an isolated scratch path instead.

### Notification inbox integration (2026-11-16)

- Failures: the first preview check could not find its accessible menu name; rapidly changing tab and category restored the old tab.
- Cause: Radix's generated `aria-labelledby` took precedence over the explicit menu label, and a category handler retained the previous route render's tab value.
- Resolution: explicitly override the generated menu label reference and update independent filters against the current browser URL. The browser scenarios now pass without inserting artificial waits between filter actions.
- Prevention: inspect the accessibility tree and test successive filter changes during route transitions, rather than assuming a click has already committed a React render.
- Failures: mark-all was disabled when unread items were beyond the visible page, and a failed count request prevented manual list refresh.
- Cause: the button only examined visible rows, while list invalidation was coupled to successful count responses.
- Resolution: enable mark-all from the full inbox unread count and advance list refresh independently of count success. Both cases were reproduced with failing browser checks before fixing them.
- Prevention: include multi-page unread boundaries and partial endpoint outages in inbox verification.
- Failures: visual inspection found a preference form without panel padding and vertically stacked checkbox rows; the initial preview capture included a lazy-loading background.
- Cause and resolution: shared label styles inherited `flex-direction: column` and the base panel supplied no padding. Specify row direction/padding in the notification styles and wait for loaded inbox rows before capturing the preview.
- Prevention: inspect settings as well as list screenshots, at desktop and mobile widths, and wait for meaningful content before captures.
- Setup notes: an initial Playwright CDN download was not a valid archive; its built-in alternate host completed the install. Lint also removed an unused test import, and one patch was reapplied after checking the formatter's actual line layout.
- Prevention: use the installer's supported fallback, run lint before commits, and match patches to the current formatted source.

### Notification review boundaries (2026-11-16)

- Review reproduced a stale tab reading a new cookie account's inbox, an uncommitted delivery consumed by mark-all, lost row focus during polling, and an unrelated preference overwritten by another device.
- Resolution: bind each notification request to the rendered account and reconcile sessions; use a per-recipient counter held through commit for snapshots; preserve same-filter rows during refresh while clearing denied data; send preference deltas. Native new-tab links use an opening route that persists read state, and filtered unread counts govern mark-all.
- Prevention: exercise shared-cookie tabs, open database writer transactions, delayed refresh with a focused row, and independently changed settings rather than only sequential single-tab flows. Regression tests reproduced each material issue before the fix.
- Integration verification then found that older identity-mocked browser tests made real unauthenticated count requests, triggering the new fail-closed session reconciliation. Their fixtures now supply the count response alongside the mocked identity; real-session notification tests retain the real API.
- Prevention: when a shared authenticated shell gains a new mandatory read, update identity mocks to model its session consistently and rerun the complete browser suite. Use short traceback output for credential-bearing fixtures so failure diagnostics do not print synthetic token values.

### Browser runner drift (2026-11-16)

- Failure: PR CI could not install Chromium dependencies because `ubuntu-latest` selected Ubuntu 26.04, unsupported by the repository's locked Playwright 1.56.1.
- Resolution: pin the web job to Ubuntu 24.04, which is present in that Playwright release's dependency manifest; keep the same browser and test versions.
- Prevention: pin browser-test runner OS versions alongside the Playwright lockfile and review OS support before changing either. Rerun CI rather than bypassing a failed required check.

### Convenience design contract review (2026-11-16)

- Failure: an initial planning draft combined API-key scan summaries with human-review details, left legacy decisions ambiguous during changes-requested, and omitted the requested snapshot commit from persisted Job fields. Some execution-plan prose also used the wrong language. These were document defects found before implementation or publication.
- Resolution: restrict review sections to authorized interactive sessions, gate every decision path on workflow state, bind content submissions to the captured account, persist target_commit/rerun_mode, and rewrite the plans in Korean.
- Prevention: check proposed convenience paths against existing authorization contracts, trace failure retries through stored fields, review transition tables against legacy endpoints, and validate feature coverage, cross-links and document language before publishing a plan.


### A1 session return verification and fixtures (2026-11-17)

- Failure: the unmodified backend baseline timed out in two full-profile `wait_job` tests on this machine. Cause: globally installed scanner binaries were discovered, unlike CI's application-only environment. Resolution: run backend and browser-test API processes with `.venv/bin:/usr/bin:/bin` as PATH and invoke uv by its absolute path; all scanner production code stays unchanged. Prevention: record scanner availability when establishing a baseline and keep deterministic unit/integration verification separate from installed-scanner smoke tests.
- Setup failures: the shell has no `python` alias, Chromium had not been installed for the locked Playwright version, and first-pass imports/generated Alembic source did not satisfy Ruff formatting. Resolution: use the project `.venv/bin/python`, install the locked Chromium bundle in temporary storage, and apply Ruff import/format tools. Prevention: check executable/browser paths and format generated migration source before final checks.
- Fixture defect found during self-review: the first stale-account payload draft used guessed scan/board fields and a nonexistent comment target; the first synthetic OIDC screenshot result used unsupported verdict/severity/action values. Resolution: use the real ScanRequest/PostRequest fields, a real owned target and BLOCK/high/builtin/security response values. Prevention: derive fixtures from the real schema and policy contract so removing an authorization guard would permit the mutation being tested.
- Browser failure: intercepting only the external authorization URL never ran after the real login endpoint's redirect; Chromium attempted DNS for the synthetic host. Cause: route interception did not cover the redirected authorization request. Resolution: serve a real loopback HTTPS authorization fixture using an ephemeral self-signed certificate, scoped test-only TLS relaxation, and the real callback/JWT/PKCE handlers. Token/discovery/JWKS doubles remain at the external boundary. Prevention: use a real HTTP redirect chain for browser SSO tests and never weaken production TLS or log authorization parameters.
- Regression fixture failures: fake identity/profile tests navigated to real unauthenticated scan reads and correctly reached the new expiry flow. One older expectation also applied a delayed save after a same-account new login generation. Resolution: provide matching synthetic read responses and require the old generation's save result to be discarded. Prevention: keep all authenticated reads consistent with identity doubles and test both a different account and a new generation of the same account.
- Capture failure: the initial 390px screenshot caught the sidebar halfway through its responsive transform and obscured the content. Resolution: wait until the sidebar's right edge is outside the viewport and assert no document horizontal overflow before capture. Prevention: wait for stable responsive layout, not merely setViewportSize, for every mobile evidence image.
- Browser selector failure: an expiry test looked for an existing tab as a button after cookies were cleared; the real poll had already moved to the expiry view. Resolution: assert the expiry notice directly after the normal four-second job poll. Prevention: use observed accessible roles and test the real asynchronous trigger instead of an unnecessary intermediate action.

- Cross-tab gap reproduced during self-review: a successful SSO callback reloaded the second app but did not broadcast its newly verified account, leaving the first tab's prior form visible until polling. Resolution: publish an observation marker only when the account returned by `/auth/me` changes, including null on logout/expiry; normal reads do not broadcast again. Prevention: use a real two-tab SSO callback without manually injecting the storage event, and assert both stale-submit rejection before observation and old-form removal afterwards. Local storage coordinates invalidation only and never establishes authentication.
- Controller setup failures: a fetch into protected main checkout metadata was initially denied and then succeeded using the approved metadata-write permissions. The first GitHub repository lookup also used an unsupported argument alias before its discovered schema was read. Prevention: use the correct permissions for Git metadata writes and read the exact deferred-tool schema before calling it; never log authentication values.

- Final browser-suite failure: the shared backend rejected the last workflow login with the unchanged 10/IP/minute limiter after adding two local-login regressions to the existing real-session suite. Resolution: keep the local-return test on the local app and run generic expiry through the isolated real OIDC fixture, then run the whole suite on a fresh disposable API/database. Prevention: include shared rate budgets in integration-test isolation; do not weaken production rate limits or add sleeps to hide test interference.

### A1 independent review fixes (2026-11-17)

- Review finding: notification responses rejected by the API generation gate as 409 were treated as current server account conflicts. An old Alice request could therefore reconcile a newer Alice session and remount its edited form. Cause: the wrapper checked account ID but did not compare the request generation before its reconciliation side effect. Resolution: capture the generation when the notification request starts and require it to remain current before reconciling a server 409. Prevention: cover delayed GET/PATCH requests through the real notification hook and delayed mark-read/preferences responses across same-account logout/login, then assert the newer edited form survives. Keep a current server-409 positive control so the fix does not suppress authoritative conflicts.
- Review finding: common read errors were reduced to text and the prior browser test merely navigated away/back, leaving the required 403 permission recovery and 503/network retry controls unimplemented. Resolution: preserve HTTP status/read-retry eligibility in useLoad, show bilingual permission guidance with a full-size dashboard action for 403, and provide an explicit retry that reissues only the failed GET for connection/503 errors. Prevention: click the actual recovery controls in browser tests, retain the authenticated account, and verify a failed mutation is never replayed by read recovery.
- RED evidence: the real notification-hook tests reproduced two unwanted reconciliations; the delayed preferences browser response restored a newly edited checkbox. Six new read-policy unit cases and four actual-control browser cases failed before implementation. After the fixes the focused six browser cases and all 65 frontend units passed.
- Test setup corrections: Vitest discovers `.test.ts`, not `.test.tsx`, in this repository, and a generic Comments label also matched a category select before the settings form settled. Resolution: render the real hook with createElement in a `.test.ts` file and target the checkbox by accessible role. Prevention: inspect test discovery patterns and ambiguous accessible labels before interpreting setup failures as product RED.

### A2 draft storage and browser boundaries (2026-11-17)

- Setup mistakes: the first test-write command repeated the `frontend/` prefix while already in that directory, so no test file was created; the initial router text replacement left the removed BrowserRouter JSX behind, and a context default inferred the literal `true` return type. Resolution: correct the working-directory-relative path, mount RouterProvider, and declare the confirmation return type as boolean. Prevention: inspect the actual file after mechanical edits and run TypeScript before browser verification. The required RED evidence was then obtained from the real storage behavior assertions against importable unimplemented stubs, not from these setup errors.
- Browser selector failures: controlled textarea content affected an implicit wrapping label, and a latest-decision text query also matched the disclosure copy. Resolution: add stable bilingual aria-labels to controlled textareas and scope the latest-server assertion to the existing review panel. Prevention: keep the user-facing accessible name stable as the controlled value changes and scope repeated content by its semantic section.
- Browser harness races: the first cancel/continue test attached its second dialog handler before the first router-effect confirmation had completed. A later full-document goto ran immediately after the URL changed while the destination had not yet rendered, leaving a counting-only dialog listener unable to handle a residual beforeunload. Resolution: await each dialog decision, await the destination heading, and remove the counter before document navigation. Prevention: synchronize against the completed user-visible transition, not only a changed URL. A canceled reload also leaves Playwright's reload/load wait pending; trigger the browser's location.reload and assert the beforeunload decision and preserved form instead.
- Clock test failure: installing Playwright's clock still advances with wall time, so a 299ms fast-forward could exceed the 300ms debounce after action overhead. Resolution: pause the installed clock at a fixed time before entering data, then advance exactly 299ms and 1ms. Prevention: distinguish installed and paused virtual clocks when asserting timer boundaries; never add sleeps or weaken the production debounce to repair a test.
- Product gap reproduced in self-review: an already expired tab had no current user ID, so an explicit logout observation skipped its retained draft cleanup. Resolution: invalidate stored foreign-account drafts directly from the observation, then establish identity only through auth/me. A second RED case showed that an unauthenticated startup read in another tab broadcast null and erased same-account expiry drafts. Resolution: only explicit logout publishes null; expired/unauthenticated reads retain drafts, while verified different-account reads clear them. Prevention: test expiry, explicit logout and other-account observation separately, including an expired observer tab and a newly opened unauthenticated tab. This narrows the earlier A1 lesson's null-on-expiry behavior for the A2 preservation contract.
- Product gap reproduced in self-review: treating every read failure as an unsupported schema permanently disabled the underlying form when sessionStorage itself was blocked. Resolution: distinguish malformed/unsupported saved data from browser storage failures; only unsupported data requires explicit discard, and unavailable storage leaves inputs editable with a visible warning. Prevention: assert form editability as well as error visibility for storage getter and quota failures.
- A1 review harness note: an optional reviewer harness assumed `frontend/node_modules/esbuild`, which is absent from the locked Vite 8/Rolldown dependency tree. No reproduction ran, and the static finding was correctly reported as static. Resolution: the A1 fixer reproduced it through the real hook in existing Vitest with RED→GREEN evidence. Prevention: inspect installed locked tooling before choosing a harness and do not install an unrelated bundler for review.
- Product gap reproduced in self-review: internal-comment cleanup lived in the Comments form, which never mounts after qualification loss makes the whole review unreadable. Resolution: prune the authenticated account's internal comment drafts when auth/me confirms loss of staff qualification; retain public and other-account drafts. Prevention: exercise same-account reconciliation with the old form still dirty, then advance its pending debounce and fire visibility/pagehide after pruning to prove stale cleanup cannot recreate the draft.
- Resumed-run setup failure: the temporary Playwright browser directory had disappeared between work sessions. All 73 full-suite cases failed at browser launch before product interactions; the earlier shell launcher also had an unavailable process handle after the runtime transition. Resolution: inspect the configured browser path, reinstall the repository-locked Chromium bundle there, and rerun against a fresh API/database. Prevention: recheck ephemeral browser/tool paths when resuming a long task and distinguish launch failures from product regressions; never treat a disappeared process handle as a completed validation.
- Copy-review correction: a touched NewScan screen retained a decorative inherited heading, and read-only draft previews exposed field keys rather than localized user labels. Resolution: use factual scan-result scope copy and localized labels/choice values; regenerate all seven images and rerun build, unit, format and the four focused cases. A first copy batch repeated the frontend working-directory prefix mistake and the shell continued into unchanged-code validation after Python failed. Resolution: switch edits to the absolute task root and verify the actual diff. Prevention: gate multi-step mutation scripts on edit success and inspect changed UI copy before claiming its validation.

### A2 review round 1 — preservation and completion ownership (2026-11-17)

- I1: newly polled board/review detail pages used the shared State component's error branch, which unmounted their editors. Browser-write failure made the in-memory input irrecoverable. Resolution: opt authorized cached targets into stable child rendering with read error/retry alongside; keep same-target data through transient reads and explicit retry, but clear denied/unknown data so a retry cannot revive it. Prevention: test original textarea identity, focus and values through 503/network and recovery while draft writes fail, then assert 403 removes protected fields.
- I1 authority boundary: cached read preservation initially retained a review request form after its mutation had already returned409 and the following GET returned503. The unchanged review-revisit regression caught the stale submit action. A board revision409 had the same risk, including after closing/reopening its Editor. Resolution: keep rejected review input read-only; retain the rejected board revision in the parent, require a successful revision advancement, then explicit re-edit/discard before another submission. A different response object with the rejected revision is not fresh eligibility. Prevention: test failed and stale-successful reads, replacement editors, both re-edit/discard paths and exact submitted revisions [1,2]. Only pristine explicitly discarded fields adopt the newly verified server base; dirty fields remain untouched.
- I2: the inherited author-first edit predicate granted a demoted notice author writable recovery, while the server requires current administrator status for every notice write. Resolution: check board kind and current admin qualification before author/staff ownership in both the detail action and draft writability. Prevention: authenticate the same notice author as admin, save a draft, reconcile as user or reviewer and assert no Edit/Restore/Re-edit/Save action.
- I3: authentication generation stayed current during ordinary SPA unmount, so an old success callback cleared the same tuple's newer draft and could navigate its replacement away. Resolution: invalidate form lifetime in layout cleanup, maintain current tuple ownership, and capture submission instance/sequence/version plus fields/base revision. All five draft submitters gate destructive success/reset/refresh/navigation on markSubmitted(receipt), and guard errors/finally by current submission lifetime. Prevention: hold a real POST across leave/return/new edit, release it, fire lifecycle flushes and assert newer storage/input and route remain unchanged; also cover newer input in the same mounted form and authoritative current success.
- Test correction: the first board-conflict evidence query expected the body as an exact standalone text node, but the latest-content disclosure includes title and body in one paragraph. Resolution: assert the scoped disclosure text rather than changing product content. Prevention: inspect actual accessible content and separate a selector failure from the revision-eligibility regression, which was independently reproduced before its fix.
- I1 status precision: the first recovery classifier recognized503/network only, so an HTTP500 server/DB outage still unmounted the same cached-authorized input. Resolution: classify GET5xx failures as transient and keep authorization denials/non-retryable failures separate; POST failures never gain retry. Prevention: pin GET500/502/504 and POST500/504 policy cases plus real board/comment500 preservation with unavailable storage, followed by permission403 hiding.
- Capture correction: focusing a lower review comment scrolled the page, and Chromium full-page capture displaced fixed sidebar/skip-link painting. Resolution: normalize scroll to the document top only inside opt-in capture, preserving the active element and the subsequent focus assertions. Prevention: inspect fixed chrome in full-page evidence as well as document width; do not change product focus behavior to manufacture screenshots.

- Tracking-script correction: a final docs update again resolved repository-relative paths from the docs directory and failed before editing; the unguarded shell still launched an unchanged-docs build. Resolution: rerun using the absolute task root and `set -e`, inspect the actual tracking diff, then build the edited docs. Prevention: make the absolute repository root and fail-fast shell mandatory for multi-step edit/validation commands.

### A2 review round 2 — receipt version reuse (2026-11-17)

- Residual I3/R1: a receipt captured version1, but conflict discard reset the mounted form to0 and one new edit reused1. Releasing the earlier accepted board PUT then cleared the newer draft and closed the editor. Resolution: keep edit versions monotonic across discard, qualification pruning, successful clear and pristine server-field/base adoption; only a new form instance initializes at0. Keep `isCurrentSubmission` independent of edit version so the pending request settles busy while stricter `markSubmitted` rejects destructive completion. Prevention: delay an accepted PUT across the revision2 poll, discard the resulting conflict, make exactly one new edit, release success and assert editor/value/storage plus enabled Save after lifecycle flush. Audit every reset rather than only direct typing.

- Communication note (controller-supplied): progress updates repeatedly mixed Japanese or a Han-script word into Korean, including a further recurrence during E1. Resolution: restate the update in natural Korean. Prevention: scan each progress message for Han, Hiragana and Katakana characters before sending, while allowing ordinary technical English; remove unintended language mixing. No product behavior changed.

## 2026-11-17 — A3 saved views and list return

- A create-name conflict initially set the same read-only conflict flag as a stale edit revision, leaving a corrected new name unable to submit. The browser regression failed on the disabled save button. Only an existing edit now requires explicit revision acknowledgement; new-view validation conflicts preserve input and allow an explicit retry. Keep create validation and edit CAS recovery separate.
- The first ownership test sent an empty PATCH and the first CAS race reused an existing name, testing request validation/name uniqueness instead of ownership/CAS. Use a valid changed field and unique synthetic race names so each assertion exercises its intended boundary.
- SQLite migration inspection reused a pooled connection after another process dropped and recreated tables and returned stale index metadata. Discard pooled connections after every external migration before inspecting the schema; PostgreSQL and SQLite roundtrips both use isolated synthetic storage.
- Browser setup initially omitted the existing OIDC helper's HTTPS trust option, used a Korean locator after selecting English, and omitted Origin on explicit fixture writes. Reuse the fixture's complete trust/language/CSRF contract, with absolute fixture API URLs; do not weaken production authentication or CSRF to repair tests.
- A broad Scans locator could select sidebar navigation before lazy detail content mounted. Scope the return action to main content. Select the scope control by its combobox role; wrapping-label lookup did not consistently identify it despite its accessible name.
- A delayed-default test passed its URL assertion but left a second intercepted GET running at teardown. Intercept one controlled request and await its fulfillment before asserting and finishing. This was test teardown, not evidence of stale navigation; the completed-response assertion separately confirms that a newer explicit URL wins.
- The controller's sandbox-level PostgreSQL readiness probe could not see the owned server, leading to a redundant restart attempt; no data changed. Verify readiness in the same escalated execution context used by database tests before restarting any owned fixture.

- Self-review found that a network failure after an accepted save allowed retry before checking current resources. A browser test aborted the accepted response and failed on the still-enabled save button. Ambiguous writes now require an explicit latest-view reload before further mutations; no write is replayed automatically.
- Immediate viewport-resize capture caught a finite sidebar transition mid-animation. Disable animations in opt-in evidence captures and inspect mobile images before publishing them. Saved-view panels reuse the existing form-panel padding rather than adding color tokens.

- Existing browser scenarios with a mocked identity need the new personal saved-view read to belong to that same synthetic session. Extend those fixtures with an empty saved-view response rather than accidentally calling an unauthenticated live API and expiring the mocked session.

- Full browser validation exposed duplicate failure alerts on denied scan scopes. Keep the single server failure alert and render scope-correction guidance as a status note. The preexisting scope regression now verifies denial and recovery together.
- A slow initial saved-view GET could overwrite a mutation's newer refreshed list or surface an obsolete server failure. Browser regressions reproduced both. Sequence every read and discard stale successes and failures; keep mutation lifetime/account/edit checks separate.
- A saved review filter allowed rejected/approved status while the existing list forwarded only pending. The strengthened browser case reproduced an unwanted pending row under rejected status. Forward the explicit status and preserve it through pagination; assert displayed rows, not only URL text.
- Queryless entries cannot be classified from the router key shape or sessionStorage URL alone. Track successfully observed account/auth-generation/resource/history entries only for the current document. A fresh document applies the current default even with a retained router key; observed within-document POP preserves the prior standard list. Explicit query and validated detail-return context always win. Across-document back to an unobserved queryless entry may apply the current default.
- Expanding A3 beyond fifteen browser scenarios hit the owned OIDC fixture's real per-minute limit. Start and stop that existing fixture per A3 scenario, preserving production limits without shared-login sleeps. Wait for the actual lazy page heading before going back; URL changes can precede committed content.

- A first-query parsing regression hid later parameters after a second question mark (for example a synthetic token field after a search value). The unit test reproduced persistence of the forbidden field. Parse the whole query after the first delimiter, validate every parameter, and validate context before it enters router return state as well as before sessionStorage writes.


## 2026-11-17 — A3 round1 review I1/I2

- I1: useLoad invalidated an old path only in its effect, so a changed-path render still exposed the previous data/loading state to pagination and scroll effects. A delayed same-mounted broad-page3 → restrictive-page1 → Back regression observed page3 rewritten to page1 before its response. Associate successful snapshots with their actual request path and hide mismatched-path data/error/loading synchronously. Preserve same-target authorized snapshots through transient reads/retry. Test delayed query transitions as well as remounted detail return.
- The loader identity fix alone kept the URL but restored scroll0 instead of the prior900: one last-list slot had been replaced by the restrictive query. Preserve validated URL/scroll per opaque history-entry identity, and mark scroll restoration complete only after matching rows and the scheduled restore; cancel a scheduled restore on cleanup.
- I2: the earlier controller/implementation ruling allowed current defaults to replace queryless URLs on cross-document Back. That ruling contradicted the binding history contract and is superseded. Store only an opaque generated entry UUID in history state and validated account/resource/URL/scroll context in tab storage. Use actual browser back_forward intent across document recreation, supplemented by within-document entry observations. A fresh navigate/relogin/reload still applies current defaults; actual Back preserves the original URL even if cached metadata is unavailable. The regression proves a new document (old JS marker absent) and navigation type back_forward, then verifies reload of the retained entry applies the current default.
- A build was attempted while intentionally RED unit imports for the not-yet-created entry helpers were still present. Finish that dependent helper implementation before using a complete TypeScript build as the next checkpoint; the final build and focused tests verify the completed dependency chain.


## 2026-11-17 — B1 rerun validation

- Browser test setup initially reused an older local E2E database after adding Job columns, so startup failed with a missing column. Use a fresh owned E2E port/database for schema changes (or migrate an owned fixture); never alter shared application data to make tests pass.
- The first browser fixture omitted the existing HTTPS certificate test option, so SSO did not complete. Reuse the complete `oidcFixture` setup, including `ignoreHTTPSErrors` for its owned synthetic provider; production TLS/auth rules remain unchanged.
- Two browser checks raced draft debounce or a same-path query transition and edited the departing form. Wait for visible saved-draft state and the destination form before testing late-response preservation; arbitrary sleeps do not prove lifecycle order.
- Focused skip-link/scroll state initially misaligned desktop/mobile evidence; normal main-region focus, font readiness and top scroll corrected it without production CSS changes. A screenshot helper also assumed every state had an h1 and timed out on denied origins. Focus the existing main region and reset scroll after font readiness; do not hide the skip link or change production CSS for evidence.
- An initial heredoc used a repository-relative path while already in `frontend`, so the test file was not written. Resolve paths against the command working directory before writes. Ruff also flagged two test import orders; run the configured formatter/import sorter before final validation.


## 2026-11-17 — B1 review gate consistency

- A binding Korean/English UI gap was initially reported as failed spec compliance but Minor/Approved. The verdict and severity were corrected to Important/Needs fixes; check that requirement gaps, issue grades and the final assessment agree before publishing a review.
- A controller `send_message` to an idle reviewer queued instructions without starting work. `followup_task` resumed the reviewer; use followup for idle work and reserve send_message for an agent already running.


## 2026-11-17 — E1 precise links and summaries

- Two test-write commands repeated the `frontend/` prefix from an already-selected frontend directory and did not write their intended files. Resolution: use the absolute worktree root for subsequent edits, inspect created files, and rerun the intended RED checks. Prevention: fail fast on writes and validate working-directory-relative paths before any dependent test command.
- Browser setup initially selected previously used ports whose owned local E2E databases predated Job lineage columns. Startup failed with a missing column, before product checks. Resolution: preserve those databases and select port28435 only after verifying its database did not exist. Prevention: verify a fresh database path, rather than assuming a different port is unused; do not reset shared data.
- The first mobile detail-tools menu was anchored to its narrow trigger and extended outside the viewport; the browser could see the copy button but could not click it. Resolution: use a normal, wrapping inline tools panel on mobile and existing color tokens. Prevention: exercise the actual mobile action and document-width checks before accepting screenshots.
- Two initial browser assertions had selector errors: print has two hidden tools groups, and the shared read alert contains both the original failure and recovery guidance. Resolution: assert zero visible tools and scope the failure to its alert. The clipboard-summary assertion also read the old copied link before its asynchronous GET settled; wait for the copied summary value. Prevention: distinguish locator/async harness failures from product regressions and await user-visible completion.
- Generated summaries initially used English-only fixed labels. Resolution: provide fixed Korean/English headings, labels and notices without changing the locale-free builder API; verify Korean tools and bilingual summary on desktop/mobile. Prevention: include generated artifact text in localization review, as well as React controls.
- Rendered Markdown regression: punctuation encoded as numeric entities blocked raw Markdown syntax but remark-gfm decoded those entities and auto-linked bare URLs, domains and emails. The actual builder→React Markdown check found six active links where only the canonical scan link was permitted. Resolution: put punctuation-bearing user values in CommonMark code spans, with a fence longer than every input backtick run and normalized control/newline characters; keep simple text readable. Prevention: test the actual Python builder output through the production frontend renderer, including URL/email, backtick and newline attacks, instead of relying only on raw-output substring assertions. The web CI job already prepares the Python environment used by this integration test.
- The code-span escape fix exposed the inherited dark inline-code fill when printing from dark mode. A focused print CSS assertion reproduced that fill against white paper. Resolution: remove inline-code fill and use the literal print-ink token within the summary print scope. Prevention: print the escaped summary from dark mode as well as inspecting its light-mode screen view.
- Existing A3 I1 failed in the E1 full suite and again alone: Back restored0 instead of the recorded on-screen900. A no-console in-memory diagnostic proved that native change saw scroll900 before its queued scroll event; the event arrived only after the filter URL changed and the shorter page had clamped to0. The entry therefore still stored0; request-path masking and RAF restore sequencing were unchanged. Resolution: return an explicit, account/current-URL/matching-data guarded `rememberPosition` callback from useListContext and call it before filter/tab/page/query navigation and SavedViews Apply. A provisional native-change listener was replaced because click-only navigation should use the same explicit contract without global interception. Prevention: retain the original no-sleep browser assertion and exercise immediate scroll→filter→Back, rather than waiting for a storage event in the test. Temporary diagnostics are removed; no production logs added.


## 2026-11-17 — E1 review round1 literal query preservation

- I1: Findings' generic URL updater treated `all` as a deletion sentinel for every field, including literal q. Actual controlled-input typing a→al→all erased the search field and prevented completing allow. Resolution: interpret `all` only for severity/engine; preserve every other nonempty value. Prevention: type each character through the real controlled input and assert each visible intermediate value, URL retention, all-filter reset, polling/reload and exact duplicate selection. Empty q still clears normally. The initial zero-delay multi-character probe observed an intermediate value; waiting on each visible character made the named sentinel failure deterministic without sleeps. An initial fixture edit script failed an indentation-specific replacement assertion before writing anything; inspect actual formatting and gate edits before dependent commands.

## 2026-11-17 — C1 review assignment and recovery

- A rapid review403 followed by session reconciliation invalidated the account generation before a pending draft debounce ran. Flushing only the decision form still lost a newly typed comment on the same page (reproduced by the real OIDC browser test). Flush every registered form through `sessionCoordinator.flush()` before qualification reconciliation; ordinary409 resource reload must retain the current form lifetime. Keep the rapid co-located draft regression and receipt guards.
- An untouched decision draft initially retained the pre-claim revision. Let a pristine loaded form adopt the latest revision/initial fields, incrementing its monotonic authored version. Dirty/candidate drafts never adopt polling revisions; test claim→release→claim→decision and explicit409 recovery together.
- Initial browser fixture assumptions used a nonexistent SSO button and select labels whose wrapping text included option labels. Inspect current link/role contracts first; use explicit localized accessible names for workflow selects. A conditional tab array also needed a tuple type to satisfy `Tabs` at build time.
- Responsive captures taken immediately after resizing included the sidebar's outgoing CSS transition. Capture with reduced motion, disable animations and verify the sidebar has left the mobile viewport before recording evidence. Keep capture opt-in and synthetic only.
- A first formatting invocation used `npm --prefix ... exec` with paths relative to the frontend, but that command retained the repository working directory. Run formatting from the explicit frontend directory. Locate files with `rg --files` before reads instead of guessing split component filenames. Imported pytest fixtures also require the explicit fixture-import lint annotation.
- Unknown write outcomes require an actual fresh authorized resource read before enabling an explicit retry. A local acknowledgement button alone does not establish current state. The uncertain-release regression preserves its reason and exercises read→manual retry without automatic replay.

- The first concurrency review overlooked the existing last-admin `FOR UPDATE` lock, which can include a reviewer decision's requester/notification recipient. A synchronized real PostgreSQL decision plus admin demotion reproduced `DeadlockDetected`: reviewer User → recipient FK versus admin requester User → reviewer User. Use `FOR NO KEY UPDATE` for active-admin serialization; it still serializes admin permission changes while allowing FK KEY SHARE. Keep the dual-engine real-HTTP regression and verify lock strength across existing callers, not only new notification sequence rows.
- The initial full browser run exposed incomplete pre-C1 review mocks: `/events` fell through to the real unauthenticated API, whose401 correctly expired the synthetic session. Stop the known-broken owned runner, add the missing authorized events response and current revision/workflow/assignee fixture fields, and rerun existing assertions. Keep fixture contracts synchronized when adding authenticated reads; never weaken production401 handling to accommodate mocks.
- A controller multiline JavaScript command used an ordinary quoted string and failed with SyntaxError before any tool/file action. It was corrected with a `String.raw` template and quoted Python heredoc. Use explicit multiline templates or structured arguments and avoid untrusted interpolation; no product/source change resulted from that failed command. The same controller error recurred after the C1 commit; no tool action occurred. During C2, a String.raw command also contained an unescaped nested backtick and failed before any tool action. Always use String.raw or structured multiline arguments, and avoid nested backticks (use concatenation or encoded content); verify the outer JavaScript parses before dispatch.

- C1 initially implemented keyset `after` activity pagination but omitted the source spec's public `page` parameter, which FastAPI silently ignored. A dual-engine page2 assertion reproduced the wrong first page. Add validated page/page_size with the same stable created_at/id order, retain after only as an additive option, and reject ambiguous page>1+after. Compare the actual API table to tests, not only the implementation brief's abbreviated endpoint list.

- The new release form initially treated any review read error as lost write eligibility, disabling its textarea and dropping focus even for a previously authorized cached503 read. The focused browser assertion reproduced that loss. Accept retryable same-target read recovery for the assignment form while retaining revision/qualification/unknown-write guards, matching the existing decision/comment contract. An earlier full browser run also observed one existing saved-view scenario with concurrent Failed to fetch/loading state; its unchanged traced isolated rerun passed, followed by the final full129/129 pass. Record all outcomes, avoid speculative shared-state fixes, and require final-head validation.


## C2 review changes validation (2026-11-17)
- The first new browser RED used a click timeout and cleanup obscured the missing-control assertion. An explicit visibility assertion now proves the absent control, with a bounded scenario timeout that leaves time for owned-fixture cleanup.
- Additive review_updates and legacy atomic-claim delivery changed existing notification DTO/count expectations. Update complete fixtures and assert each distinct event exactly once; retain the existing decision-event deduplication assertion.
- The first settings browser assertion navigated to general /settings instead of the existing /notifications?view=settings screen. Inspect the actual settings link before writing a route assertion.
- The scoped lock-order review found legacy claim notification allocation was placed before decision Job/audit writes. Move both legacy notifications after all domain/events/audit changes and retain the existing sorted inbox helper. Check producer call order, not only helper transaction ownership.
- Documentation heredocs initially emitted literal backslash-n separators. Read the generated Markdown tail and place the traceability row inside its existing table before the docs build.
- The full-check wrapper used zsh's read-only status name for a captured exit code, so the wrapper failed after its child command. Use a task-specific result_code variable (or return the command directly); inspect each child log rather than treating a trailing wrapper failure as a product test failure.
- Ruff flagged imported parametrized fixture names as unused/redefined in the new test module. Use explicit fixture re-export (workflow as workflow) and sorted imports, matching pytest discovery without broad lint suppression.
- A lesson update used a repository-relative path while the command workdir was docs. The read failed before mutation. Keep documentation edits at repository root and build-only commands in docs, and inspect the actual workdir before composing relative paths.
- A quoted Boolean server_default="true" in SQLAlchemy metadata becomes SQLite text, so raw DB-default preference rows failed the IS TRUE delivery predicate (RED on SQLite; PostgreSQL passed). Use SQLAlchemy true() for the model default, matching the migration's sa.true(), and test delivery after raw insertion that omits the new column on both engines.

## 2026-11-17 — C3 follow-up implementation checks

- Initial code discovery assumed conventional file names (backend/alembic, scan_service.py, Rerun.tsx) that this repository does not use. Reads failed without edits. Resolved by locating the actual migration/service and existing Scans form paths with rg --files; inspect the inventory before assuming module names.
- The first linked-visibility test kept the synthetic owner’s reviewer qualification enabled, so a foreign-requester link correctly remained staff-visible. Corrected the fixture to remove that qualification before asserting hidden links. Authorization tests must explicitly establish both ownership and independent staff permissions.
- The first C3 browser run used the OIDC synthetic job as a ZIP rerun origin even though its legacy fixture source type is zip, while real uploads use upload. The final flow creates an actual static ZIP scan and waits for completion. End-to-end lineage tests must use the real submission API’s persisted source contract.
- That initial browser failure was masked by context-close cleanup after an action timeout. Cleanup now tolerates an already-closed browser and an explicit visibility assertion precedes the action, preserving the primary failure. A sandbox process-inspection attempt was denied; owned browser-process diagnostics use escalation.
- A documentation append failed at JavaScript parsing because Markdown backticks were embedded in a raw template literal. No shell command ran. Use plain prose or escape template delimiters when constructing multiline tool scripts.
- Browser setup originally selected the wrapped Decision label with an exact accessible-name match; the select’s option text is included in that wrapping label. The existing form defaults to rejection, so the test now uses its explicit Decision reason label and verifies the actual saved decision. Use observed explicit accessibility names instead of guessing implicit label text.
- First lint pass found compact one-line fixture branches and unused test imports. Ruff’s fixer removed imports and its formatter expanded branches; final lint is run separately after formatting so a later formatter exit does not conceal earlier lint failure.
- The synthetic403 browser test initially expected permanent read-only state even after auth/me requalified the same owner. App intentionally remounts during reconciliation. Corrected the assertion to both persisted reason drafts, explicit restoration and no automatic replay; authorization loss and renewed qualification are separate outcomes.
- A rollback assertion assumed the assignee was the first notification recipient. The actual reviewer set also contains a synthetic bootstrap reviewer and is globally sorted. Fault injection now waits until both legitimate event kinds have been emitted, then verifies complete rollback; do not assume fixture-generated identifiers sort after named actors.

## 2026-11-17 — B2 source history implementation checks

- Initial discovery assumed return_to.py/returnTo.ts; both reads failed without mutation. Located the actual return_paths.py/returnPaths.ts with rg --files. Inventory filenames before assuming module names.
- An implementation command failed during JavaScript parsing because TypeScript template literals were embedded in String.raw. No shell command ran. Use string concatenation inside generated source or an independently quoted structured patch.
- First lint pass found unused test imports; the scoped Ruff fixer removed them. Keep test imports minimal and rerun lint separately from formatting.
- Two first browser assertions used exact getByText against text nodes whose parent also contained a link or retry guidance. The recorded accessibility trees showed correct empty/error UI. Assert the empty container's and alert's actual text, while retaining separate actionable-link/retry checks.
- The first visual pass showed history heading and filters against the panel edge because the existing panel class supplies borders but no content padding. Applied the established panel-heading structure and narrowly scoped spacing without new color tokens. Inspect desktop and mobile captures before declaring UI completion.
- Root screenshot QA found the new Korean review column showed raw pending/in_review values. Reproduced with a table-text browser assertion, localized status and reused workflowLabel; the same assertion passed with 대기 · 검토 중. Pin translated review/workflow output in the Korean browser state before capture approval.
- The isolated copy regression first used a frontend-relative CLI path from repository root, then lacked the frontend package's ESM setting. Neither reached product assertions. Use the actual frontend CLI path and a temporary package.json with type=module for out-of-tree Playwright probes.
- An exact replacement for the review JSX missed Prettier's line breaks, so the first attempted copy fix still failed the same assertion. Inspected the rendered expression, replaced each actual expression and confirmed GREEN. Assert replacement counts or inspect the changed source before rebuilding.
