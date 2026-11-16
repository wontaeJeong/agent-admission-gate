import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { AppContext } from "./context";
import { useNotificationApi } from "./notifications";
import { sessionCoordinator } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionCoordinator.setAccount(null);
});

function notificationRequest(reconcileSession: (owner?: string) => void) {
  let request!: ReturnType<typeof useNotificationApi>;
  function Capture() {
    request = useNotificationApi();
    return null;
  }
  renderToString(
    createElement(
      AppContext.Provider,
      {
        value: {
          user: { id: "alice", name: "Alice", role: "user", reviewer: false },
          boards: false,
          apiKeysState: "disabled",
          lang: "en",
          profileRevision: 0,
          syncDisplayName: () => {},
          reconcileSession,
        },
      },
      createElement(Capture),
    ),
  );
  return request;
}

it.each(["GET", "PATCH"])(
  "ignores a delayed notification %s from an earlier same-account session",
  async (method) => {
    const reconciled: (string | undefined)[] = [];
    sessionCoordinator.setAccount("alice");
    const request = notificationRequest((owner) => reconciled.push(owner));
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = request("/notifications/example", { method });
    sessionCoordinator.setAccount(null);
    sessionCoordinator.setAccount("alice");
    finish(new Response("{}", { status: 200 }));
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(reconciled).toEqual([]);
  },
);

it("still reconciles an authoritative current server account mismatch", async () => {
  const reconciled: (string | undefined)[] = [];
  sessionCoordinator.setAccount("alice");
  const request = notificationRequest((owner) => reconciled.push(owner));
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          detail: "Notification account changed; reload required",
        }),
        { status: 409 },
      ),
  );
  await expect(
    request("/notifications/example", { method: "PATCH" }),
  ).rejects.toMatchObject({ status: 409 });
  expect(reconciled).toEqual(["alice"]);
});
