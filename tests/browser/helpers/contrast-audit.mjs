// Shared contrast audit used by:
//   - tests/browser/ui-contrast.spec.ts
//   - scripts/ui-contrast.mjs
//   - scripts/ui-visual-capture.mjs (page list and page names only)
//
// The logic is ported from tests/contrast-audit.mjs. The original file is kept
// until the migration decides whether it can be replaced.
//
// Keep `collectContrastViolations` self-contained: Playwright serializes the
// function and runs it inside the page, so it must not reference imports or
// module-level bindings.

/**
 * @typedef {"light" | "dark"} AtlasTheme
 *
 * @typedef {object} ContrastViolation
 * @property {string} key Stable identity: page | theme | fg | bg | fontSize | fontWeight
 * @property {string} page
 * @property {AtlasTheme} theme
 * @property {string} fg Effective foreground color as rgb()/rgba()
 * @property {string} bg Effective background color as rgb()
 * @property {number} fontSize CSS pixels
 * @property {number} fontWeight
 * @property {number} threshold WCAG threshold that applies to this text
 * @property {number} ratio Computed contrast ratio, rounded to 2 decimals
 * @property {string} sample First 60 characters of the element's text
 * @property {string} selector Short element path for debugging
 */

/** Default pages captured and audited in both themes. */
export const DEFAULT_PAGES = Object.freeze([
  "/",
  "/my-tasks",
  "/inbox",
  "/projects/1?view=list",
  "/projects/1?view=board",
  "/projects/1?view=timeline",
  "/portfolio",
  "/search?q=要件",
  "/admin",
  "/trash",
]);

/** Supported themes, in capture/audit order. */
export const THEMES = Object.freeze(/** @type {AtlasTheme[]} */ (["light", "dark"]));

/**
 * Stable, filesystem-safe name for a page. Query parameters other than
 * `view` are intentionally ignored so the name is stable across search terms.
 *
 * @param {string} route
 * @returns {string}
 */
export function pageSlug(route) {
  const url = new URL(route, "http://atlas.local");
  const path = url.pathname === "/" ? "home" : url.pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  const view = url.searchParams.get("view");
  const slug = view ? `${path}-${view}` : path;
  return slug.replace(/[^a-zA-Z0-9._-]+/g, "-") || "page";
}

/**
 * Resolve routes from ATLAS_UI_PAGES (comma separated) or DEFAULT_PAGES and
 * assign unique page names. Duplicate names get a `-2`, `-3`, ... suffix.
 *
 * @param {string | undefined} [rawPages]
 * @returns {{ name: string, route: string }[]}
 */
export function pageEntries(rawPages) {
  const routes = rawPages
    ? rawPages.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [...DEFAULT_PAGES];
  const used = new Map();
  return routes.map((route) => {
    const base = pageSlug(route);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return { name: count === 1 ? base : `${base}-${count}`, route };
  });
}

/**
 * In-page audit. Returns one entry per distinct (fg, bg, font size, weight)
 * combination whose contrast is below the WCAG AA threshold.
 *
 * @returns {{ fg: string, bg: string, fontSize: number, fontWeight: number, threshold: number, ratio: number, sample: string, selector: string }[]}
 */
export function collectContrastViolations() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("contrast audit: 2d canvas is unavailable");

  const toRgba = (color) => {
    if (!color || color === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0)";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = (el) => {
    let cur = el;
    const stack = [];
    while (cur) {
      const p = toRgba(getComputedStyle(cur).backgroundColor);
      if (p.a > 0) stack.push(p);
      cur = cur.parentElement;
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
    return bg;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0;
  };
  const color = (c) => {
    const r = Math.round(c.r);
    const g = Math.round(c.g);
    const b = Math.round(c.b);
    const a = Math.round(c.a * 1000) / 1000;
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  const selectorOf = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 4) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) part += `#${cur.id}`;
      else if (cur.classList.length > 0) part += `.${[...cur.classList].slice(0, 2).join(".")}`;
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  const seen = new Set();
  const fails = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0)) continue;
    const text = (el.innerText || "").trim();
    if (!text) continue;
    const s = getComputedStyle(el);
    const rawFg = toRgba(s.color);
    if (rawFg.a === 0) continue;
    const bg = bgOf(el);
    const fg = rawFg.a < 1 ? blend(rawFg, bg) : rawFg;
    const size = Math.round(parseFloat(s.fontSize) * 100) / 100;
    const weight = Number(s.fontWeight) || 400;
    const threshold = size >= 18 || (size >= 14 && weight >= 700) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    const fgText = color(fg);
    const bgText = color(bg);
    if (cr + 0.01 < threshold) {
      const key = `${fgText}|${bgText}|${size}|${weight}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fails.push({
        fg: fgText,
        bg: bgText,
        fontSize: size,
        fontWeight: weight,
        threshold,
        ratio: Math.round(cr * 100) / 100,
        sample: text.replace(/\s+/g, " ").slice(0, 60),
        selector: selectorOf(el),
      });
    }
  }
  return fails;
}

/**
 * Identity key for a violation. Text is deliberately excluded: copy changes
 * far more often than colors, and a changed sentence must not look like a new
 * contrast regression.
 *
 * @param {Pick<ContrastViolation, "page" | "theme" | "fg" | "bg" | "fontSize" | "fontWeight">} violation
 * @returns {string}
 */
export function violationKey(violation) {
  return [
    violation.page,
    violation.theme,
    violation.fg,
    violation.bg,
    violation.fontSize,
    violation.fontWeight,
  ].join(" | ");
}

/**
 * Run the in-page audit and tag the results with page name and theme.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ pageName: string, theme: AtlasTheme }} options
 * @returns {Promise<ContrastViolation[]>}
 */
export async function auditPage(page, options) {
  const raw = await page.evaluate(collectContrastViolations);
  return raw
    .map((violation) => {
      const entry = { ...violation, page: options.pageName, theme: options.theme };
      return { ...entry, key: violationKey(entry) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Load the page and wait until it is stable enough to screenshot and audit.
 * Websockets and background polling can keep the network busy forever, so
 * networkidle is best-effort and followed by a short settle.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function waitForPageReady(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(250);
}
