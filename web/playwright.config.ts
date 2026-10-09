import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke suite. Needs a runnable app: `web/.env.local` must contain at least
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. First run:
 * `npx playwright install chromium`, then `npm run test:e2e`.
 *
 * Two projects run by default: desktop Chrome, and an iPhone-sized Chromium
 * (viewport, touch, device scale factor and mobile UA — no extra browser to
 * install). Set E2E_WEBKIT=1 to add real WebKit on the same iPhone profile,
 * after a one-time `npx playwright install webkit`.
 */
const projects = [
  { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  {
    name: "iphone-emulated",
    use: { ...devices["iPhone 14"], browserName: "chromium" as const, defaultBrowserType: "chromium" as const },
  },
];
if (process.env.E2E_WEBKIT) {
  projects.push({ name: "iphone-webkit", use: { ...devices["iPhone 14"] } });
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
  projects,
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
