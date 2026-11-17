import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { sessionCoordinator } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionCoordinator.setAccount(null);
});

it.each(["", '{"id":'])(
  "rejects unreadable successful JSON %j",
  async (body) => {
    vi.stubGlobal("fetch", async () => new Response(body, { status: 201 }));
    await expect(api("/boards", { method: "POST" })).rejects.toBeInstanceOf(
      TypeError,
    );
  },
);
it("rejects an interrupted success body without exposing response content", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 202,
    json: async () => {
      throw new TypeError("sensitive response fragment");
    },
  }));
  await expect(api("/scans", { method: "POST" })).rejects.toThrow(
    "Response could not be read",
  );
});
it.each([204, 205])(
  "preserves explicit HTTP %i no-content success",
  async (status) => {
    vi.stubGlobal("fetch", async () => new Response(null, { status }));
    await expect(
      api("/resource", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  },
);
it("preserves text success and status errors with malformed bodies", async () => {
  vi.stubGlobal("fetch", async () => new Response("summary"));
  await expect(api("/summary", {}, "text")).resolves.toBe("summary");
  vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
  await expect(api("/scans")).rejects.toMatchObject({ status: 401 });
});
it("prioritizes an account change over a delayed malformed body", async () => {
  sessionCoordinator.setAccount("alice");
  let finish!: () => void;
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 201,
    json: () =>
      new Promise((_resolve, reject) => {
        finish = () => reject(new SyntaxError("truncated"));
      }),
  }));
  const request = api("/boards", { method: "POST" });
  await vi.waitFor(() => expect(finish).toBeDefined());
  sessionCoordinator.setAccount("bob");
  finish();
  await expect(request).rejects.toMatchObject({ status: 409 });
});
