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
