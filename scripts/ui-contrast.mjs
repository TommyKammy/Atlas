#!/usr/bin/env node
// Contrast audit for the disposable Atlas instance.
//
// Usage:
//   BASE=http://127.0.0.1:61411 node scripts/ui-contrast.mjs            # check
//   BASE=http://127.0.0.1:61411 node scripts/ui-contrast.mjs --check    # same
//   BASE=http://127.0.0.1:61411 node scripts/ui-contrast.mjs --write-baseline
//
// Environment:
//   BASE             required; host must be loopback (127.0.0.1 / localhost / [::1])
//   ATLAS_UI_EMAIL   default admin@example.com
//   ATLAS_UI_PASSWORD default atlas-dev-2026
//   ATLAS_UI_PAGES   comma separated routes, default matches ui-visual-capture
//   ATLAS_UI_NOW     fixed clock, default 2026-11-17T10:00:00+09:00
//
// Exit codes: 0 = no new violations, 1 = new violations, 2 = setup error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  THEMES,
  auditPage,
  pageEntries,
  waitForPageReady,
} from "../tests/browser/helpers/contrast-audit.mjs";

const DEFAULT_CLOCK = "2026-11-17T10:00:00+09:00";
const BASELINE_PATH = fileURLToPath(new URL("../tests/fixtures/contrast-baseline.json", import.meta.url));

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function fail(message) {
  console.error(`ui-contrast: ${message}`);
  process.exit(2);
}

function readBase() {
  const raw = process.env.BASE?.trim();
  if (!raw) fail("BASE is required (for example BASE=http://127.0.0.1:61411)");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`BASE is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(`BASE must be an http(s) URL: ${raw}`);
  }
  // URL.hostname keeps the brackets for IPv6 literals.
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    fail(`refusing non-loopback BASE host "${url.hostname}" (allowed: 127.0.0.1, localhost, [::1])`);
  }
  if (url.username || url.password) fail("BASE must not contain credentials");
  return raw.replace(/\/+$/, "");
}

function readClock() {
  const raw = process.env.ATLAS_UI_NOW?.trim() || DEFAULT_CLOCK;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) fail(`ATLAS_UI_NOW is not a valid date: ${raw}`);
  return { raw, date };
}

function parseArgs(argv) {
  let mode = "check";
  for (const arg of argv) {
    if (arg === "--check") mode = "check";
    else if (arg === "--write-baseline") mode = "write-baseline";
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: BASE=http://127.0.0.1:<port> node scripts/ui-contrast.mjs [--check|--write-baseline]",
          "",
          "Environment: BASE, ATLAS_UI_EMAIL, ATLAS_UI_PASSWORD, ATLAS_UI_PAGES, ATLAS_UI_NOW",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return mode;
}

async function auditTheme(browser, options) {
  const { base, clock, entries, theme } = options;
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 900 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  const violations = [];
  try {
    const login = await context.request.post("/api/auth/login", {
      data: {
        email: process.env.ATLAS_UI_EMAIL ?? "admin@example.com",
        password: process.env.ATLAS_UI_PASSWORD ?? "atlas-dev-2026",
      },
    });
    if (login.status() !== 200) {
      throw new Error(`login failed with HTTP ${login.status()}: ${(await login.text()).slice(0, 200)}`);
    }
    await context.addCookies([{ name: "atlas_theme", value: theme, url: base }]);
    const page = await context.newPage();
    await page.clock.setFixedTime(clock.date);
    for (const entry of entries) {
      await waitForPageReady(page, `${base}${entry.route}`);
      violations.push(...(await auditPage(page, { pageName: entry.name, theme })));
    }
  } finally {
    await context.close();
  }
  return violations;
}

function summarize(entries, violations) {
  const byPageTheme = {};
  for (const entry of entries) {
    byPageTheme[entry.name] = { light: 0, dark: 0 };
  }
  for (const violation of violations) {
    byPageTheme[violation.page][violation.theme] += 1;
  }
  return { total: violations.length, byPageTheme };
}

async function main() {
  const mode = parseArgs(process.argv.slice(2));
  const base = readBase();
  const clock = readClock();
  const entries = pageEntries(process.env.ATLAS_UI_PAGES);
  for (const entry of entries) {
    if (!entry.route.startsWith("/")) {
      fail(`ATLAS_UI_PAGES entries must be absolute paths: ${entry.route}`);
    }
  }

  if (mode === "check" && !existsSync(BASELINE_PATH)) {
    fail(`baseline not found at ${BASELINE_PATH}; run with --write-baseline first`);
  }

  const browser = await chromium.launch({ headless: true });
  let violations;
  try {
    violations = [];
    for (const theme of THEMES) {
      violations.push(...(await auditTheme(browser, { base, clock, entries, theme })));
    }
  } finally {
    await browser.close();
  }

  const baseline = mode === "check" ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
  const baselineKeys = new Set((baseline?.violations ?? []).map((violation) => violation.key));
  const currentKeys = new Set(violations.map((violation) => violation.key));
  const newViolations = violations.filter((violation) => !baselineKeys.has(violation.key));
  const fixedViolations = (baseline?.violations ?? []).filter((violation) => !currentKeys.has(violation.key));

  const report = {
    tool: "ui-contrast",
    mode,
    base,
    clock: clock.raw,
    themes: THEMES,
    pages: entries,
    summary: summarize(entries, violations),
    baselinePath: BASELINE_PATH,
    newViolations,
    fixedViolations,
    violations,
  };

  if (mode === "write-baseline") {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(
        {
          version: 1,
          tool: "ui-contrast",
          generatedAt: new Date().toISOString(),
          clock: clock.raw,
          violations,
        },
        null,
        2,
      )}\n`,
    );
  }

  console.log(JSON.stringify(report, null, 2));

  if (mode === "check" && newViolations.length > 0) {
    console.error(`ui-contrast: ${newViolations.length} new contrast violation(s) not in the baseline`);
    process.exitCode = 1;
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
