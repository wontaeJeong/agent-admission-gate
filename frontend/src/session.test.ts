import { describe, expect, it, vi, afterEach } from "vitest";
import { SessionCoordinator, sessionCoordinator } from "./session";
import { api, sendAsAccount } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionCoordinator.setAccount(null);
});

describe("session coordination", () => {
  it("flushes before a single expiry notification for simultaneous 401s", () => {
    const session = new SessionCoordinator();
    session.setAccount("alice");
    const captured = session.capture();
    const events: string[] = [];
    session.registerFlush(() => events.push("flush"));
    session.subscribe(() => events.push("expired"));
    session.expire(captured);
    session.expire(captured);
    expect(events).toEqual(["flush", "expired"]);
  });
  it("ignores old-account and old-generation expiry responses", () => {
    const session = new SessionCoordinator();
    session.setAccount("alice");
    const first = session.capture();
    session.setAccount("bob");
    session.setAccount("alice");
    let expired = false;
    session.subscribe(() => {
      expired = true;
    });
    session.expire(first);
    expect(expired).toBe(false);
  });
  it("never applies a late mutation response after account reconciliation", async () => {
    sessionCoordinator.setAccount("alice");
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const submitted = sendAsAccount("/api-keys", { name: "New key" }, "alice");
    sessionCoordinator.setAccount("bob");
    finish(
      new Response(JSON.stringify({ token: "synthetic" }), { status: 201 }),
    );
    await expect(submitted).rejects.toMatchObject({ status: 409 });
  });
  it("preserves multipart bodies and sends the captured account header", async () => {
    sessionCoordinator.setAccount("alice");
    const body = new FormData();
    body.set("profile", "static");
    let observed: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
      observed = init;
      return new Response(JSON.stringify({ id: "job-1" }), { status: 202 });
    });
    expect(await sendAsAccount("/scans/upload", body, "alice")).toEqual({
      id: "job-1",
    });
    expect(observed?.body).toBe(body);
    expect(new Headers(observed?.headers).get("X-AAG-Account")).toBe("alice");
    expect(new Headers(observed?.headers).has("Content-Type")).toBe(false);
  });
  it.each([403, 503])("does not expire sessions on HTTP %i", async (status) => {
    sessionCoordinator.setAccount("alice");
    let expired = false;
    const unsubscribe = sessionCoordinator.subscribe(() => {
      expired = true;
    });
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ detail: "Unavailable" }), { status }),
    );
    await expect(api("/scans")).rejects.toMatchObject({ status });
    expect(expired).toBe(false);
    unsubscribe();
  });
  it("excludes invalid login credentials from expiry and ignores a stale 401", async () => {
    sessionCoordinator.setAccount("alice");
    let count = 0;
    const unsubscribe = sessionCoordinator.subscribe(() => {
      count++;
    });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(api("/auth/login")).rejects.toMatchObject({ status: 401 });
    expect(count).toBe(0);
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const request = api("/scans");
    sessionCoordinator.setAccount("bob");
    finish(new Response("{}", { status: 401 }));
    await expect(request).rejects.toMatchObject({ status: 409 });
    expect(count).toBe(0);
    unsubscribe();
  });
});

it("broadcasts changed observed accounts once and keeps repeated reads quiet", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  const { publishAccountObservation } = await import("./session");
  publishAccountObservation("alice");
  const firstEvent = values.get("aag-auth-change");
  expect(firstEvent).toBeTruthy();
  publishAccountObservation("alice");
  expect(values.get("aag-auth-change")).toBe(firstEvent);
  publishAccountObservation("bob");
  expect(values.get("aag-auth-change")).not.toBe(firstEvent);
  expect(values.get("aag-auth-observed-account")).toBe("bob");
});

it.each([
  [new Error("Unexpected"), "GET", null, false],
  [new TypeError("Failed to fetch"), "GET", null, true],
  [new TypeError("Failed to fetch"), "POST", null, false],
])(
  "offers connection recovery only for a failed GET (%s, %s)",
  async (error, method, status, retryable) => {
    const { requestRecovery } = await import("./api");
    expect(requestRecovery(error, method)).toEqual({ status, retryable });
  },
);
it.each([
  [401, "GET", false],
  [403, "GET", false],
  [404, "GET", false],
  [500, "GET", true],
  [502, "GET", true],
  [503, "GET", true],
  [504, "GET", true],
  [500, "POST", false],
  [504, "POST", false],
  [503, "POST", false],
])(
  "preserves HTTP %i and limits retry to reads (%s)",
  async (status, method, retryable) => {
    const { APIError, requestRecovery } = await import("./api");
    expect(
      requestRecovery(
        new APIError(status as number, "Unavailable"),
        method as string,
      ),
    ).toEqual({ status, retryable });
  },
);
