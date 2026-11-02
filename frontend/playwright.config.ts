import { defineConfig } from "@playwright/test";
const port = Number(process.env.AAG_E2E_PORT || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("AAG_E2E_PORT must be a valid TCP port");
}
const baseURL = `http://localhost:${port}`;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: `cd .. && AAG_DATABASE_URL=sqlite:///./data/e2e-${port}.db AAG_PUBLIC_URL=${baseURL} AAG_BOOTSTRAP_PASSWORD=test-password-long AAG_BOARDS_ENABLED=true uv run uvicorn aag.main:app --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/health/live`,
    reuseExistingServer: !process.env.CI && !process.env.AAG_E2E_PORT,
    timeout: 60000,
  },
});
