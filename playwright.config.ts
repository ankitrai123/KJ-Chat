import { defineConfig, devices } from "@playwright/test";

/**
 * Three suites:
 *  - smoke: runs against a production build with placeholder config (no backend). Covers routing,
 *    form validation, network-error feedback, security headers, API auth/CSRF, PWA assets and
 *    responsive layout. Run with `npm run test:smoke`.
 *  - e2e:   full two/three-user flows against a deployed or local stack with a real Supabase
 *    project. Requires E2E_BASE_URL, E2E_SUPABASE_URL, E2E_SUPABASE_PUBLISHABLE_KEY and
 *    E2E_SUPABASE_SECRET_KEY.
 *  - media: real WebRTC calls through LiveKit between independent browser contexts using
 *    Chromium's synthetic camera/microphone/screen. Same env as e2e, and the target app must have
 *    LiveKit configured. Media is verified with WebRTC stats (bytes/frames received), not by the
 *    presence of a call screen.
 */
const SMOKE_PORT = 3100;
const e2eBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "smoke",
      testDir: "tests/e2e/smoke",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${SMOKE_PORT}` },
    },
    {
      name: "e2e",
      testDir: "tests/e2e/flows",
      timeout: 180_000,
      use: { ...devices["Desktop Chrome"], baseURL: e2eBaseUrl },
    },
    {
      name: "media",
      testDir: "tests/media",
      timeout: 240_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: e2eBaseUrl,
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--auto-select-desktop-capture-source=Entire screen",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
  webServer: process.env.PW_SMOKE_SERVER
    ? {
        command: `npx next start -p ${SMOKE_PORT} -H 127.0.0.1`,
        url: `http://127.0.0.1:${SMOKE_PORT}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { NEXT_DIST_DIR: ".next-smoke" },
      }
    : undefined,
});
