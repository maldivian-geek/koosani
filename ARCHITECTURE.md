# Architecture

> **Purpose of this file.** This is the _single source of truth_ for the app's structural design. Claude Code reads this instead of scanning the codebase. When architecture changes, update this file in the same commit.

---

## 1. System overview

A single-tenant (per business) accounting & inventory app for Maldives SMEs. Handles inventory movements, customer invoicing with MIRA-compliant GST, supplier purchases, PO lifecycle, statement-of-account generation, and exports for MIRA GST return filing (MIRA 205 / 206 + Input Tax Statement).

Two deployable units:

| Unit    | Role                                                                             |
| ------- | -------------------------------------------------------------------------------- |
| **api** | Hono server. REST + JSON. Owns all writes, all business logic, all DB access.    |
| **web** | Vue 3 SPA. Pure presentation. Talks to api over HTTPS, auth via httpOnly cookie. |

Plus one async worker process (same codebase as api, different entrypoint) for jobs that must not block requests: PDF generation, SOA extraction, email send, GST return file build.

```
┌─────────┐   HTTPS    ┌──────────┐   SQL    ┌────────────┐
│ Vue SPA │ ─────────► │   Hono   │ ───────► │ PostgreSQL │
└─────────┘            │   api    │          └────────────┘
                       └────┬─────┘                ▲
                            │ enqueue              │
                            ▼                      │
                       ┌──────────┐                │
                       │  Worker  │ ───────────────┘
                       │ (BullMQ) │
                       └────┬─────┘
                            ▼
                   ┌────────────────┐
                   │ Object storage │  (PDFs, uploaded SOAs, supplier invoices)
                   └────────────────┘
```

---

## 2. Layered structure (api)

Every request flows through these layers in order. **Never** skip a layer (e.g., no controller hitting Drizzle directly).

```
HTTP route          (Hono handler — zod-validated input, calls service)
  │
  ▼
Service             (business logic, transactions, calls repository)
  │
  ▼
Repository          (Drizzle queries only — no business rules here)
  │
  ▼
Database            (PostgreSQL — constraints enforce invariants)
```

- **Routes** are thin. They validate input with Zod, call one service method, shape the response. No `if`-business-logic in a route.
- **Services** own transactions. Every multi-table write opens an explicit `db.transaction(...)`.
- **Repositories** are the only place Drizzle is imported outside migrations. Each repo exports named functions, never a class.
- **DB constraints** (FKs, CHECKs, partial unique indexes) are the last line of defence — never trust the service layer alone for invariants that matter financially.

---

## 3. Module boundaries

Each module is a folder under `api/src/modules/` and `web/src/modules/`. A module owns its routes, services, repositories, schemas, and Vue views. Cross-module calls go through the _service_ of the other module, never its repository.

| Module            | Owns                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`            | Login, sessions, JWT, password reset, invite, magic link (per SECURITY.md)                                                                                               |
| `users`           | User CRUD, invite issuance, role changes (implemented Phase 21; previously documented but non-existent)                                                                  |
| `permissions`     | `user_permissions` grants — no routes; consumed by `middleware/authorize.ts`, `users`, `auth` (Phase 21)                                                                 |
| `customers`       | Customer master, contact persons, billing addresses, credit terms, TIN                                                                                                   |
| `suppliers`       | Supplier master, contact persons, payment terms, TIN                                                                                                                     |
| `items`           | Item master (SKU, name, unit, GST category, default price/cost), categories                                                                                              |
| `inventory`       | Stock-on-hand per item, movement ledger, adjustments, stock counts                                                                                                       |
| `invoicing`       | Sales invoices, credit notes, payments received, customer SOA                                                                                                            |
| `estimates`       | Quotes: draft → sent → accepted/declined/expired; convert-to-invoice (Phase 25) — see §4.6                                                                               |
| `recurrence`      | Recurring invoice profiles + template lines; daily cron generates draft/issued invoices (Phase 26) — see §4.7                                                            |
| `portalAuth`      | Customer portal auth — magic-link only, separate JWT secret/session table from staff `auth` (Phase 28) — see §4.9                                                        |
| `portal`          | Read-only customer-facing views (own invoices/estimates/statement) + estimate accept/decline (Phase 28) — see §4.9                                                       |
| `customerCredits` | Append-only credit ledger (overpayments, advances, voided-invoice grants, applications, refunds) — see §4.8                                                              |
| `purchases`       | Supplier invoices (bills), payments made, supplier SOA                                                                                                                   |
| `po`              | Purchase orders, goods receipt notes (GRN), PO→bill matching                                                                                                             |
| `gst`             | GST rate config, MIRA 205 / 206 builders, Input Tax Statement, period locking                                                                                            |
| `reports`         | Cross-module reports (sales, purchases, stock valuation, P&L summary)                                                                                                    |
| `files`           | Upload, virus-scan handoff, signed-URL download for PDFs and uploaded docs                                                                                               |
| `audit`           | Append-only audit log for all financial mutations                                                                                                                        |
| `settings`        | Business profile, logo, numbering prefixes, defaults — reads/writes the `businesses` row (Phase 22)                                                                      |
| `emailLogs`       | Append-only outbound email log (`email_logs`) and reminder idempotency (`invoice_reminders_sent`) — no routes of its own; read via `GET /invoices/:id/emails` (Phase 24) |

**Forbidden cross-module patterns:**

- `invoicing` reading `items.stock_on_hand` directly → must call `inventory.reserveStock()` / `inventory.commitStock()`.
- `gst` recomputing tax from raw line items → must read from `invoices.gst_amount` / `bills.input_gst_amount` already persisted.
- Any module writing to `audit_logs` directly except through `audit.record(...)`.

**MIRAconnect integration note:**

MIRAconnect (MIRA's online filing portal) has no public API. The `gst` module produces export files (MIRA 205 / 206 JSON summaries stored in `gst_returns.summary_json`; Input Tax Statement CSV uploaded to object storage via the `files` module) that the operator downloads and uploads manually to MIRAconnect. The app does **not** submit returns programmatically. Period lock (`POST /gst/periods/:id/lock`) is a manual step that the operator performs after successful MIRAconnect upload, entering the MIRAconnect reference number to record the filing.

---

## 4. Core domain invariants

These are non-negotiable. Enforced at _both_ the service layer and the DB layer.

### 4.1 Money & tax precision

- All money stored as `NUMERIC(15, 2)` (MVR has 2 dp; never `float`/`double`).
- All quantity stored as `NUMERIC(15, 4)` (some items sold fractionally — kg, litres).
- GST computed as: `gst_amount = round(taxable_value * rate, 2)` — round to 2 dp **per line**, then sum. Matches MIRA's expectation. Never sum-then-round.
- Use `decimal.js` (or Drizzle's numeric mode) on the JS side; never use native `Number` for money math.

### 4.2 Invoice immutability

- Invoice has `status`: `draft` → `issued` → (`paid` | `partially_paid` | `voided`).
- Once `status = 'issued'`, the row's financial columns (lines, totals, gst_amount, customer_id, invoice_number, issue_date) are immutable. Enforced by:
  - Service-layer status guard (reject UPDATE if status ≠ `draft`).
  - DB trigger that raises on UPDATE of frozen columns when status ≠ `draft` — on the header row **and**, since Phase 20 (UPGRADE.md F-12), on `invoice_lines`/`bill_lines`/`credit_note_lines` (previously only the header was guarded; lines of an issued document could be UPDATEd/DELETEd directly at the DB level).
  - `REVOKE DELETE` on `invoices`/`bills`/`credit_notes`/`purchase_orders` (Phase 20) — no route ever deletes these rows; the grant gap is closed regardless.
- Corrections to an issued invoice happen via a **credit note** (separate row, references original `invoice_id`).
- Invoice numbers come from a per-business sequence with no gaps. Allocated only on issue, never on draft create. The prefix (`INV-` by default) is configurable per business via `settings` (Phase 22, UPGRADE.md G-15) — `api/src/db/numbering.ts`'s `allocateDocumentNumber` computes the MAX only over rows already starting with the _current_ prefix, so changing the prefix restarts that document type's sequence at 1 rather than risking a SUBSTRING offset mismatch against differently-prefixed rows. Same mechanism backs credit note, bill, and PO numbering.
- Voiding an invoice with active (non-reversed) payments is rejected — payments must be reversed first (UPGRADE.md F-14, interim policy; proper credit/refund handling is UPGRADE.md Phase 27).

### 4.3 Stock movement ledger

- `stock_movements` is append-only. Every change to on-hand stock is a row: `+10` (GRN), `-3` (invoice line), `-1` (adjustment write-off), etc.
- `items.stock_on_hand` is a _derived_ cache (`SUM(stock_movements.qty)` for that item). **Decision:** trigger-maintained column (`update_stock_on_hand()` AFTER INSERT on `stock_movements`) for read speed; nightly reconcile job verifies.
- Negative stock is rejected by default (configurable per-business flag for back-orders), enforced at two layers since Phase 20 (UPGRADE.md F-10): `inventory.assertAvailable` takes a `SELECT ... FOR UPDATE` row lock on the item before checking (closing a TOCTOU race between two concurrent movements), and `update_stock_on_hand()` itself raises if the resulting on-hand would go negative and the business doesn't allow backorders — the DB-level backstop this section always described but never had.

### 4.4 GST period locking

- Once a GST return is generated for a period (e.g., `2026-Q1`), that period is **locked**. No new invoices, credit notes, or bills may be back-dated into a locked period. Stored in `gst_periods` table with `locked_at`, `locked_by`, `mira_return_id`.
- Late entries that would have belonged to a locked period must be entered with today's date and noted on the next return.
- `gst.assertPeriodOpen` takes an optional `tx` parameter (Phase 20, UPGRADE.md F-18) — every call site inside an existing transaction passes its own `tx` so period auto-creation is atomic with the mutation that triggered it, rather than committing in its own transaction that survives a rollback of the caller.
- Payment reversal (both `invoicing.reversePayment` and `purchases.reversePayment`) now calls `assertPeriodOpen` before reversing (Phase 20, UPGRADE.md F-11) — a reversal is a financial mutation like any other and previously bypassed the lock.

### 4.5 Append-only audit log

- Every state-changing service call records to `audit_logs` (`user_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `ip`, `at`). No UPDATE, no DELETE on this table — enforced by revoking those grants from the app role.

### 4.6 Estimates — no stock, no GST period interaction until converted

- Lifecycle: `draft` → `sent` → `accepted` / `declined` / `expired` (Phase 25, UPGRADE.md G-5). Numbered only on send (`estimate_number_prefix`, default `EST-`), same advisory-lock/no-gap mechanism as invoice numbering.
- GST on estimate lines is computed for **display only** — no `gst.assertPeriodOpen` call, no snapshot-freezing against a locked period. An estimate is a quote, not a tax document; the real GST snapshot happens when its lines are copied into an invoice draft and that invoice is later issued.
- No stock reservation or movement at any estimate status — `applyMovement`/`assertAvailable` are never called from the `estimates` module.
- Conversion (`estimates.convertToInvoice`) copies lines into a brand-new `invoicing.createDraft` call — it does **not** copy the estimate's snapshotted GST rates verbatim, since those may be stale by conversion time; the invoice re-prices at `gst.rateAt(...)` same as any other new invoice. The resulting invoice is a **draft**; issuing it (with the accompanying stock/GST-period checks) is a separate, explicit step. `invoices.estimate_id` traces back to the source estimate; `estimates.converted_at` (set once) blocks converting the same estimate twice.
- No customer-facing accept/decline surface exists yet — staff record the customer's response manually via `POST /estimates/:id/accept|decline` (UPGRADE.md Phase 28 will add a real customer portal).
- Expiry is swept daily by the same cron as payment reminders (`worker/reminders.ts`, §8) — a `sent` estimate past its `expiry_date` transitions to `expired` automatically.

### 4.7 Recurring invoices — always dated today, no late fees

- A `recurrence_profiles` row (customer, frequency, start/end date, template lines, `next_run_date`) drives the same daily cron as §4.6's estimate expiry (`worker/reminders.ts`) — when `next_run_date <= today`, `recurrence.generateFromProfile` fires (Phase 26, UPGRADE.md G-6).
- **Advance-then-generate, not generate-then-advance**: the profile row is locked (`FOR UPDATE`) and `next_run_date` is advanced to the next cycle _before_ the invoice is created. If invoice creation then fails partway, that cycle is silently skipped rather than risking a duplicate invoice on the next tick — a deliberate bias toward under- over over-generation for a financial-document generator.
- Generated invoices are **always dated today** (`todayMv()`), by construction — this is what makes "respects GST period locks by construction" true (UPGRADE.md's phrasing): a profile can never generate a backdated invoice into an already-locked period, so no special-case period check is needed here (contrast with `invoicing.issue`, which does call `gst.assertPeriodOpen`).
- Two generation modes per profile: `autoIssue: false` (default) creates a **draft** for staff review; `autoIssue: true` immediately calls `invoicing.issue` (stock commit, number allocation, no human in the loop) — an intentionally blunt per-profile flag, not a business-level default, since auto-issuing is a meaningfully bigger trust decision than auto-drafting.
- `invoices.recurrence_profile_id` traces a generated invoice back to its profile (same no-FK-at-the-schema-level pattern as `estimates`' `invoices.estimate_id`, via `invoicing.setRecurrenceLink`).
- **Late fees are explicitly not implemented.** UPGRADE.md flags that MIRA's GST treatment of late fees needs owner confirmation before that half of G-6/G-4b is built — see `api/src/db/schema/enums.ts`'s comment on `recurrenceFrequencyEnum`. No late-fee columns, rules, or generated lines exist anywhere in this schema.

### 4.8 Customer credits — properly resolves F-14 and F-15

- `customer_credits` is an append-only ledger — a customer's available balance is `SUM(amount)` over their rows, never a stored/cached counter. Positive-amount kinds grant credit (`overpayment`, `advance`, `voided_invoice`); negative-amount kinds consume it (`applied_to_invoice`, `refunded`). Rows are never updated; a correction is always a new offsetting row (Phase 27, UPGRADE.md G-7).
- **F-15, properly resolved**: `invoicing.addPayment` no longer rejects an overpayment. It caps the `payments_received` row at what's actually outstanding on the invoice, and the excess becomes a `customer_credits` grant (`kind: 'overpayment'`) referencing the payment. `paidAmount` therefore still never exceeds `total` — the Phase 20 interim invariant holds — but the excess isn't lost, it's redirected.
- **F-14, properly resolved**: `invoicing.voidInvoice` no longer rejects voiding an invoice with active payments. Each active (non-reversed) payment is locked (`FOR UPDATE`), reversed via the same mechanism as a manual reversal, and its amount granted back as credit (`kind: 'voided_invoice'`). The invoice's `paidAmount` is re-synced to the post-reversal total (0, if all payments were active) before the final `voided` status update.
- **Applying credit** (`POST /invoices/:id/apply-credit`) debits the ledger (`customerCredits.applyToInvoice`, serialized per-customer via `pg_advisory_xact_lock` — same pattern as `db/numbering.ts` — so two concurrent applications can't both pass a balance check that's only sufficient for one) and inserts a `payments_received` row with `method: 'credit'`, so it flows through the exact same `paidAmount`/status sync as a cash payment. Cross-module error translation matters here: `customerCredits.ValidationError` is caught and re-thrown as `invoicing.ValidationError` at the call site, since they're distinct classes despite the same name — a route's `instanceof svc.ValidationError` check only recognizes its own module's class.
- **Write-off** (`POST /invoices/:id/write-off`) is a thin wrapper over `invoicing.addPayment` with `method: 'write_off'` for the exact outstanding amount — reuses the same `paidAmount`/status sync rather than a parallel code path. No new `invoice_status` enum value was added (a written-off invoice still shows `paid`); reports that need to exclude non-cash revenue should filter on `payments_received.method != 'write_off'`. The "thank you for your payment" receipt email is skipped for this method (see `invoicing.addPayment`'s `.then()`), since no real payment occurred.
- Advances and refunds (`POST /customers/:id/credits/advance`, `.../refund`) are manual, staff-entered ledger rows with no invoice/payment reference — used for retainers paid before any invoice exists, and for physically returning credit as cash.

### 4.9 Customer portal — separate identity, separate trust boundary (Phase 28, UPGRADE.md G-8)

Full threat model in SECURITY.md §13.14; this section covers the structural shape.

- **Not staff auth with a filter bolted on — a parallel system.** Portal identities are `(businessId, customerId)` pairs, never `users` rows. `portalAuth` mirrors `auth`'s magic-link mechanics (hashed single-use token, atomic `DELETE ... RETURNING` consume, 15-minute expiry) but owns its own tables (`portal_auth_tokens`, `portal_sessions`), its own JWT secret (`PORTAL_JWT_SECRET`), its own cookie (`portal_session`), and a discriminated payload (`type: 'portal'`) — a leaked staff secret or a staff JWT presented under the portal cookie name is rejected outright, not merely denied by a permission check.
- **The `portal` module has no domain logic of its own.** Every route calls straight into the existing `invoicing`/`estimates`/`customers` services — the same functions the staff SPA uses — then re-checks the fetched entity's `customerId` against the authenticated session before returning it. This is a deliberate choice: duplicating query logic per-audience would drift; a single ownership check at the portal route layer is the only new code path, and it's the same shape on every route (fetch → compare `customerId` → 404 if mismatched, never 403 — existence of another customer's document is not confirmed).
- **`AuditRecordCtx` vs `AuditCtx`.** Portal-initiated mutations (estimate accept/decline) have no staff actor. Rather than widen the pervasive `AuditCtx.userId` (reused everywhere for `createdBy`/`updatedBy` NOT NULL columns), `audit.record` alone accepts a wider `AuditRecordCtx` (`userId: string | null`). A real `AuditCtx` is still assignable to it, so this is additive — only the portal's own call sites construct a `userId: null` ctx. Where a DB column still needs a non-null actor (`estimates.updated_by`), a null portal actor falls back to the estimate's own `createdBy`; the audit log itself correctly shows no staff involvement.
- **Two Hono `Variables` shapes, never merged.** `AppEnv` (staff) and `PortalEnv` (portal) share no keys — `requirePortalAuth` sets `portalBusinessId`/`portalCustomerId`/`portalSid`, `requireAuth` sets `userId`/`businessId`/`role`/etc. A route mounted under `/portal` is typed against `PortalEnv` only; it cannot accidentally read a staff variable that was never set.
- **Separate deployable frontend.** `portal/` is its own pnpm workspace package (own `package.json`, Vite config, port 5174) — not a route added to `web/`. It imports nothing from `web/` and vice versa; the only shared code is `@koosani/shared` (Zod schemas, primitives), same as `web`/`api` already share.

---

## 5. Database schema (overview)

Detailed column lists live in Drizzle schema files. This section is the high-level relationship map.

```
businesses ──┬── users ──┬── user_sessions
             │           ├── auth_logs
             │           └── user_permissions (per-user resource+action grants — SECURITY.md §Authorization Model)
             │      └────── audit_logs
             │
             ├── customers ──── customer_contacts
             ├── suppliers ──── supplier_contacts
             ├── items ──┬── item_categories
             │           └── stock_movements
             │
             ├── invoices ──┬── invoice_lines
             │              ├── payments_received
             │              └── credit_notes ── credit_note_lines
             │
             ├── bills ──┬── bill_lines
             │           └── payments_made
             │
             ├── purchase_orders ──┬── po_lines
             │                     └── grns ── grn_lines
             │
             └── gst_periods ── gst_returns (MIRA 205 / 206 export snapshots)
```

All tables have `business_id` (multi-tenant key), `created_at`, `updated_at`, `created_by`, `updated_by`. Soft-delete via `deleted_at` only where business semantics need it (customers, suppliers, items); never on financial documents.

---

## 6. Request lifecycle (typical authenticated POST)

1. Hono receives request, parses cookie → middleware verifies JWT signature.
2. Middleware checks `token_version` and session `is_active` (cached 30s per `(user_id, sid)`).
3. Route handler validates body with Zod schema (rejects with 400 on failure, generic message).
4. Route calls service method with the typed, validated payload + auth context.
5. Service opens transaction, calls repositories, enforces invariants, writes `audit_logs` row inside the same transaction.
6. Service enqueues any async work (PDF, email) **after** transaction commits.
7. Response shaped by route (never expose internal IDs of other businesses, never echo Drizzle row directly).
8. Pino logs request with `req_id`, `user_id`, `business_id`, latency.

---

## 7. Frontend architecture (web)

> This section describes `web/`, the staff SPA. The customer portal (`portal/`, Phase 28 — §4.9) is a **separate** pnpm workspace package with its own Vite config, router, and Pinia store; it follows the same conventions below but is not part of `web/` and shares no runtime code with it beyond `@koosani/shared`.

- Vue 3 + `<script setup lang="ts">` everywhere — TypeScript strict, no JS source. No Options API.
- **Pinia** stores: one per module (`useAuthStore`, `useCustomersStore`, `useInvoicingStore`, …) plus a global `useUiStore` (theme/dark-mode preference, layout state). Stores own server-state caching and optimistic update logic.
- **Router** is module-scoped: each module exports its `routes` array, app composes them.
- **API client** is a single `apiFetch` wrapper that handles cookies, 401 → redirect to login, 403 → toast, 5xx → toast. Modules don't call `fetch` directly.
- **PrimeVue** for all interactive components (DataTable, Dialog, Calendar, Dropdown). **No Tailwind utility classes inside PrimeVue component slots** — style via PrimeVue pass-through (`pt`) or its theme; Tailwind is for layout/spacing on plain markup.
- **Forms**: every form has a Zod schema _shared with the api_ (lives in `shared/` package). Frontend validates with the same schema for instant feedback; backend re-validates as source of truth.
- **Charts**: Chart.js via `vue-chartjs` thin wrapper. One chart component per chart type — no generic mega-chart.

---

## 8. Async jobs (worker)

Driven by **BullMQ** on Redis. One queue per job class:

| Queue         | Job                                                                                                       | Worker registered?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf`         | Render invoice PDF, PO PDF, customer/supplier SOA PDF, estimate PDF                                       | ✅ `registerPdfWorker` (Phase 23, extended Phase 25 for estimates) — templates in `api/src/lib/pdf/`. Credit note PDF is not implemented (no documented route ever existed for it; see FUNCTIONS.md note). Routes enqueue and synchronously await the job (`lib/pdfClient.ts`) rather than polling, so rendering still runs in the worker (CPU isolation) while the API contract stays a single `GET .../pdf → { url }`.                                                                                                                                                                                                                                                                                                                                                              |
| `email`       | Send invoice (PDF attached), payment receipt, statement (PDF attached), reminder, estimate (PDF attached) | ✅ `registerEmailWorker` (Phase 24, extended Phase 25 for estimates). Fire-and-forget — routes enqueue and return immediately, unlike `pdf`'s wait-for-completion. Auth emails (magic link, reset, invite) are unaffected — those still send synchronously in-route via `lib/mailer.ts`, not through this queue. Every send/failure is logged to `email_logs` (`modules/emailLogs`).                                                                                                                                                                                                                                                                                                                                                                                                  |
| `reminders`   | Daily dunning scan (invoices) + estimate expiry sweep + recurring invoice generation                      | ✅ `registerRemindersWorker`, scheduled 08:00 Maldives time (Phase 24, extended Phase 25 and 26). Per-business dunning schedule is `businesses.reminderScheduleDays` (day offsets from due date, e.g. `[-3,0,7,14]`); per-invoice opt-out is `invoices.remindersEnabled`. Idempotency: `invoice_reminders_sent`'s unique index on `(invoice_id, offset_days)` guarantees each dunning offset fires at most once even if the scan runs twice. The estimate-expiry half transitions `sent` estimates past `expiry_date` to `expired` — naturally idempotent, no dedup table needed. The recurrence half (§4.7) generates one invoice per due `recurrence_profiles` row, advancing `next_run_date` under a row lock before creating anything, so a duplicate scan can't double-generate. |
| `gst`         | Build MIRA 205 / 206 export bundle for a period                                                           | ✅ `registerGstWorker`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `soa-extract` | Parse uploaded supplier SOA (PDF/CSV) → match to bills                                                    | ✅ `soaExtractWorker` (was defined but never registered until Phase 20 — UPGRADE.md F-20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `reconcile`   | Nightly: verify `items.stock_on_hand` matches `SUM(stock_movements)`                                      | ✅ `registerReconcileWorker`, scheduled nightly at 02:00 `Indian/Maldives` via `reconcileQueue.upsertJobScheduler` (Phase 20 — UPGRADE.md F-21). The scheduled job carries no `businessId` and fans out across every business (`inventory.listAllBusinessIds`); a job with an explicit `businessId` scopes to just that one.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Jobs are **idempotent**. Each takes a domain ID (e.g., `invoiceId`) and re-reads current state; never trust payload to carry mutable data.

**Worker process entrypoint:** `api/src/worker.ts` — calls `registerWorkers()` (`api/src/worker/index.ts`) and stays alive with graceful shutdown on `SIGTERM`/`SIGINT`. Run via `pnpm --filter @koosani/api worker` (prod) or `pnpm dev:worker` from the repo root (dev, alongside `pnpm dev`). This entrypoint did not exist before Phase 20 — `registerWorkers()` was defined but nothing ever called it outside of tests, so no worker (including `gst` and `soa-extract`) ever ran in a real deployment.

---

## 9. File storage

- Object storage (S3-compatible). Bucket per environment.
- Uploads go through api → virus scan (ClamAV sidecar or hosted) → bucket.
- Downloads are **signed URLs** (5-minute expiry), generated by api per-request after permission check.
- User-uploaded files never served from the api origin directly.

---

## 10. Configuration & secrets

- All config from env vars. Loaded once at boot, validated with Zod, frozen.
- Required vars validated on boot — process exits if any missing or malformed (per SECURITY.md pattern).
- Secrets (JWT_SECRET, DB password, S3 keys, SMTP password) come from the platform's secret manager, never committed.

---

## 11. Observability

- **Pino** structured logs (JSON in prod, pretty in dev). Every log line has `req_id`, `user_id` (if auth'd), `business_id` (if scoped), `module`.
- Health endpoint: `GET /healthz` (liveness, no DB) and `GET /readyz` (DB + Redis ping).
- Errors caught by Hono error middleware → logged with stack → response is generic `{ error: 'internal' }` (never leak stack to client).

---

## 11.5 Pagination convention

All list endpoints use **offset-based pagination** via `page` (1-indexed) + `pageSize` query params.

- Default `pageSize`: 50
- Maximum `pageSize`: 200
- Response shape: `{ items: T[], total: number, page: number, pageSize: number }`

Cursor-based pagination may be introduced for high-volume lists in a later phase.

---

## 12. What lives where (directory layout)

```
/
├── api/
│   ├── src/
│   │   ├── modules/<name>/{routes,service,repository,schema}.ts
│   │   ├── db/{schema,migrations,client}.ts
│   │   ├── middleware/          (requireAuth, authorize — role/permission gates)
│   │   ├── lib/                 (money, dates, mailer, queue, virusScan, rateLimiter)
│   │   ├── worker/              (job handlers)
│   │   ├── worker.ts            (worker process entrypoint — §8)
│   │   └── server.ts
│   └── package.json
├── web/
│   ├── src/
│   │   ├── modules/<name>/{views,components,store,routes,api}.ts
│   │   ├── shared/              (apiFetch, layout, ui)
│   │   ├── router.ts
│   │   └── main.ts
│   └── package.json
├── portal/                      (customer portal SPA, Phase 28 — §4.9, separate from web/)
│   ├── src/
│   │   ├── views/                (invoices, estimates, statement, login/verify)
│   │   ├── stores/auth.ts
│   │   ├── lib/apiFetch.ts
│   │   ├── router/index.ts
│   │   └── main.ts
│   └── package.json
├── shared/                      (Zod schemas + TS types used by both)
│   └── src/<name>.ts
├── ARCHITECTURE.md
├── STACK.md
├── SECURITY.md
├── DESIGN.md
├── FUNCTIONS.md
├── CHANGELOG.md
├── CLAUDE.md
└── PROMPTS.md
```

---

## 13. Change protocol

When you change architecture, update this file in the same PR. Bullet list of changes goes into `CHANGELOG.md` under the next unreleased version with a link to the affected section here.
