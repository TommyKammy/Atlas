import { expect, test, type Page, type Route } from "@playwright/test";
import { shiftDay } from "../../lib/calendar";
import {
  installMemberLookup, memberLookupRenderCheckpoint, memberLookupState,
  releaseOldMemberLookup, restoreMemberLookup,
} from "./helpers/member-lookup";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

async function createDatedTask(page: Page, name: string, projectId = 1, sectionId = 2) {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  const response = await page.request.post("/api/tasks", {
    data: {
      project_id: projectId,
      section_id: sectionId,
      name,
      start_on: start.toLocaleDateString("en-CA"),
      due_on: end.toLocaleDateString("en-CA"),
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { id: number }).id;
}

async function openWeekTimeline(page: Page, projectId: number) {
  await page.goto(`/projects/${projectId}?view=timeline&zoom=2`);
  // Wait for the client handlers and initial scroll before sampling coordinates.
  const zoom = page.getByRole("button", { name: "ズームレベル: 週" });
  const zoomMenu = page.locator("[data-timeline-zoom-menu]");
  await expect(async () => {
    await zoom.click();
    await expect(zoomMenu).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await zoomMenu.locator('[data-timeline-zoom-option="週"]').click();
  await expect(zoomMenu).toBeHidden();
}

async function openMembershipPicker(page: Page, onAttempt = () => {}) {
  const open = page.getByRole("button", { name: /プロジェクトを追加/ });
  const picker = page.getByRole("combobox", { name: "プロジェクトを選択" });
  // The server-rendered button can precede its client handlers. Check that the
  // idempotent open action took effect before testing lookup ordering.
  await expect(async () => {
    await open.click({ timeout: 1000 });
    onAttempt();
    await expect(picker).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000, intervals: [100, 250, 500] });
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
});

const membershipTest = test.extend<{
  membershipFixture: { create: () => Promise<{ projectId: number; taskId: number }> };
}, {
  membershipProject: { projectId: number; sectionId: number };
}>({
  membershipProject: [async ({ playwright }, useProject, workerInfo) => {
    const baseURL = workerInfo.project.use.baseURL;
    const stack = process.env.ATLAS_E2E_STACK;
    if (!baseURL || baseURL !== process.env.ATLAS_E2E_BASE || !stack) throw new Error("Membership fixture requires the guarded disposable target");
    const api = await playwright.request.newContext({ baseURL });
    try {
      const login = await api.post("/api/auth/login", {
        timeout: 5000, data: { email: EMAIL, password: PASSWORD },
      });
      expect(login.ok()).toBeTruthy();
      const name = `${stack} membership worker ${workerInfo.parallelIndex}`;
      // /api/lookup returns the complete accessible project list. A repeatEach
      // worker may restart, but the same parallel slot can reuse its project.
      const projects = await api.get("/api/lookup", { timeout: 5000 });
      expect(projects.ok()).toBeTruthy();
      let projectId = (await projects.json() as { id: number; name: string }[])
        .find((project) => project.name === name)?.id;
      if (projectId === undefined) {
        const project = await api.post("/api/projects", { timeout: 5000, data: { workspace_id: 1, name } });
        expect(project.status()).toBe(201);
        projectId = (await project.json() as { id: number }).id;
      }
      const sections = await api.get(`/api/lookup?project_id=${projectId}`, { timeout: 5000 });
      expect(sections.ok()).toBeTruthy();
      const [section] = await sections.json() as { id: number }[];
      expect(section).toBeTruthy();
      await useProject({ projectId, sectionId: Number(section.id) });
    } finally {
      // Leave the project to the disposable stack teardown. Deleting it while
      // the automation worker finishes an event can invert the FK lock order.
      await api.dispose();
    }
  }, { scope: "worker", timeout: 15_000 }],
  membershipFixture: [async ({ page, membershipProject }, use, testInfo) => {
    let taskId: number | undefined;
    await use({ create: async () => {
      taskId = await createDatedTask(page, "Membership lookup order", membershipProject.projectId, membershipProject.sectionId);
      return { projectId: membershipProject.projectId, taskId };
    } });
    // Fixture teardown has its own budget; it does not replace a failed test step.
    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
      const screenshot = await page.screenshot({ timeout: 2000 }).catch(() => undefined);
      if (screenshot) await testInfo.attach("membership-before-cleanup", { body: screenshot, contentType: "image/png" });
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await restoreMemberLookup(page);
    if (!page.isClosed()) await page.goto("about:blank", { timeout: 5000 });
    if (taskId !== undefined) {
      const removed = await page.request.delete(`/api/tasks/${taskId}`, { timeout: 5000 });
      expect(removed.status(), "membership fixture trashes only its own task").toBe(200);
      const purged = await page.request.delete(`/api/tasks/${taskId}?force=1`, { timeout: 5000 });
      expect(purged.status(), "membership fixture purges only its own task").toBe(200);
    }
  }, { timeout: 15_000 }],
});

for (const mode of ["respect-abort", "ignore-abort"] as const) {
  membershipTest(`changing membership project ${mode === "respect-abort"
    ? "aborts the superseded section lookup and clears cancelled choices"
    : "ignores late JSON when the transport ignores abort"}`, async ({ page, membershipFixture }) => {
    const { projectId, taskId } = await test.step("create an isolated membership fixture", () => membershipFixture.create(), { timeout: 10_000 });
    await installMemberLookup(page, mode);
    const open = page.getByRole("button", { name: /プロジェクトを追加/ });
    const project = page.getByRole("combobox", { name: "プロジェクトを選択" });
    const section = page.getByRole("combobox", { name: "セクションを選択" });

    await test.step("open the picker and select a current section", async () => {
      await page.goto(`/projects/${projectId}?task=${taskId}`, { timeout: 8000 });
      await openMembershipPicker(page);
      await project.selectOption("9002");
      await expect(section.locator('option[value="9201"]')).toHaveCount(1);
      await section.selectOption("9201");
    }, { timeout: 10_000 });

    await test.step("observe the older request starting and choices clearing", async () => {
      await project.selectOption("9001");
      await expect.poll(async () => (await memberLookupState(page)).oldStarted,
        { timeout: 5000, message: "older section lookup must reach the controlled transport" }).toBe(1);
      await expect(section).toHaveValue("");
      await expect(section.locator("option")).toHaveCount(1);
    }, { timeout: 8000 });

    await test.step("switch back and observe cancellation of the superseded request", async () => {
      await project.selectOption("9002");
      await expect.poll(async () => (await memberLookupState(page)).oldAborted,
        { timeout: 5000, message: "changing projects must abort the older section lookup" }).toBe(1);
      await expect.poll(async () => (await memberLookupState(page)).currentJSONRead,
        { timeout: 5000, message: "the latest section response must be consumed" }).toBe(2);
      await expect(section.locator('option[value="9201"]')).toHaveCount(1);
      await section.selectOption("9201");
    }, { timeout: 8000 });

    await test.step(mode === "respect-abort" ? "release the cancelled transport without consuming its JSON" : "consume the late JSON and retain the latest project choices", async () => {
      await releaseOldMemberLookup(page);
      if (mode === "ignore-abort") {
        await expect.poll(async () => (await memberLookupState(page)).oldJSONRead,
          { timeout: 5000, message: "late older JSON must be consumed before checking stale-state protection" }).toBe(1);
      }
      await memberLookupRenderCheckpoint(page);
      expect((await memberLookupState(page)).oldJSONRead).toBe(mode === "ignore-abort" ? 1 : 0);
      await expect(project).toHaveValue("9002");
      await expect(section).toHaveValue("9201");
      await expect(section.locator('option[value="9101"]')).toHaveCount(0);
      await expect(section.locator('option[value="9201"]')).toHaveCount(1);
    }, { timeout: 8000 });

    await test.step("cancel and reopen with no stale selection", async () => {
      await page.getByRole("button", { name: "キャンセル", exact: true }).click();
      await open.click();
      await expect(project).toHaveValue("");
      await expect(section).toHaveCount(0);
    }, { timeout: 8000 });
  });
}

membershipTest("membership picker waits for client handlers when scripts are delayed", async ({ page, membershipFixture }) => {
  const { projectId, taskId } = await membershipFixture.create();
  await installMemberLookup(page, "respect-abort");
  let releaseScripts = () => {};
  const scriptsReleased = new Promise<void>((resolve) => { releaseScripts = resolve; });
  let pendingScripts = 0;
  const holdScript = async (route: Route) => {
    pendingScripts++;
    await scriptsReleased;
    await route.continue();
  };
  await page.route("**/_next/static/chunks/*.js*", holdScript);
  try {
    await test.step("render the picker button while client scripts are held", async () => {
      await page.goto(`/projects/${projectId}?task=${taskId}`, { waitUntil: "commit", timeout: 8000 });
      await expect(page.getByRole("button", { name: /プロジェクトを追加/ })).toBeVisible();
      await expect.poll(() => pendingScripts, { timeout: 5000 }).toBeGreaterThan(0);
    }, { timeout: 10_000 });
    await test.step("wait for the open action to take effect after hydration", async () => {
      let attempts = 0;
      await Promise.all([
        openMembershipPicker(page, () => { attempts++; }),
        (async () => {
          // Observe the initial SSR click before any client handler can load.
          await expect.poll(() => attempts, { timeout: 5000 }).toBeGreaterThan(0);
          await expect(page.getByRole("combobox", { name: "プロジェクトを選択" })).toHaveCount(0);
          releaseScripts();
        })(),
      ]);
      expect(attempts).toBeGreaterThan(1);
      await page.getByRole("combobox", { name: "プロジェクトを選択" }).selectOption("9002");
      await expect(page.getByRole("combobox", { name: "セクションを選択" }).locator('option[value="9201"]')).toHaveCount(1);
    }, { timeout: 8000 });
  } finally {
    releaseScripts();
  }
});

for (const reason of ["pointercancel", "lostpointercapture"] as const) {
  test(`timeline resize ${reason} restores the preview and permits the next drag`, async ({ page }) => {
    const project = await page.request.post("/api/projects", {
      data: { workspace_id: 1, name: `Timeline resize ${reason}` },
    });
    expect(project.ok()).toBeTruthy();
    const projectId = (await project.json() as { id: number }).id;
    try {
      const sections = await page.request.get(`/api/lookup?project_id=${projectId}`);
      expect(sections.ok()).toBeTruthy();
      const [section] = await sections.json() as { id: number }[];
      const id = await createDatedTask(page, `Timeline resize ${reason}`, projectId, Number(section.id));
      await openWeekTimeline(page, projectId);
      const row = page.locator(`[data-timeline-row="${id}"]`);
      const bar = row.locator("[data-timeline-bar]");
      const start = row.locator('[data-timeline-handle="start"]');
      const end = row.locator('[data-timeline-handle="end"]');
      await start.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
      await expect(start).toBeInViewport();
      const before = await bar.evaluate((element) => (element as HTMLElement).style.left);
      const fixedEdge = await end.evaluate((element) => (element as HTMLElement).style.left);
      await row.evaluate((element) => {
        element.addEventListener("pointerdown", (event) => {
          (element as HTMLElement).dataset.testPointerId = String((event as PointerEvent).pointerId);
        }, { capture: true, once: true });
      });
      const handle = await start.boundingBox();
      expect(handle).not.toBeNull();
      const x = handle!.x + handle!.width / 2;
      // The completion toggle appears on hover over the center of the start grip.
      const y = handle!.y + 5;
      let patches = 0;
      await page.route(`**/api/tasks/${id}`, async (route) => {
        if (route.request().method() === "PATCH") patches++;
        await route.continue();
      });
      await page.mouse.move(x, y);
      await expect.poll(() => page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest(".tl-bar")
          ?.closest("[data-timeline-row]")?.getAttribute("data-timeline-row"),
      { x, y })).toBe(String(id));
      await page.mouse.down();
      await page.mouse.move(x + 24, y, { steps: 4 });
      await expect(bar).toHaveClass(/shadow-lg/);
      await expect.poll(() => bar.evaluate((element) => (element as HTMLElement).style.left))
        .not.toBe(before);
      await expect.poll(() => end.evaluate((element) => (element as HTMLElement).style.left))
        .toBe(fixedEdge);
      const pointerId = Number(await row.getAttribute("data-test-pointer-id"));
      expect(pointerId).toBeGreaterThan(0);
      const owner = await row.evaluateHandle((element, pointer) =>
        [...element.querySelectorAll(".tl-bar")].find((bar) => bar.hasPointerCapture(pointer)), pointerId);
      const captureTarget = owner.asElement();
      expect(captureTarget).not.toBeNull();
      if (reason === "pointercancel") {
        await captureTarget!.dispatchEvent(reason, { pointerId, pointerType: "mouse", isPrimary: true });
      } else {
        await captureTarget!.evaluate((element, pointer) => element.releasePointerCapture(pointer), pointerId);
        // A subsequent native event flushes pending capture changes.
        await page.mouse.move(x + 25, y);
      }
      await expect(bar).not.toHaveClass(/shadow-lg/);
      await expect.poll(() => bar.evaluate((element) => (element as HTMLElement).style.left))
        .toBe(before);
      await page.mouse.up();
      expect(patches).toBe(0);

      const retry = await start.boundingBox();
      expect(retry).not.toBeNull();
      const retryX = retry!.x + retry!.width / 2;
      const retryY = retry!.y + 5;
      const committed = page.waitForResponse((response) =>
        response.url().endsWith(`/api/tasks/${id}`) && response.request().method() === "PATCH",
        { timeout: 5000 });
      await page.mouse.move(retryX, retryY);
      await page.mouse.down();
      await page.mouse.move(retryX - 24, retryY, { steps: 4 });
      await expect(bar).toHaveClass(/shadow-lg/);
      await page.mouse.up();
      expect((await committed).ok()).toBeTruthy();
      expect(patches).toBe(1);
    } finally {
      const removed = await page.request.delete(`/api/projects/${projectId}`);
      expect(removed.ok()).toBeTruthy();
    }
  });
}

test("R20 timeline resize follows horizontal scrolling during pointer capture", async ({ page }) => {
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: "Timeline resize while scrolling" },
  });
  expect(project.ok()).toBeTruthy();
  const projectId = (await project.json() as { id: number }).id;
  try {
    const sections = await page.request.get(`/api/lookup?project_id=${projectId}`);
    expect(sections.ok()).toBeTruthy();
    const [section] = await sections.json() as { id: number }[];
    const startDate = new Date().toLocaleDateString("en-CA");
    const dueDate = shiftDay(startDate, 3);
    const created = await page.request.post("/api/tasks", {
      data: {
        project_id: projectId, section_id: Number(section.id), name: "Scroll resize",
        start_on: startDate, due_on: dueDate,
      },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json() as { id: number };
    await openWeekTimeline(page, projectId);

    const row = page.locator(`[data-timeline-row="${id}"]`);
    const bar = row.locator("[data-timeline-bar]");
    const handle = row.locator('[data-timeline-handle="end"]');
    const canvas = page.locator("[data-timeline-canvas]");
    const scroller = page.locator(".timeline-scroll");
    await handle.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
    await expect(handle).toBeInViewport();
    const dayWidth = Number(await canvas.getAttribute("data-timeline-day-width"));
    const rightEdge = () => bar.evaluate((element) => element.getBoundingClientRect().right);
    const scrollLeft = () => scroller.evaluate((element) => element.scrollLeft);
    const initialRight = await rightEdge();
    const initialScroll = await scrollLeft();
    const grip = await handle.boundingBox();
    expect(grip).not.toBeNull();
    const x = grip!.x + grip!.width / 2;
    const y = grip!.y + 5;
    await page.mouse.move(x, y);
    await expect.poll(() => page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.closest(".tl-bar")
        ?.closest("[data-timeline-row]")?.getAttribute("data-timeline-row"),
    { x, y })).toBe(String(id));
    await page.mouse.down();
    await page.mouse.move(x + dayWidth, y, { steps: 3 });
    await expect(bar).toHaveClass(/shadow-lg/);
    const beforeWheel = await scrollLeft();
    await page.mouse.wheel(dayWidth * 2, 0);
    await expect.poll(scrollLeft).toBeGreaterThanOrEqual(beforeWheel + dayWidth);
    await expect.poll(async () => (await rightEdge()) - initialRight).toBeCloseTo(dayWidth, 0);

    const expectedDays = Math.round((dayWidth + await scrollLeft() - initialScroll) / dayWidth);
    expect(expectedDays).toBeGreaterThan(1);
    const committed = page.waitForResponse((response) =>
      response.url().endsWith(`/api/tasks/${id}`) && response.request().method() === "PATCH",
      { timeout: 5000 });
    await page.mouse.up();
    const response = await committed;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({ due_on: shiftDay(dueDate, expectedDays) });
  } finally {
    const removed = await page.request.delete(`/api/projects/${projectId}`);
    expect(removed.ok()).toBeTruthy();
  }
});
