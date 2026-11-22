import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: process.env.ATLAS_UI_CONTRAST === "1" ? [] : ["**/ui-contrast.spec.ts"],
  globalSetup: "./tests/browser/global-setup.ts",
  timeout: 45_000,
  fullyParallel: false,
  reporter: [["line"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? process.env.ATLAS_E2E_BASE,
    headless: true,
    trace: "retain-on-failure",
    // The NGINX suite terminates TLS with a disposable self-signed CA.
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === "1",
  },
});
