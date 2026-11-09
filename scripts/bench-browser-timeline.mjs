import { chromium } from "@playwright/test";
import { Pool } from "pg";

/**
 * Real-browser timeline benchmark against the running app.
 * Usage: npm run bench:browser
 *
 * Creates a disposable project with 1,000 tasks, measures the initial timeline
 * render, then removes the project.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://atlas:atlas@127.0.0.1:5433/atlas";
const TASKS = Number(process.env.BENCH_TASKS ?? 1000);
const SECTIONS = 10;

const pool = new Pool({ connectionString: DATABASE_URL });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ baseURL: BASE });
let projectId = null;

try {
  const login = await page.request.post("/api/auth/login", {
    data: { email: "admin@example.com", password: "atlas-dev-2026" },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

  const created = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `E2E perf ${Date.now()}` },
  });
  if (!created.ok()) throw new Error(`project create failed: ${created.status()}`);
  projectId = (await created.json()).id;

  const sectionIds = [];
  for (let i = 0; i < SECTIONS; i += 1) {
    const section = await pool.query(
      "INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3) RETURNING id",
      [projectId, `Perf section ${i + 1}`, i * 1000],
    );
    sectionIds.push(Number(section.rows[0].id));
  }

  const perSection = Math.ceil(TASKS / SECTIONS);
  const names = Array.from({ length: TASKS }, (_, i) => `Perf task ${i + 1}`);
  const sectionValues = Array.from(
    { length: TASKS },
    (_, i) => sectionIds[Math.min(sectionIds.length - 1, Math.floor(i / perSection))],
  );
  const starts = Array.from({ length: TASKS }, (_, i) => i % 120);
  const durations = Array.from({ length: TASKS }, (_, i) => (i % 7 === 0 ? 5 : 1));
  await pool.query(
    `INSERT INTO tasks (
       project_id, section_id, name, created_by, completed, start_on, due_on,
       progress, status, recurrence, is_milestone, position
     )
     SELECT $1::bigint, s.section_id, s.name, 1, FALSE,
       CURRENT_DATE + s.start_offset, CURRENT_DATE + s.start_offset + s.duration,
       0, 'inbox', 'none', FALSE, s.position
     FROM unnest($2::bigint[], $3::text[], $4::int[], $5::int[], $6::int[])
       AS s(section_id, name, start_offset, duration, position)`,
    [
      projectId,
      sectionValues,
      names,
      starts,
      durations,
      Array.from({ length: TASKS }, (_, i) => i * 1000),
    ],
  );

  const started = Date.now();
  await page.goto(`/projects/${projectId}?view=timeline&zoom=2`, {
    waitUntil: "networkidle",
  });
  await page.locator('[data-timeline-bar]').first().waitFor({ state: "visible" });
  const firstBarMs = Date.now() - started;
  const bars = await page.locator("[data-timeline-bar]").count();
  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry
      ? {
          dom_content_loaded_ms: Math.round(entry.domContentLoadedEventEnd),
          load_ms: Math.round(entry.loadEventEnd),
        }
      : null;
  });

  const zoomStarted = Date.now();
  await page.locator("[data-timeline-zoom-in]").click();
  await page.waitForTimeout(500);
  const zoomMs = Date.now() - zoomStarted;

  console.log(
    JSON.stringify(
      {
        tasks: TASKS,
        sections: SECTIONS,
        rendered_bars: bars,
        first_bar_ms: firstBarMs,
        zoom_click_ms: zoomMs,
        navigation: nav,
      },
      null,
      2,
    ),
  );
} finally {
  if (projectId !== null) {
    await pool.query("DELETE FROM projects WHERE id = $1::bigint", [projectId]).catch(() => undefined);
  }
  await browser.close();
  await pool.end();
}
