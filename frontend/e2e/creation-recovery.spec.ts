import { expect, test, type Browser, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test.setTimeout(90000);
const zip = Buffer.from(
  "UEsDBBQAAAAAADBtYVsAAAAAAAAAAAAAAAAJAAAAcmVhZG1lLm1kUEsBAhQDFAAAAAAAMG1hWwAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS5tZFBLBQYAAAAAAQABADcAAAAnAAAAAAA=",
  "base64",
);
const correctedZip = Buffer.from(
  "UEsDBBQAAAAAAEaBcV25HRtQIQAAACEAAAAJAAAAcmVhZG1lLm1kQ29ycmVjdGVkIHN0YXRpYyBzb3VyY2UgcGFja2FnZS4KUEsBAhQDFAAAAAAARoFxXbkdG1AhAAAAIQAAAAkAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS5tZFBLBQYAAAAAAQABADcAAABIAAAAAAA=",
  "base64",
);
async function login(browser: Browser, origin: string, account = "alice") {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
  });
  await context.addCookies([
    { name: "oidc_test_account", value: account, url: origin },
  ]);
  await context.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  const page = await context.newPage();
  await page.goto(origin + "/jobs");
  await page.getByRole("link", { name: "Sign in with SSO" }).click();
  await expect(
    page.getByRole("heading", { name: "Scans", exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  return { page, context };
}
async function upload(page: Page, origin: string, from?: string) {
  const response = await page.request.post(origin + "/api/scans/upload", {
    headers: { Origin: origin, "X-AAG-Account": "a1-alice" },
    multipart: {
      file: {
        name: "source.zip",
        mimeType: "application/zip",
        buffer: from ? correctedZip : zip,
      },
      ...(from ? { origin_job_id: from } : {}),
    },
  });
  expect(response.status()).toBe(202);
  const job = await response.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(origin + "/api/scans/" + job.id)).json())
          .status,
    )
    .toBe("COMPLETED");
  return job;
}
async function capture(
  page: Page,
  name: string,
  mobile = false,
  light = false,
) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  const dir = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-final",
  );
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  await page.evaluate(
    (theme) => {
      document.documentElement.dataset.theme = theme;
    },
    light ? "light" : "dark",
  );
  if (mobile)
    await expect
      .poll(() =>
        page
          .locator(".sidebar")
          .evaluate((element) => element.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
  await page.locator("main").focus();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: resolve(dir, name + ".png"),
    fullPage: true,
    timeout: 15000,
    animations: "disabled",
  });
}
const bodies = { empty: "", truncated: '{"id":', missing: "{}" };
type Consumer = "scan" | "rerun" | "review" | "followup" | "board";
for (const consumer of [
  "scan",
  "rerun",
  "review",
  "followup",
  "board",
] as Consumer[]) {
  // Each case owns its API/database and at most two real OIDC logins.
  for (const [failure, body] of Object.entries(bodies)) {
    test(
      consumer +
        " committed " +
        failure +
        " response retains input and recovers without replay",
      async ({ browser }) => {
        const fixture = await startOidcFixture({
          reviewWorkflow: true,
          boards: true,
        });
        const owner = await login(browser, fixture.origin);
        let reviewer: Awaited<ReturnType<typeof login>> | undefined;
        const page = owner.page;
        try {
          let endpoint = "/scans/upload",
            route = "/new",
            checkName = "Check latest scans";
          let submitName = "Run scan",
            expectedPath = "/jobs/",
            fieldName = "";
          if (consumer === "rerun") {
            const old = await upload(page, fixture.origin);
            route += "?from=" + old.id + "&mode=latest";
          } else if (consumer === "review") {
            const job = await upload(page, fixture.origin);
            route = "/jobs/" + job.id;
            endpoint = "/scans/" + job.id + "/review";
            checkName = "Check latest review";
            submitName = "Request review";
            expectedPath = "/reviews/";
            fieldName = "Reason";
          } else if (consumer === "followup") {
            const old = await upload(page, fixture.origin);
            const request = await page.request.post(
              fixture.origin + "/api/scans/" + old.id + "/review",
              {
                headers: {
                  Origin: fixture.origin,
                  "X-AAG-Account": "a1-alice",
                },
                data: { reason: "Original synthetic review request" },
              },
            );
            expect(request.status()).toBe(201);
            const previous = await request.json();
            reviewer = await login(browser, fixture.origin, "bob");
            const decision = await reviewer.page.request.post(
              fixture.origin + "/api/reviews/" + previous.id + "/decision",
              {
                headers: { Origin: fixture.origin, "X-AAG-Account": "a1-bob" },
                data: {
                  decision: "rejected",
                  reason: "Correct the submitted static source",
                  expected_revision: previous.revision,
                },
              },
            );
            expect(decision.status()).toBe(200);
            const job = await upload(page, fixture.origin, old.id);
            route = "/jobs/" + job.id;
            endpoint = "/reviews/" + previous.id + "/follow-ups";
            checkName = "Check latest review";
            submitName = "Submit follow-up request";
            expectedPath = "/reviews/";
            fieldName = "Follow-up reason";
          } else if (consumer === "board") {
            endpoint = "/boards";
            route = "/boards?kind=voc";
            checkName = "Check latest posts";
            submitName = "Save";
            expectedPath = "/boards/";
            fieldName = "Title";
          }
          await page.goto(fixture.origin + route);
          if (consumer === "scan")
            await page
              .getByRole("tab", { name: "Upload package", exact: true })
              .click();
          if (consumer === "scan" || consumer === "rerun") {
            await page.locator("input[type=file]").setInputFiles({
              name: "retained-source.zip",
              mimeType: "application/zip",
              buffer: zip,
            });
            await page
              .getByLabel("Force a fresh scan", { exact: true })
              .check();
          } else {
            if (consumer === "followup")
              await page
                .getByRole("button", {
                  name: "Request follow-up review",
                  exact: true,
                })
                .click();
            if (consumer === "board") {
              await page
                .getByRole("button", { name: "Write a post", exact: true })
                .click();
              await page
                .getByLabel("Body", { exact: true })
                .fill("Synthetic post body retained after an uncertain write.");
            }
            await page
              .getByLabel(fieldName, { exact: true })
              .fill("Synthetic authored " + consumer + " input");
          }
          let posts = 0,
            createdId = "",
            release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          await page.route(
            fixture.origin + "/api" + endpoint,
            async (intercept) => {
              if (intercept.request().method() !== "POST")
                return intercept.continue();
              posts++;
              const response = await intercept.fetch();
              expect(response.status()).toBe(
                consumer === "scan" || consumer === "rerun" ? 202 : 201,
              );
              createdId = (await response.json()).id;
              await held;
              await intercept.fulfill({
                response,
                body,
                headers: {
                  ...response.headers(),
                  "content-type": "application/json",
                },
              });
            },
          );
          await page
            .getByRole("button", { name: submitName, exact: true })
            .click();
          await expect.poll(() => createdId).not.toBe("");
          // Scan and board inputs remain editable while a response is outstanding.
          if (
            failure === "truncated" &&
            (consumer === "scan" || consumer === "rerun")
          ) {
            await page
              .getByLabel("Force a fresh scan", { exact: true })
              .uncheck();
          }
          if (
            failure === "truncated" &&
            (consumer === "board" || consumer === "review")
          ) {
            await page
              .getByLabel(fieldName, { exact: true })
              .fill("Newer authored " + consumer + " input");
          }
          release();
          const check = page.getByRole("button", {
            name: checkName,
            exact: true,
          });
          await expect(check).toBeVisible();
          await expect(page).toHaveURL(fixture.origin + route);
          await expect(
            page.getByRole("button", { name: submitName, exact: true }),
          ).toBeDisabled();
          if (fieldName)
            await expect(
              page.getByLabel(fieldName, { exact: true }),
            ).toHaveValue(
              failure === "truncated" &&
                (consumer === "board" || consumer === "review")
                ? "Newer authored " + consumer + " input"
                : "Synthetic authored " + consumer + " input",
            );
          else {
            await expect(page.locator("input[type=file]")).toHaveValue(
              /retained-source.zip$/,
            );
            await expect(
              page.getByLabel("Force a fresh scan", { exact: true }),
            ).toBeChecked({ checked: failure !== "truncated" });
          }
          // Form submission events must not bypass the disabled replay action.
          await page
            .locator("form")
            .filter({
              has: page.getByRole("button", { name: submitName, exact: true }),
            })
            .evaluate((form) =>
              form.dispatchEvent(
                new Event("submit", { bubbles: true, cancelable: true }),
              ),
            );
          expect(posts).toBe(1);
          if (failure === "empty")
            await capture(page, consumer + "-unknown-desktop-dark");
          if (
            failure === "missing" &&
            (consumer === "review" || consumer === "board")
          )
            await capture(page, consumer + "-unknown-mobile-light", true, true);
          if (failure === "missing") {
            const checkPath =
              checkName === "Check latest scans"
                ? "/scans?mine=true&page_size=25"
                : checkName === "Check latest posts"
                  ? "/boards?kind=voc&page=1"
                  : endpoint.replace(
                      consumer === "review" ? "/review" : "/follow-ups",
                      "",
                    );
            const failedRead = fixture.origin + "/api" + checkPath;
            await page.route(failedRead, (intercept) =>
              intercept.fulfill({ status: 200, json: {} }),
            );
            await check.click();
            await expect(check).toBeEnabled();
            await expect(
              page.getByRole("button", { name: submitName, exact: true }),
            ).toBeDisabled();
            await expect(page).toHaveURL(fixture.origin + route);
            expect(posts).toBe(1);
            await page.unroute(failedRead);
          }
          const verified = page.waitForResponse(
            (r) =>
              r.request().method() === "GET" &&
              r.url().includes("/api/") &&
              (checkName === "Check latest scans"
                ? r.url().includes("/api/scans?mine=true")
                : checkName === "Check latest posts"
                  ? r.url().includes("/api/boards?")
                  : consumer === "review"
                    ? r.url().endsWith("/api" + endpoint.replace("/review", ""))
                    : r
                        .url()
                        .endsWith(
                          "/api" + endpoint.replace("/follow-ups", ""),
                        )),
          );
          await check.click();
          expect((await verified).status()).toBe(200);
          const recovered = page
            .locator('a[href="' + expectedPath + createdId + '"]')
            .first();
          await expect(recovered).toBeVisible();
          if (consumer === "board") {
            await expect(
              page.locator(
                '.post-row[href="' + expectedPath + createdId + '"]',
              ),
            ).toBeVisible();
            await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
              failure === "truncated"
                ? "Newer authored board input"
                : "Synthetic authored board input",
            );
          }
          expect(posts).toBe(1);
          if (failure === "empty" && consumer === "board")
            await capture(page, "board-verified-desktop-light", false, true);
          await recovered.click();
          await expect(page).toHaveURL(
            fixture.origin + expectedPath + createdId,
          );
          expect(posts).toBe(1);
        } finally {
          try {
            await reviewer?.context.close();
            await owner.context.close();
          } finally {
            await fixture.stop();
          }
        }
      },
    );
  }
}
