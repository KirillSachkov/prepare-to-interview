import { defineConfig, devices } from "@playwright/test";
import { e2eEnv } from "./env.ts";

const { port } = e2eEnv();

// Run `pnpm e2e` from the repository root: it builds the client first.
export default defineConfig({
  testDir: "tests",
  globalTeardown: "./teardown.ts",
  // One server and one data directory: tests run in order and must not assume an empty Canvas.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 20_000,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node serve.ts",
    url: `http://127.0.0.1:${String(port)}/`,
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 20_000,
  },
});
