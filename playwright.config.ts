import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  timeout: 45_000,
  fullyParallel: false,
  reporter: [["line"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? process.env.ATLAS_E2E_BASE,
    headless: true,
    trace: "retain-on-failure",
  },
});
