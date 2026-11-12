# Sidebar project ordering

The sidebar's **Projects** section has direct name dragging, the same before/after insertion line, edge scrolling, touch support and Alt+Up/Down keyboard movement as knowledge notes. Escape, pointer cancellation, window blur or dropping outside the list cancels the drag. Clicking a name opens the project; moving it more than five pixels starts a drag and suppresses the resulting click. Modifier clicks and context menus retain their normal behavior. The recent-project and favorites sections retain their existing behavior and cannot be manually reordered.

Order is personal to the signed-in user, within each workspace. Viewers can arrange projects they can see without needing permission to modify a project. Opening or renaming a project does not change its place. Projects without a saved preference are appended in ID order. Archived/deleted/inaccessible projects are omitted. Restored projects retain their stored preference when available.

Migration `0023_sidebar_project_order.sql` adds only `user_sidebar_project_order`, with foreign keys cascading on actual user/project deletion. It does not rewrite projects, tasks, notes, favorites or recent-open timestamps. With no preferences, the existing ID order is preserved. Apply migrations before running the new app.

`GET /api/sidebar/projects/order?workspace_id=...` returns the caller's visible project IDs in order. `POST` accepts `workspace_id`, `project_id`, `target_id`, and `placement` (`before` / `after`). The session supplies the user ID; clients cannot edit another user's preferences. Both projects must be active, visible and in the given workspace. Per-user transaction locking serializes relative moves from concurrent tabs. Only preference rows are written, with no project update notifications or content revisions.

The client updates immediately, saves the relative move and refreshes server-rendered navigation. Failures restore the previous order and display an inline error. Current project metadata is reconciled by ID so new names, additions and removals survive ordering changes. The existing project queries for search and other surfaces are unchanged.

`lib/use-list-reorder.ts` shares pointer and keyboard behavior between notes and sidebar projects. The sidebar uses its existing outer scroll container; hit-testing excludes sections above Projects and accepts its trailing padding as the last insertion position. `lib/list-order.ts` supplies relative ordering and metadata reconciliation.

Validation: `npm test`, `npm run typecheck`, `npm run lint`; `bash tests/run-e2e.sh sidebar` runs sidebar and project-order browser tests in a new disposable stack. Because the drag hook is shared, also run `bash tests/run-e2e.sh knowledge` for the note regressions. Never use established application/database environments as browser test targets.

Touch dragging starts on the name text. Other row areas retain native touch scrolling. Names also support Alt+Up/Down when focused; no separate grip button is displayed.
