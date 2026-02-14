import { defineConfig, devices } from "@playwright/test";

const useAllProjects = process.env.PLAYWRIGHT_PROJECTS === "all";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const useLocalWebServer = !process.env.PLAYWRIGHT_BASE_URL;

const projects = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
];

if (useAllProjects) {
  projects.push(
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    }
  );
}

export default defineConfig({
  testDir: "tests/playwright",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: useLocalWebServer
    ? {
        command: "npm run dev -- --port 3000",
        port: 3000,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects,
});
