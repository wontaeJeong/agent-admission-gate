import { expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
/** Own one isolated API/database; replace only the external provider boundary. */
export async function startOidcFixture(
  options: {
    reviewWorkflow?: boolean;
    search?: boolean;
    notificationTargets?: boolean;
  } = {},
) {
  const root = resolve(import.meta.dirname, "../..");
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const port = address.port;
  await new Promise<void>((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  );
  const origin = `http://localhost:${port}`;
  const directory = mkdtempSync(resolve(tmpdir(), "aag-oidc-browser-"));
  const app = spawn(
    resolve(root, ".venv/bin/python"),
    [
      "-m",
      "uvicorn",
      "frontend.e2e.oidc_app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-access-log",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}/.venv/bin:/usr/bin:/bin`,
        AAG_PUBLIC_URL: origin,
        AAG_DATABASE_URL: `sqlite:///${directory}/fixture.db`,
        AAG_OIDC_FIXTURE_DIR: directory,
        AAG_C1_FIXTURE: options.reviewWorkflow ? "true" : "false",
        AAG_SEARCH_ENABLED: options.search ? "true" : "false",
        AAG_NOTIFICATION_TARGETS_FIXTURE: options.notificationTargets
          ? "true"
          : "false",
      },
      stdio: "ignore",
    },
  );
  const stop = async () => {
    if (app.exitCode === null) {
      app.kill("SIGTERM");
      await new Promise<void>((done) => app.once("exit", () => done()));
    }
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${origin}/health/ready`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 15000 },
      )
      .toBe(200);
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, stop };
}
