# Atlas

## Register

product

## Users and purpose

Project members use Atlas to organize tasks, shared projects and routine work.
The rule editor lets project members express a workflow in Japanese without
writing code or looking up numeric identifiers.

## Approved design direction

Preserve the existing Atlas appearance and Asana-style interaction conventions.
The approved rule-editor mockup uses the existing charcoal global header and
sidebar, white content, fine neutral borders, compact system typography, and
the existing blue action color. A dedicated page shows the workflow on a canvas
and the selected step's settings on the right.

## Design principles

- Make triggers, conditions, evaluation order, and action targets understandable.
- Keep the published workflow running while a user edits a separate draft.
- Show save, conflict, test, publish, and execution states truthfully.
- Use names and field-specific controls rather than raw IDs and syntax.
- Preserve existing permissions, E2E contracts, and workflow semantics.

## Accessibility and inclusion

Support keyboard selection, labeled controls, visible focus, and button alternatives
to pointer gestures. Do not rely on color alone for selection or execution status.
The settings panel must remain usable in a narrow browser window.

## Anti-references

Avoid marketing-page layouts, decorative illustrations, new branding, or a palette
that departs from the current Atlas application.
