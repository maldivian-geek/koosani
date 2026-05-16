# Design

> UI/UX conventions for this app. CLAUDE.md requires this file to be read at session start.

---

## 1. Visual language

- **Tone:** functional, dense, professional. Accountants look at this all day; clarity beats decoration.
- **Spacing scale:** Tailwind defaults (`gap-2 / gap-4 / gap-6` etc.). No custom magic numbers.
- **Type scale:** PrimeVue defaults; no global font overrides unless documented here.
- **Theme:** PrimeVue **Aura** preset, **noir** color (`@primevue/themes/aura` with the noir/neutral primary). This is the only theme; no per-component color overrides outside the theme config.
- **Dark mode:** required. A theme selector (light / dark / system) lives in the topbar user menu. Implementation:
  - PrimeVue dark mode via the `.app-dark` class selector (`darkModeSelector: '.app-dark'` in the theme options), toggled on `<html>`.
  - Tailwind `darkMode: 'selector'` using the same `.app-dark` class so layout utilities stay in sync.
  - Choice persisted in the Pinia `ui` store and synced to `prefers-color-scheme` when set to "system". **Not** `localStorage` directly — the `ui` store owns it (auth state rule from SECURITY.md doesn't apply here, but keep persistence in the store layer for consistency; the store may use `localStorage` for _non-auth_ UI prefs only).
  - Default on first visit: system.
- **Density:** PrimeVue `p-component-sm` density preset for DataTables, forms, and dialogs. Compact UI is correct for this audience.

---

## 2. PrimeVue + Tailwind boundary

This is the most-violated rule in mixed PrimeVue/Tailwind projects. The boundary is:

| Concern                                                               | Tool                                        |
| --------------------------------------------------------------------- | ------------------------------------------- |
| Page layout (grids, flex, gap, spacing between blocks)                | **Tailwind**                                |
| Component internals (button color, table row hover, dialog header bg) | **PrimeVue theme** or `pt` prop             |
| One-off tweaks to a PrimeVue component                                | **PrimeVue `pt`**, not Tailwind in the slot |
| Plain HTML markup styling                                             | **Tailwind**                                |

Why: PrimeVue's classes change between versions; Tailwind utilities sprinkled in component slots break silently on upgrade.

**Hard rule — no unapproved overrides.** Do not override PrimeVue component styles with custom CSS, `<style>` blocks, scoped styles, `!important`, deep selectors (`:deep()`, `::v-deep`), or global stylesheets targeting PrimeVue classes. All component styling goes through the Aura noir theme config or the `pt` pass-through prop. Any custom CSS that touches a PrimeVue component requires explicit owner approval **before** it is written — propose it, do not implement it.

**Allowed inside PrimeVue slots:** layout-only utilities (`flex`, `grid`, `gap-*`, `p-*`, `m-*`, `w-*`, `h-*`, text alignment).
**Not allowed:** color, background, border, shadow, font utilities inside PrimeVue component slots.

---

## 3. Component conventions

- **One screen = one view component** under `web/src/modules/<module>/views/`.
- **Shared UI primitives** (page header, empty state, confirm dialog wrapper, money cell, date cell) live in `web/src/shared/ui/`.
- **No prop-drilling more than two levels.** Reach for Pinia or `provide`/`inject` before three.
- **Composition API + `<script setup lang="ts">` only.** TypeScript strict; no plain-JS components.
- **Filenames:** PascalCase for components, camelCase for composables (`useInvoiceDraft.ts`).

---

## 4. Forms

- Every form binds to a Zod schema imported from `/shared`. The backend re-validates with the same schema.
- Show field-level errors inline under each input. No alert-bar form errors except for server-side 500s.
- Disable the submit button while the request is in flight; never rely on a global "loading" spinner.
- Money inputs use a dedicated `<MoneyInput>` component that internally stores a string and emits a `Decimal`-compatible string. Never bind a money field to a `Number` ref.
- Date inputs use PrimeVue `Calendar` with `Indian/Maldives` tz; never use the browser's native date picker (inconsistent across OS).

---

## 5. Data tables

- PrimeVue `DataTable` with server-side pagination, sort, and filter on every list view that can exceed ~50 rows.
- Columns:
  - Money columns are right-aligned, tabular numerals, two decimal places, no thousands separator inside the number (use the locale formatter for display only).
  - Status columns use a `<StatusTag>` component (one color per status; documented in `web/src/shared/ui/StatusTag.vue`).
  - Date columns use `<DateCell>` (DD MMM YYYY in this app, since accounting reports use that format).
- Row click opens detail; never a button-in-row "view" link (wastes a click).
- Bulk actions (when present) live in a toolbar above the table, disabled when nothing selected.

---

## 6. Forms vs. drawers vs. dialogs

| When                                                   | Use                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| Quick edit of a small record (customer phone, contact) | PrimeVue `Sidebar` drawer from the right                              |
| Create / edit of a complex record (invoice, PO, bill)  | Full-page view, not a dialog                                          |
| Destructive confirm                                    | PrimeVue `ConfirmDialog`                                              |
| Multi-step wizards                                     | Avoid. If genuinely needed, full-page with a left-side step indicator |

---

## 7. Empty states

Every list view has an empty state. Three flavours, pick the right one:

1. **First-time** — "No customers yet" + a Create button.
2. **Filtered to nothing** — "No customers match your filters" + a Clear filters button.
3. **Permission-restricted** — "You don't have access to view customers" + contact admin hint.

A blank table is never acceptable.

---

## 8. Errors

- 401 from the api → redirect to login (handled by `apiFetch`, not per-view).
- 403 → toast: "You don't have permission to do that."
- 404 on a detail view → dedicated 404 view with a back link, not a toast.
- 422 (validation) → field-level errors on the form.
- 5xx → toast: "Something went wrong. Please try again." + log the request id for support reference.

Never display backend error messages verbatim in auth views (per SECURITY.md). Outside auth, sanitised backend `message` is acceptable if and only if the api explicitly marks it as user-facing.

---

## 9. Charts

- Chart.js via `vue-chartjs`. One wrapper component per chart type (`<SalesByDayChart>`, `<TopCustomersChart>`). No generic mega-chart component.
- Money axes use the same formatter as `<MoneyCell>`.
- Colors: chart palette is a fixed array in `web/src/shared/ui/chartColors.ts`. Five colors max; if you need more categories, group the tail into "Other".
- No 3D charts. No pie charts with more than five slices.

---

## 10. Accessibility floor

- All interactive elements reachable by keyboard.
- All form inputs have a `<label>` (or `aria-label` for icon-only controls).
- Color is never the sole carrier of meaning (status uses color + text).
- Contrast: Aura noir meets WCAG AA in **both** light and dark; re-check any custom token override against both modes.

---

## 11. Change protocol

Adding a new component pattern or breaking a rule above:

1. Update this file (with the reason for the new pattern).
2. `CHANGELOG.md > Changed` entry.
3. If the pattern is reusable, extract it into `web/src/shared/ui/` in the same PR.
