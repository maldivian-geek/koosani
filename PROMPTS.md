# PROMPTS.md

> Phased build plan. Each phase is a single self-contained prompt for Claude Code. Paste it as-is.
>
> **Always begin every prompt with:**
> _"Read CLAUDE.md, ARCHITECTURE.md, STACK.md, SECURITY.md, FUNCTIONS.md, and the latest two entries in CHANGELOG.md. Then proceed."_
>
> Each phase ends with: `Update CHANGELOG.md > [Unreleased] and any docs you touched.`

---

## Phase 0 — Repo & tooling

```
Read CLAUDE.md, ARCHITECTURE.md, STACK.md. Then:

Set up the monorepo:
- pnpm workspace with packages: api, web, shared.
- Root tsconfig with project references.
- ESLint + Prettier at root; rules per CLAUDE.md (no any, layer-import rule for Drizzle).
- Husky + lint-staged: typecheck + lint on staged files only.
- Vitest configured in api, web, shared.
- GitHub Actions workflow: install, typecheck, lint, test on PR.
- Docker compose for local Postgres + Redis.
- Root README with run commands only; structural docs already exist.

Do not implement any features yet. Update CHANGELOG.md > [Unreleased] > Added with the scaffolding.
```

---

## Phase 1 — Database foundation

```
Read CLAUDE.md, ARCHITECTURE.md (§4, §5), STACK.md, SECURITY.md.

Create the Drizzle schema and initial migration covering:
- businesses, users, user_sessions, auth_logs, audit_logs
- customers, customer_contacts
- suppliers, supplier_contacts
- items, item_categories, stock_movements
- invoices, invoice_lines, credit_notes, credit_note_lines, payments_received
- bills, bill_lines, payments_made
- purchase_orders, po_lines, grns, grn_lines
- gst_periods, gst_rates, gst_returns
- files

Enforce:
- All money NUMERIC(15,2), all quantities NUMERIC(15,4).
- business_id on every row.
- Append-only constraint on audit_logs and stock_movements (REVOKE UPDATE, DELETE from app role; document in migration comments).
- Triggers per ARCHITECTURE.md §4.2 (invoice immutability) and §4.3 (stock_on_hand maintenance).
- Partial unique index on (business_id, invoice_number) WHERE status != 'draft'. Same for bills, POs, credit notes.

Generate the migration with drizzle-kit. Add a seed script that creates one business + one admin user for local dev.

Update FUNCTIONS.md only if any signature changes. Update CHANGELOG.md.
```

---

## Phase 2 — Auth module

```
Read CLAUDE.md, SECURITY.md (all), FUNCTIONS.md > auth, ARCHITECTURE.md §2 and §6.

Implement the auth module per SECURITY.md exactly:
- Argon2id with documented params, DUMMY_HASH constant.
- JWT in httpOnly secure sameSite=strict cookie, 8h.
- token_version + sid in payload; middleware validates both with 30s in-process cache keyed (user_id, sid).
- Login with dual lockout (per-source + per-email).
- Magic link, password reset, invite flows.
- All rate limiters via rate-limiter-flexible on Redis.
- getRealIp() per SECURITY.md.
- Generic error responses; auth_logs written for every event.
- /me endpoint returning profile + permissions.

Tests:
- Happy path login.
- Lockout triggers at correct thresholds.
- Timing-safe rejection paths.
- JWT_SECRET_PREVIOUS fallback works.
- token_version bump invalidates existing tokens.

Update FUNCTIONS.md > auth if anything diverges. Update CHANGELOG.md.
```

---

## Phase 3 — Shared schemas & money/date utilities

```
Read CLAUDE.md, ARCHITECTURE.md §4.1, FUNCTIONS.md > "Shared types".

In /shared, implement:
- Zod primitives: Money, Qty, IsoDate, Email, Tin (Maldives TIN format).
- Pure functions: money.add, money.mul, money.round2; qty.add, qty.mul, qty.round4.
- Decimal-based GST line calculator: gstFor(taxableValue, rate) returning {gst, gross} with per-line rounding per ARCHITECTURE.md §4.1.
- Date helpers in Indian/Maldives tz.
- All Zod schemas referenced in FUNCTIONS.md for customers, suppliers, items (CRUD shapes only — bigger modules later).

100% test coverage on /shared. These functions are load-bearing.

Update CHANGELOG.md.
```

---

## Phase 4 — Master data: customers, suppliers, items

```
Read CLAUDE.md, FUNCTIONS.md > customers/suppliers/items, ARCHITECTURE.md §2, §3.

Implement the three modules end-to-end (api routes, service, repository) using the shared schemas from Phase 3.

Per module:
- CRUD per FUNCTIONS.md.
- Soft-delete guard: cannot delete with non-zero balance or active references.
- Every mutation writes an audit log row in the same transaction.
- Pagination via cursor or page+pageSize — pick one and document in ARCHITECTURE.md if not already.

Tests: CRUD happy path + soft-delete-guard rejection + audit log written.

Update FUNCTIONS.md only if signatures changed. Update CHANGELOG.md.
```

---

## Phase 5 — Inventory module

```
Read CLAUDE.md, ARCHITECTURE.md §4.3, FUNCTIONS.md > inventory.

Implement inventory:
- stock_movements append-only writes via inventory.applyMovement (the only writer).
- Trigger-maintained items.stock_on_hand verified by a unit test that inserts movements and checks the cache matches SUM(qty).
- Adjustment route with reason required.
- Bulk stock-count endpoint that diffs current vs counted and creates adjustments.
- inventory.assertAvailable with backorder flag.
- Nightly reconcile job (BullMQ) — register but don't schedule yet; will wire in Phase 11.

Tests: movement math, negative-stock rejection, recount diffs.

Update CHANGELOG.md.
```

---

## Phase 6 — GST configuration

```
Read CLAUDE.md, FUNCTIONS.md > gst, ARCHITECTURE.md §4.4.

Implement just the configuration + lookup parts of gst (NOT return building yet):
- gst_rates table seeded with current MIRA rates (general 8%, tourism 17% from 2025-07-01, with prior 16% row valid 2023-01-01 to 2025-06-30).
- gst.rateAt(category, date) resolves the rate active on that date.
- gst.assertPeriodOpen(date).
- gst_periods auto-created on first use (monthly or quarterly per business config).

Tests: rate resolution across the 2025-07-01 boundary, period-lock rejection.

Update CHANGELOG.md.
```

---

## Phase 7 — Invoicing (sales)

```
Read CLAUDE.md, ARCHITECTURE.md §4.1, §4.2, §4.4, FUNCTIONS.md > invoicing, SECURITY.md (audit + immutability).

Implement invoicing:
- Draft create / patch.
- Issue: allocate per-business invoice number from sequence, commit stock via inventory.applyMovement, snapshot GST per line using gst.rateAt at issue_date, write audit, return locked invoice.
- Void: only issued; creates reversing credit note; stock reversed.
- Payments received CRUD.
- Customer SOA build (json + PDF via worker).
- Credit notes (create draft, issue).

Enforce period lock on issue and on void.

Tests: total math with mixed GST categories, immutability of issued rows, stock committed exactly once, voiding produces correct reversing CN.

Update CHANGELOG.md.
```

---

## Phase 8 — Purchases (bills) + SOA extraction

```
Read CLAUDE.md, FUNCTIONS.md > purchases, ARCHITECTURE.md §4 (all).

Implement:
- Bills (supplier invoices) draft → confirm. Confirm posts to ledger and commits stock if not already received via a GRN.
- Payments made CRUD.
- Supplier SOA build.
- File upload for supplier invoices (uses files module — implement files module if not done; minimal version is fine here).
- SOA extraction worker: accepts PDF/CSV, parses via pdf-parse/papaparse, matches lines to existing bills by (supplier_id, ref, amount, date) and returns match candidates. No auto-confirm; user reviews.

Tests: confirm math, period lock, SOA parse for one canonical CSV format + one PDF.

Update CHANGELOG.md.
```

---

## Phase 9 — Purchase Orders

```
Read CLAUDE.md, FUNCTIONS.md > po.

Implement:
- PO draft → approve. Approval allocates number, freezes lines.
- GRN against PO: records goods received, commits stock.
- PO → Bill: create a bill pre-filled from PO/GRN lines.
- Over-receipt rejection unless flag set.
- PDF generation enqueued on approve.

Tests: GRN math, over-receipt rejection, PO → bill prefill correctness.

Update CHANGELOG.md.
```

---

## Phase 10 — GST return building (MIRA 205 / 206 + Input Tax Statement)

```
Read CLAUDE.md, ARCHITECTURE.md §4.4, FUNCTIONS.md > gst.

Implement gst.buildReturn:
- Aggregate issued invoices, credit notes, and confirmed bills within a period.
- Group by GST category (general 8 / tourism 16 / tourism 17 / zero / exempt) for outputs.
- Group input tax from bills by supplier with TIN.
- Produce three artefacts:
  - MIRA 205 summary (general sector) — values matching the official form fields.
  - MIRA 206 summary (tourism sector) — same.
  - Input Tax Statement CSV in the format MIRAconnect accepts on upload.
- Snapshot stored in gst_returns row; PDFs + CSVs uploaded via files module; signed URLs returned.

Period lock on success (manual, via /gst/periods/:id/lock — user enters MIRAconnect reference after filing).

Tests: end-to-end with seeded invoices straddling rate-change date; verify totals match a manually-computed fixture.

Note: MIRAconnect has no public API. We export files for the user to upload; we do not submit programmatically. Document this in ARCHITECTURE.md §3 (gst module note).

Update FUNCTIONS.md, ARCHITECTURE.md, CHANGELOG.md.
```

---

## Phase 11 — Reports

```
Read CLAUDE.md, FUNCTIONS.md > reports.

Implement read-only aggregations:
- Sales register, purchases register (groupBy variants).
- Stock valuation (avg-cost first; FIFO behind a flag).
- Aged receivables, aged payables.
- GST summary (live preview of current open period).

CSV export for each.

Tests: aggregation correctness on a seeded dataset.

Update CHANGELOG.md.
```

---

## Phase 12 — Frontend foundation

```
Read CLAUDE.md, DESIGN.md, STACK.md.

Set up web:
- Vite + Vue 3 + Pinia + Vue Router.
- PrimeVue with chosen theme; Tailwind config restricted to layout/spacing utilities (jit safelist as needed).
- apiFetch wrapper with cookie auth, 401 redirect.
- Auth bootstrap: GET /me on mount, store in Pinia, route guards.
- Login, magic-link, reset, accept-invite views with fixed error strings.
- App shell: sidebar nav, topbar with user menu, breadcrumbs.

No business views yet.

Update CHANGELOG.md.
```

---

## Phase 13 — Master-data UI

```
Read CLAUDE.md, DESIGN.md, FUNCTIONS.md > customers/suppliers/items.

For each of customers, suppliers, items:
- List view: PrimeVue DataTable with server-side pagination, sort, filter.
- Detail/edit drawer or page.
- Create dialog.
- Soft-delete confirmation.

Reuse a generic <EntityList> component if it doesn't compromise per-entity needs.

Update CHANGELOG.md.
```

---

## Phase 14 — Invoicing UI

```
Read CLAUDE.md, DESIGN.md, FUNCTIONS.md > invoicing.

Build:
- Invoice list.
- Invoice editor (draft): line editor with item picker, qty, price; live GST + total computed via the shared module (NOT recomputed by hand in Vue).
- Issue / void buttons with confirmation.
- Payments panel.
- PDF download.
- Customer SOA view.

Update CHANGELOG.md.
```

---

## Phase 15 — Purchases & PO UI

```
Read CLAUDE.md, DESIGN.md, FUNCTIONS.md > purchases, po.

Build:
- Bills list + editor + confirm.
- Supplier SOA upload page with extraction-result review table.
- PO list + editor + approve + GRN dialog + "convert to bill".
- Supplier SOA view.

Update CHANGELOG.md.
```

---

## Phase 16 — GST UI

```
Read CLAUDE.md, DESIGN.md, FUNCTIONS.md > gst.

Build:
- Periods list with status (open / built / locked).
- Build-return action with progress polling.
- Return view showing summary + download buttons for MIRA 205/206/ITS files.
- Lock dialog asking for MIRAconnect ref.
- Rates admin page.

Update CHANGELOG.md.
```

---

## Phase 17 — Reports & dashboard

```
Read CLAUDE.md, DESIGN.md, FUNCTIONS.md > reports.

Build:
- Dashboard home: this-month sales, this-month purchases, top-5 customers by AR, low-stock items, GST current-period preview. Chart.js where useful.
- Each report page with filter bar + table + CSV export button.

Update CHANGELOG.md.
```

---

## Phase 18 — Hardening pass

```
Read CLAUDE.md and SECURITY.md in full.

Do a security pass:
- Verify every mutation writes audit_logs.
- Verify every financial mutation calls gst.assertPeriodOpen.
- Verify file downloads are signed URLs only and per-business permission checked.
- Add rate limit to /reports/* and /*/pdf endpoints.
- CSP: pin directives explicitly, no unsafe-inline.
- Run a manual emergency JWT rotation drill (bump all token_versions).
- Confirm backup procedure documented in SECURITY.md.

Fix anything found. Update SECURITY.md and CHANGELOG.md > Security for each fix.
```

---

## Phase 19 — Release 1.0

```
Read CLAUDE.md, CHANGELOG.md.

Cut release 1.0:
- Rename [Unreleased] → [1.0.0] - YYYY-MM-DD.
- Add fresh empty [Unreleased] block.
- Tag the commit.
- Update root README with deploy steps.
```

---

## How to add a new phase later

Append at the bottom. Each new phase:

- Starts with the standard "Read CLAUDE.md, …" line.
- Names exactly which doc sections are relevant.
- Ends with "Update CHANGELOG.md."
- Stays under ~200 lines of prompt so Claude Code's context isn't dominated by the prompt itself.
