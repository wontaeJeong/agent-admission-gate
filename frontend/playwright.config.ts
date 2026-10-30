import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:8000",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command:
      "cd .. && AAG_DATABASE_URL=sqlite:///./data/e2e.db AAG_BOOTSTRAP_PASSWORD=test-password-long AAG_BOARDS_ENABLED=true uv run uvicorn aag.main:app --host 127.0.0.1 --port 8000",
    url: "http://localhost:8000/health/live",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
