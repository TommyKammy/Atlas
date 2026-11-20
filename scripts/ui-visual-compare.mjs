#!/usr/bin/env node
// Pixel comparison for screenshots produced by ui-visual-capture.mjs.
//
// Usage:
//   node scripts/ui-visual-compare.mjs <base-dir> <candidate-dir> [diff-dir]
//
// Environment:
//   ATLAS_UI_DIFF_RATIO       failure threshold as a ratio, default 0.005 (0.5%)
//   ATLAS_UI_PIXEL_TOLERANCE  per-channel tolerance 0-255, default 0 (exact)
//
// Exit codes: 0 = every file within threshold, 1 = differences above threshold
// or missing/mismatched files, 2 = setup error.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

function fail(message) {
  console.error(`ui-visual-compare: ${message}`);
  process.exit(2);
}

function readNumber(name, fallback, { min, max, integer = false }) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(`${name} must be a ${integer ? "integer" : "number"} between ${min} and ${max}: ${raw}`);
  }
  return value;
}

function pngNames(dir) {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

function assertDirectory(dir, label) {
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    fail(`${label} directory does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) fail(`${label} is not a directory: ${dir}`);
}

// Runs inside Chromium. Kept self-contained for Playwright serialization.
async function compareInPage({ baseUrl, candidateUrl, tolerance }) {
  const load = (src) =>
    new Promise((resolveImage, rejectImage) => {
      const image = new Image();
      image.onload = () => resolveImage(image);
      image.onerror = () => rejectImage(new Error("image decode failed"));
      image.src = src;
    });
  const [left, right] = await Promise.all([load(baseUrl), load(candidateUrl)]);
  if (
    left.naturalWidth !== right.naturalWidth ||
    left.naturalHeight !== right.naturalHeight
  ) {
    return {
      dimensionMismatch: true,
      base: { width: left.naturalWidth, height: left.naturalHeight },
      candidate: { width: right.naturalWidth, height: right.naturalHeight },
    };
  }

  const width = left.naturalWidth;
  const height = left.naturalHeight;
  const pixels = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d canvas is unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  };
  const base = pixels(left);
  const candidate = pixels(right);
  const a = base.data;
  const b = candidate.data;
  const diff = new Uint8ClampedArray(a.length);
  let diffPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
    );
    if (delta > tolerance) {
      diffPixels += 1;
      diff[i] = 255;
      diff[i + 1] = 0;
      diff[i + 2] = 0;
      diff[i + 3] = 255;
    } else {
      // Wash the unchanged pixels out so red differences stand out.
      const gray = (a[i] + a[i + 1] + a[i + 2]) / 3;
      const value = Math.round(255 - (255 - gray) * 0.25);
      diff[i] = value;
      diff[i + 1] = value;
      diff[i + 2] = value;
      diff[i + 3] = 255;
    }
  }

  const diffCanvas = document.createElement("canvas");
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffContext = diffCanvas.getContext("2d");
  if (!diffContext) throw new Error("2d canvas is unavailable");
  diffContext.putImageData(new ImageData(diff, width, height), 0, 0);

  return {
    dimensionMismatch: false,
    width,
    height,
    totalPixels: width * height,
    diffPixels,
    diffUrl: diffCanvas.toDataURL("image/png"),
  };
}

async function main() {
  const [baseDir, candidateDir, diffDir, ...rest] = process.argv.slice(2);
  if (!baseDir || !candidateDir) {
    fail("usage: node scripts/ui-visual-compare.mjs <base-dir> <candidate-dir> [diff-dir]");
  }
  if (rest.length > 0) fail(`unexpected argument: ${rest[0]}`);

  const ratioLimit = readNumber("ATLAS_UI_DIFF_RATIO", 0.005, { min: 0, max: 1 });
  const tolerance = readNumber("ATLAS_UI_PIXEL_TOLERANCE", 0, { min: 0, max: 255, integer: true });

  assertDirectory(baseDir, "base");
  assertDirectory(candidateDir, "candidate");
  if (diffDir) {
    if (resolve(diffDir) === resolve(baseDir) || resolve(diffDir) === resolve(candidateDir)) {
      fail("diff directory must differ from the base and candidate directories");
    }
    mkdirSync(diffDir, { recursive: true });
  }

  const baseNames = new Set(pngNames(baseDir));
  const candidateNames = new Set(pngNames(candidateDir));
  const names = [...new Set([...baseNames, ...candidateNames])].sort((a, b) => a.localeCompare(b, "en"));
  if (names.length === 0) fail("no PNG files found in either directory");

  const browser = await chromium.launch({ headless: true });
  let matched = 0;
  let different = 0;
  let failed = 0;
  try {
    const page = await browser.newPage();
    for (const name of names) {
      if (!baseNames.has(name) || !candidateNames.has(name)) {
        const side = baseNames.has(name) ? "candidate" : "base";
        console.log(`MISSING  ${name}  (only in ${side})`);
        failed += 1;
        continue;
      }
      const baseData = readFileSync(join(baseDir, name));
      const candidateData = readFileSync(join(candidateDir, name));
      const result = await page.evaluate(compareInPage, {
        baseUrl: `data:image/png;base64,${baseData.toString("base64")}`,
        candidateUrl: `data:image/png;base64,${candidateData.toString("base64")}`,
        tolerance,
      });

      if (result.dimensionMismatch) {
        console.log(
          `SIZE     ${name}  base ${result.base.width}x${result.base.height}, candidate ${result.candidate.width}x${result.candidate.height}`,
        );
        failed += 1;
        continue;
      }

      const ratio = result.totalPixels === 0 ? 0 : result.diffPixels / result.totalPixels;
      const percent = (ratio * 100).toFixed(4);
      if (result.diffPixels === 0) {
        matched += 1;
        console.log(`一致    ${name}  0 / ${result.totalPixels} px (0.0000%)`);
      } else {
        different += 1;
        const over = ratio > ratioLimit;
        if (over) failed += 1;
        console.log(
          `${over ? "FAIL" : "差分"}    ${name}  ${result.diffPixels} / ${result.totalPixels} px (${percent}%)`,
        );
      }
      if (diffDir) {
        const encoded = result.diffUrl.slice(result.diffUrl.indexOf(",") + 1);
        writeFileSync(join(diffDir, name), Buffer.from(encoded, "base64"));
      }
    }
  } finally {
    await browser.close();
  }

  const limitPercent = (ratioLimit * 100).toFixed(3);
  console.log(
    `${names.length} files: ${matched} matched, ${different} different, ${failed} failed (threshold ${limitPercent}%, pixel tolerance ${tolerance})`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
