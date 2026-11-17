import { beforeEach, expect, it, vi } from "vitest";
import {
  filtersFromSearch,
  filtersToSearch,
  rememberList,
  rememberListEntry,
  restoreListEntry,
  restoreList,
  validListState,
} from "./listNavigation";
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});
it("restores query and scroll only for the same account and list", () => {
  rememberList("alice", "jobs", "/jobs?scope=personal&q=sample&page=3", 815);
  expect(restoreList("alice", "jobs")).toEqual({
    accountId: "alice",
    resource: "jobs",
    list_url: "/jobs?scope=personal&q=sample&page=3",
    scroll_y: 815,
  });
  expect(restoreList("bob", "jobs")).toBeNull();
  expect(restoreList("alice", "reviews")).toBeNull();
});
it.each([
  "//evil.test/jobs",
  "/jobs/secret",
  "/reviews?tab=mine",
  "/jobs?token=secret",
  "/jobs?q=sample?another=value&token=synthetic",
  "/jobs?q=a&x=secret",
  "/jobs#secret",
])("rejects invalid list context %s", (url) => {
  rememberList("alice", "jobs", url, 20);
  expect(restoreList("alice", "jobs")).toBeNull();
});
it("rejects tampered router state and invalid scroll", () => {
  expect(
    validListState(
      {
        accountId: "bob",
        resource: "jobs",
        list_url: "/jobs?page=3",
        scroll_y: 20,
      },
      "alice",
      "jobs",
    ),
  ).toBeNull();
  rememberList("alice", "jobs", "/jobs", -1);
  expect(restoreList("alice", "jobs")).toBeNull();
});
it("saves only versioned filters and excludes transient page position", () => {
  expect(
    filtersFromSearch(
      "jobs",
      new URLSearchParams("scope=personal&days=7&q=demo&page=3"),
    ),
  ).toEqual({ version: 1, scope: "personal", days: 7, q: "demo" });
  expect(
    filtersToSearch({ version: 1, scope: "personal", days: 7 }).toString(),
  ).toBe("scope=personal&days=7");
});

it("keeps validated history entries separate across queries and document recreation", async () => {
  const broad = "11111111-1111-4111-8111-111111111111",
    narrow = "22222222-2222-4222-8222-222222222222";
  rememberListEntry("alice", "jobs", broad, "/jobs?scope=personal&page=3", 900);
  rememberListEntry(
    "alice",
    "jobs",
    narrow,
    "/jobs?scope=personal&verdict=ALLOW&page=1",
    0,
  );
  vi.resetModules();
  const reloaded = await import("./listNavigation");
  expect(
    reloaded.restoreListEntry(
      "alice",
      "jobs",
      broad,
      "/jobs?scope=personal&page=3",
    )?.scroll_y,
  ).toBe(900);
  expect(
    restoreListEntry("bob", "jobs", broad, "/jobs?scope=personal&page=3"),
  ).toBeNull();
  expect(restoreListEntry("alice", "reviews", broad, "/reviews")).toBeNull();
  expect(restoreListEntry("alice", "jobs", broad, "/jobs")).toBeNull();
});
it("does not persist unsafe URL or arbitrary history identity fields", () => {
  const entry = "11111111-1111-4111-8111-111111111111";
  rememberListEntry("alice", "jobs", entry, "/jobs?token=synthetic", 10);
  rememberListEntry("alice", "jobs", "token=synthetic", "/jobs", 10);
  expect([...values.values()].join("")).not.toContain("synthetic");
  expect(restoreListEntry("alice", "jobs", entry, "/jobs")).toBeNull();
});
it("preserves review workflow filters and literal all search through saved views and return", () => {
  const params = new URLSearchParams(
    "tab=actionable&stage=in_review&assignee=me&q=all&sort=oldest",
  );
  expect(filtersFromSearch("reviews", params)).toEqual({
    version: 1,
    tab: "actionable",
    stage: "in_review",
    assignee: "me",
    q: "all",
    sort: "oldest",
  });
  rememberList("alice", "reviews", "/reviews?" + params, 920);
  expect(restoreList("alice", "reviews")?.scroll_y).toBe(920);
});

it("keeps search return context account-bound and rejects unknown query keys", () => {
  rememberList(
    "alice",
    "search",
    "/search?q=CVE&type=findings&scope=personal&cursor=safe",
    240,
  );
  expect(restoreList("alice", "search")?.scroll_y).toBe(240);
  expect(restoreList("bob", "search")).toBeNull();
  for (const url of [
    "/search?q=CVE&token=secret",
    "/search?q=CVE&page=3",
    "/jobs?q=CVE",
  ]) {
    expect(
      validListState(
        { accountId: "alice", resource: "search", list_url: url, scroll_y: 1 },
        "alice",
        "search",
      ),
    ).toBeNull();
  }
});
