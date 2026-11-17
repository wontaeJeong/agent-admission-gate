import { describe, expect, it } from "vitest";
import { normalizeReturnTo } from "./returnPaths";

describe("safe login destinations", () => {
  it("preserves the finding selection but removes credential query fields", () => {
    expect(
      normalizeReturnTo(
        "/jobs/job-1?tab=findings&finding=abc&occurrence=2&token=secret",
      ),
    ).toBe("/jobs/job-1?tab=findings&finding=abc&occurrence=2");
    expect(normalizeReturnTo("/new?from=j&mode=snapshot")).toBe(
      "/new?from=j&mode=snapshot",
    );
  });
  it.each([
    "//evil.test",
    "%2f%2fevil.test",
    "/%252fevil.test",
    "/jobs/../admin",
    "/jobs/%2e%2e/admin",
    "/jobs\\evil",
    "/jobs\n",
    "/api",
    "/login",
    "/sso/callback",
    "/" + "a".repeat(2048),
  ])("rejects unsafe destination %s", (path) => {
    expect(normalizeReturnTo(path)).toBe("/");
  });
});

it.each([
  "/notifications/open/n-1",
  "/notifications?view=settings",
  "/reviews?tab=mine&page=3",
  "/jobs?mine=true&page=3",
])("preserves current navigation state %s", (path) => {
  expect(normalizeReturnTo(path)).toBe(path);
});
it("caps the encoded destination length before storage", () => {
  expect(normalizeReturnTo("/jobs?q=" + "가".repeat(300))).toBe("/");
});

it("preserves history filters only for the history tab", () => {
  const path =
    "/jobs/j?tab=history&ref=release&profile=full&status=COMPLETED&page=2&page_size=25";
  expect(normalizeReturnTo(path + "&token=secret")).toBe(path);
  expect(normalizeReturnTo("/jobs/j?tab=meta&ref=release&page=2")).toBe(
    "/jobs/j?tab=meta",
  );
  expect(
    normalizeReturnTo(
      "/jobs/j?tab=history&profile=invalid&status=NO&page=0&page_size=101",
    ),
  ).toBe("/jobs/j?tab=history");
});
