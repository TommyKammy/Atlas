import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchOptions } from "./search-types";

test("task suggestions lead with their issue key when they have one", () => {
  const options = buildSearchOptions({
    history: [],
    groups: {
      tasks: [
        { id: 7, name: "Fix login", project_id: 3, project_name: "Atlas", key: "ATL-7" },
        { id: 8, name: "Plain task", project_id: 4, project_name: "Ops", key: null },
        { id: 9, name: "Older client", project_id: 4, project_name: "Ops" },
      ],
    },
  }, "atl-7");
  assert.deepEqual(options.map((option) => option.label), ["ATL-7 Fix login", "Plain task", "Older client"]);
  assert.equal(options[0].href, "/projects/3?view=list&task=7");
});
