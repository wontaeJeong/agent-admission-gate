import { beforeEach, expect, it } from "vitest";
import {
  filtersFromSearch,
  filtersToSearch,
  rememberList,
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
