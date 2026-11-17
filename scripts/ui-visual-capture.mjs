#!/usr/bin/env node
// Deterministic light/dark screenshots for the disposable Atlas instance.
//
// Usage:
//   BASE=http://127.0.0.1:61411 node scripts/ui-visual-capture.mjs /tmp/atlas-ui-a
//
// Environment:
//   BASE             required; host must be loopback (127.0.0.1 / localhost / [::1])
//   ATLAS_UI_EMAIL   default admin@example.com
//   ATLAS_UI_PASSWORD default atlas-dev-2026
//   ATLAS_UI_PAGES   comma separated routes, default:
//                    /, /my-tasks, /inbox, /projects/1?view=list|board|timeline,
//                    /portfolio, /search?q=要件, /admin, /trash
//   ATLAS_UI_NOW     fixed clock, default 2026-11-17T10:00:00+09:00
//
// Files are written as <page-name>-<theme>.png.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import {
  THEMES,
  pageEntries,
  waitForPageReady,
} from "../tests/browser/helpers/contrast-audit.mjs";

const DEFAULT_CLOCK = "2026-11-17T10:00:00+09:00";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function fail(message) {
  console.error(`ui-visual-capture: ${message}`);
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
  return date;
}

async function main() {
  const outputDir = process.argv[2];
  if (!outputDir) fail("usage: BASE=http://127.0.0.1:<port> node scripts/ui-visual-capture.mjs <output-dir>");
  if (process.argv.length > 3) fail(`unexpected argument: ${process.argv[3]}`);

  const base = readBase();
  const clock = readClock();
  const entries = pageEntries(process.env.ATLAS_UI_PAGES);
  const baseUrl = new URL(base);
  for (const entry of entries) {
    if (!entry.route.startsWith("/")) fail(`ATLAS_UI_PAGES entries must be absolute paths: ${entry.route}`);
    if (new URL(entry.route, base).origin !== baseUrl.origin) {
      fail(`page route escapes BASE: ${entry.route}`);
    }
  }
  mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const written = [];
  try {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        baseURL: base,
        viewport: { width: 1440, height: 900 },
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
        reducedMotion: "reduce",
        colorScheme: theme,
      });
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
        await page.clock.setFixedTime(clock);
        for (const entry of entries) {
          const file = `${entry.name}-${theme}.png`;
          await waitForPageReady(page, `${base}${entry.route}`);
          await page.screenshot({
            path: join(outputDir, file),
            fullPage: true,
            animations: "disabled",
            caret: "hide",
          });
          written.push(file);
          console.log(`captured ${file}`);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${written.length} screenshots written to ${outputDir} (${entries.length} pages x ${THEMES.length} themes)`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
