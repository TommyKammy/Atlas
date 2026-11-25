import { expect, test, type APIRequestContext } from "@playwright/test";
import type { DashboardWidget } from "../../lib/dashboard-types";

async function createDashboard(request: APIRequestContext) {
  const response = await request.post("/api/projects", { data: { workspace_id: 1, name: "Widget order " + crypto.randomUUID() } });
  expect(response.status(), await response.text()).toBe(201);
  const { id } = await response.json() as { id: number };
  return `/api/projects/${id}/dashboard/widgets`;
}

async function readWidgets(request: APIRequestContext, path: string): Promise<DashboardWidget[]> {
  const response = await request.get(path);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).widgets;
}

test("widget reorder ranks distinct owned IDs only and preserves omitted widgets", async ({ request }) => {
  const login = await request.post("/api/auth/login", {
    data: { email: "admin@example.com", password: "atlas-dev-2026" },
  });
  expect(login.status()).toBe(200);
  const path = await createDashboard(request);
  const otherPath = await createDashboard(request);
  const before = await readWidgets(request, path);
  const other = await readWidgets(request, otherPath);
  const [omitted, second, third] = before;
  const order = [other[0].id, third.id, third.id, 1e30, second.id];
  const patch = await request.patch(path, { data: { order } });
  expect(patch.status(), await patch.text()).toBe(200);
  const { widgets } = await patch.json() as { widgets: DashboardWidget[] };

  // Omitted keeps rank 1000; its smaller ID wins the resulting tie.
  expect(widgets.map(w => [w.id, w.position])).toEqual([
    [omitted.id, 1000], [third.id, 1000], [second.id, 2000],
    ...before.slice(3).map(w => [w.id, w.position]),
  ]);
  expect(widgets.filter(w => w.id !== second.id && w.id !== third.id))
    .toEqual(before.filter(w => w.id !== second.id && w.id !== third.id));
  const [, moved, sameRank] = widgets;
  expect(moved.updated_at).not.toBe(third.updated_at);
  expect(sameRank.updated_at).not.toBe(second.updated_at);
  expect(moved.updated_at).toBe(sameRank.updated_at);
  expect(await readWidgets(request, path)).toEqual(widgets);
  expect(await readWidgets(request, otherPath)).toEqual(other);

  for (const ignored of [[], [other[0].id, 0, -1, 0.5, 1e30]]) {
    const unchanged = await request.patch(path, { data: { order: ignored } });
    expect(unchanged.status()).toBe(200);
    expect(await unchanged.json()).toEqual({ widgets });
  }
});
