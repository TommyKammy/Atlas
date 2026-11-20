# Atlas

## Register

product

## Users and purpose

Project members use Atlas every day to organize tasks, shared projects, and
routine work. Many of them are not involved in investment or cost planning, so
the default experience is plain task management. The rule editor lets project
members express a workflow in Japanese without writing code or looking up
numeric identifiers.

## Daily use and portfolio use

Atlas serves two kinds of work with one product and keeps them apart in the
interface.

- **Daily teamwork.** Home, Inbox, My tasks, and Projects, including the project
  list, board, and timeline views. These screens carry no portfolio summaries,
  investment status, budget figures, or investment-proposal approval stages.
  Ordinary task approvals stay with the task: request and decide them in the
  task detail's approval section, see the state as a badge on list and board
  tasks, and receive approval requests and decisions in Inbox. A member can
  finish a normal day of work without meeting portfolio concepts.
- **Portfolio work.** Used when a piece of work is a project-shaped case that
  needs investment planning, approvals, and decisions. Here the portfolio
  features are used fully, not as an optional extra.

A portfolio entry point is shown only to users with portfolio view permission.
Daily screens do not advertise portfolio features.

## Approved design direction

The approved direction is a cleaned-up version of Option C, "the workbench": a
calm, information-dense business interface with decoration removed. It replaces
the earlier direction of preserving the existing Asana-style appearance.

It applies to every screen, including the rule editor. The rule editor keeps its
approved structure: the workflow on a canvas, with the selected step's settings
in a right-hand panel. Any remaining charcoal header, white content, and blue
action color there are provisional until the token migration completes; they
are not a target for new work.

## Theme

Light and dark are both officially supported and the user selects one. The
default is light; the theme switch sits at the bottom of the sidebar, or at the
right end of the top bar when the sidebar is hidden. Following the OS setting is
a future consideration, not current behavior.

All color comes from the semantic tokens in `docs/design-tokens.md`, defined once
per theme. Components read tokens and do not branch on the theme to choose
colors. New hardcoded colors are not added; a missing need becomes a token.

Status colors (success, warning, danger) stay legible as text in both themes, on
the page background and on their soft surfaces. State is never carried by color
alone; pair it with an icon, a label, or both.

## Screen structure

- One left sidebar: Home, Inbox, My tasks, Portfolio for users with portfolio
  view permission, and a Projects section. Trash is always present, admins also
  see Admin, and favorites and recent projects appear when they exist. The
  theme switch, help, and user menu are at its bottom; at widths where the
  sidebar is hidden, the theme switch and help move to the right end of the top
  bar.
- The top of each screen is a single header row: screen name, view switcher,
  search and command entry, and create action. The row does not wrap at narrow
  widths. Long names truncate with an ellipsis and the actions stay reachable.
- Task details open in a fixed right-hand pane.
- Search and frequent actions are available from the command palette (⌘K).
  Single-character shortcuts are inactive while focus is in a text field and
  during Japanese IME composition.

## Design principles

**Density with quiet.** Fit the working set on screen and remove decoration.
Group with type hierarchy, spacing, and alignment; keep dividers to a minimum.
Show selection and current location with a faint surface (`surface-muted`,
`accent-soft`), not with a line.

**Few accents.** One accent carries actions and selection. Do not add
feature-specific accent hues. Reserve success, warning, and danger for state.

**Japanese first.** Optimize for reading Japanese. Use a monospace face only for
numeric values, task numbers, and keyboard shortcut labels.

**Honest feedback.** Every screen states what it is doing: loading, empty,
failed, or not permitted. The rule editor additionally reports the workflow
states below.

**Rule editor.** These principles remain in force:

- Make triggers, conditions, evaluation order, and action targets understandable.
- Keep the published workflow running while a user edits a separate draft.
- Show save, conflict, test, publish, and execution states truthfully.
- Use names and field-specific controls rather than raw IDs and syntax.
- Preserve existing permissions, E2E contracts, and workflow semantics.

## Accessibility and inclusion

Support keyboard selection, labeled controls, visible focus, and button
alternatives to pointer gestures. Do not rely on color alone for selection or
execution status. The rule editor's settings panel must remain usable in a
narrow browser window.

Both themes must pass WCAG AA text contrast (4.5:1 for body text, 3:1 for large
text) in the contrast audit. Interactive surfaces, including the command palette
and the theme switch, are keyboard operable. Shortcuts respect text entry and
IME composition, so typing Japanese never triggers a single-character command.

## Migration

The color change is staged so each visual difference has one cause.

1. Tokenize every screen without changing appearance. Check with the visual
   comparison tool and the contrast audit described in `docs/design-tokens.md`,
   in light and dark. Keep a legacy dark override only until the classes it
   covers are migrated; a leftover override wins over the token.
2. Replace all screens before changing any token value. A screen that still
   hardcodes color blocks the palette switch.
3. Switch token values to the new palette in one step. Review the visual diff as
   intentional and re-run the contrast audit in both themes.

Layout changes (sidebar, header, right pane, command palette) stay out of the
color-token steps.

## Anti-references

- Marketing-page layouts: hero sections, promotional headlines, feature grids,
  testimonial or pricing-shaped composition.
- Decorative illustrations, ornamental icons, and imagery that carries no task
  information.
- Heavy gradients, glows, glass or blur effects, and shadows used as decoration.
- Border-heavy composition, where every group is boxed or separated by a line.
- Copying another product's colors, icons, layout, or interaction details
  (Asana, Linear, or others). Borrow the reasoning, not the surface.
- Color as the only signal of state, selection, or priority.
- Portfolio, investment, or approval content on daily screens.
- New branding or a palette outside the semantic tokens.
