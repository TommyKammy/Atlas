# Knowledge editor

The knowledge view uses the existing Tiptap editor with knowledge-only table, HTTPS image and block movement extensions. Task descriptions and comments retain their original document schema.

## Features

- Note list, server-side title/body search, pagination and direct note links.
- Slash commands, headings, lists, checklists, quotes, code, formatting and undo.
- Tables with row/column operations; HTTPS image URLs with alt text and no-referrer rendering.
- Top-level block movement using buttons or Alt+Up/Down.
- Blank, meeting notes and procedure templates.
- Debounced autosave with explicit save, status and retry; changes typed during a request are saved in order.
- Version conflict rejection; original contents archived transactionally before each update.
- The initial version and last 50 history entries available for restoration; restoration archives the current version too.
- Markdown export and lossless JSON draft export on errors.
- Per-user, per-project drafts in the current browser tab's sessionStorage for reload recovery. Successful saves clear them; private browsing/quota failures fall back to the in-memory draft and unload warning.
- Read-only roles have no editing controls, with server authorization on all endpoints.

## Preservation and rollout

Migration `0021_knowledge_documents.sql` only adds columns, an index and a revision table. It does not rewrite existing titles, Markdown bodies or timestamps. Existing Markdown is rendered as before and converted on demand. Opening and closing the editor does not save. A title-only change leaves the original body untouched. The first body edit archives the exact original Markdown before saving structured JSON.

Rich documents are authoritative in `body_doc`. `body` is a Markdown projection for search/export. Rich formatting and table details need not round-trip through Markdown; the JSON document and revision snapshots retain the original structure. The existing Markdown importer supports a subset of Markdown, so users should inspect complex legacy documents when editing; their exact original remains in history.

Rich updates and restoration require `expected_revision`. A mismatch returns 409 without changing content. The pre-existing legacy string API remains available for legacy documents; it cannot overwrite a rich document without a matching revision. `create_key` makes retried creations idempotent. A lost create response followed by newer typing is handled by saving that typing after the original creation is recovered.

Updates are serialized by a row lock in a transaction that includes the old-version archive. Revision history is stored until the note is deleted; the UI displays the initial version and latest 50 entries. Capacity/retention policies should be chosen before broad rollout, especially for large documents with frequent autosaves.

## Validation

Run `npm test`, `npm run typecheck`, and ESLint on the changed source files. Run `bash tests/run-e2e.sh knowledge` for a newly generated disposable PostgreSQL/Redis/application stack. This command checks the existing isolation guards, executes knowledge browser regressions, and removes only its own labeled stack on exit. Never point the browser suite at an established environment.

Browser coverage includes preservation, migration to rich text and restoration, tables/images, block movement/undo, save failure, concurrent changes, edits during save, viewer/outsider authorization, invalid documents, idempotent creation, Japanese IME confirmation, recovery after reload, old-note search/direct links, and desktop/tablet/mobile layouts. The shared task-description failure and in-flight edit tests are also run during review.

## Boundaries

This is version-checked autosave, not live collaborative editing. Images currently use external HTTPS URLs, not uploaded attachments. Block movement operates on top-level blocks; a nested list moves as one block. Existing task links can be inserted through the link control; structured task creation/backlinks, arbitrary embeds and a canvas are outside this release.

This work is prepared in the isolated `codex/knowledge-tiptap` worktree. Application/database rollout to the established Atlas environment is a separate step.
