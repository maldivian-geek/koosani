# CLAUDE.md

> Operating rules for Claude Code on this repo. These are not suggestions.

---

## 1. Read these files first, every session

Before touching any code, read:

1. **`CLAUDE.md`** (this file)
2. **`ARCHITECTURE.md`** — structure, layers, invariants
3. **`STACK.md`** — what we use and what we don't
4. **`SECURITY.md`** — auth, rate limits, audit, file handling
5. **`DESIGN.md`** — UI/UX conventions, PrimeVue + Tailwind boundaries
6. **`FUNCTIONS.md`** — public surface of every module
7. **`CHANGELOG.md`** — recent context (last 2–3 entries are usually enough)

**Do not grep, list, or read the codebase to understand structure.** Those six files are the structure. If something you need is not in them, the right move is to ask once, then update the file — not to scan.

You may read specific files when:

- You are _implementing or modifying that file's contents_.
- A file is named directly in the task ("fix `invoicing/service.ts`").
- Tests are failing and you need to read the failure site.

You may **not**:

- Run `find`, `ls -R`, `tree`, broad `grep`, or "let me understand the project" tours.
- Open files "to get context" before the user asks for a specific change.
- Re-read `ARCHITECTURE.md` mid-task — read it once at session start.

---

## 2. The doc files are the contract

When you change code, you must update the docs in the same response (same PR):

| If you change…                                                       | Update…           |
| -------------------------------------------------------------------- | ----------------- |
| Module structure, layer boundaries, new module, schema relationships | `ARCHITECTURE.md` |
| Added/removed/swapped a dependency                                   | `STACK.md`        |
| Auth flow, rate limit, header, audit behaviour                       | `SECURITY.md`     |
| Component patterns, PrimeVue pass-through choices, design tokens     | `DESIGN.md`       |
| Route or service signature, new endpoint, removed endpoint           | `FUNCTIONS.md`    |
| Anything user-visible or any of the above                            | `CHANGELOG.md`    |

The CHANGELOG entry is **mandatory** for every PR. No exceptions.

---

## 3. CHANGELOG.md rules

Format: [Keep a Changelog](https://keepachangelog.com/) + SemVer.

Top of file is always an `## [Unreleased]` section with these subheads (omit empty):

```
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
### Breaking
```

Each bullet: imperative voice, links the relevant doc section.

> Example: `### Added\n- New \`/gst/rates\` endpoint for managing historical rates (FUNCTIONS.md §gst).`

On release: rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, add a new empty `[Unreleased]` block at top.

---

## 4. Hard rules — code

- **Layers are sacred.** Routes → services → repositories → DB. Never skip. If you need data in a route, add a service method; don't import Drizzle in a route.
- **Drizzle is only imported in `repository.ts`, `db/`, and migration files.** Lint enforces this; if lint isn't set up yet, behave as if it is.
- **No `Number` for money or quantity.** Use `Decimal` from `decimal.js`. Store as `NUMERIC` in DB, transport as string in JSON.
- **No `any`.** Use `unknown` and narrow, or define a real type. If you genuinely need `any`, comment why on the same line.
- **No raw SQL in services.** Migrations only.
- **Every input is Zod-validated.** No reading `c.req.json()` and trusting it.
- **Every mutation writes an audit log row** in the same transaction (`audit.record(...)`).
- **Every financial mutation checks GST period lock** (`gst.assertPeriodOpen(date)`).
- **Issued invoices / confirmed bills / approved POs are immutable.** Status guard at service layer + DB trigger.
- **Cross-module access goes through services**, not repositories of the other module.
- **Shared schemas live in `/shared`.** If you write the same Zod schema twice, move it.
- **No `localStorage` for auth state.** Pinia only, bootstrap from `/me` (per SECURITY.md).

---

## 5. Hard rules — UI

- Vue 3 `<script setup lang="ts">` only. TypeScript is mandatory on the frontend (strict, no implicit `any`) exactly as on the backend. No Options API, no JSX, no plain-JS `.vue` or `.js` source files.
- PrimeVue for interactive components. Tailwind for layout/spacing on plain markup.
- No Tailwind classes inside PrimeVue component slots that aren't layout (`flex`, `gap-*`, `p-*`, `m-*`). Style component internals via PrimeVue theme or `pt` prop.
- **Never override PrimeVue styles** with custom CSS, `<style>`/scoped styles, `!important`, `:deep()`/`::v-deep`, or global rules targeting PrimeVue classes. Theme config or `pt` only. Custom CSS touching a PrimeVue component requires owner approval first — propose, don't implement (DESIGN.md §2).
- One form = one Zod schema, shared with backend. No duplicate validation.
- Error messages from auth flows are fixed strings (per SECURITY.md). Never display backend error text in auth views.
- Charts: Chart.js via `vue-chartjs`. One wrapper component per chart type — don't build a generic chart.

---

## 6. Tests

- Every new service function: unit test for the happy path + at least one error path.
- Every new route: a request-level test (auth required, validation, success shape).
- GST math, money rounding, period locking: dedicated tests; these are the high-blast-radius spots.
- Don't add coverage tooling enforcement; just write the tests.

---

## 7. When you're unsure

In order:

1. Re-read the relevant doc section.
2. If the doc is silent or contradictory, **stop and ask**. Do not guess on architecture, security, or financial-math decisions.
3. If you must make a call to keep moving, pick the simpler option, note it in the PR description, and propose the doc update.

Never invent a new pattern silently. Either it's in the docs or you're proposing to add it.

---

## 8. What "minimal token use" means here

You have these docs precisely so you don't need to grep the codebase. Concretely:

- Don't open files you don't need.
- Don't repeat user-visible content in your reply if it's already in a doc you just updated — link the doc section instead.
- Don't dump full file contents in your reply when the diff would do.
- Don't re-explain the architecture to the user; they wrote it.

If you find yourself reading more than ~5 source files in a task, you are doing it wrong; either the task is too big (split it) or a doc is missing (propose adding it).

---

## 9. Forbidden actions

- Running migrations against any non-local DB without explicit user confirmation in the same turn.
- Committing secrets (any string matching JWT, KEY, SECRET, PASSWORD, TOKEN patterns from env).
- Editing `SECURITY.md` to relax a control without a corresponding `CHANGELOG.md > Security` entry that names the trade-off.
- Editing files under `/mnt/skills/`, `/mnt/transcripts/`, or any other read-only mount.
- Bypassing the audit log "to keep things simple".

---

## 10. Definition of done (per task)

- [ ] Code change passes type-check, lint, tests.
- [ ] Relevant doc(s) updated.
- [ ] `CHANGELOG.md > [Unreleased]` has an entry.
- [ ] No new dependency without `STACK.md` update.
- [ ] No new endpoint without `FUNCTIONS.md` row.
- [ ] If touching auth/files/audit: re-read SECURITY.md §relevant before submitting.
