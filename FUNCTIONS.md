# Functions

> Public surface of each module — the contract Claude Code reads instead of grepping. Keep signatures, not implementations. When a signature changes, update the matching row here in the same PR.
>
> Notation:
>
> - `route` = HTTP endpoint (auth required unless marked `public`)
> - `svc` = service-layer function (callable from other services)
> - `repo` = repository-layer function (DB only, no business rules)
>
> Every authenticated route receives an implicit `ctx` with `{ userId, businessId, role, ip }`. Not shown in signatures.
>
> **Authorization middleware** (`api/src/middleware/authorize.ts`, Phase 20 — SECURITY.md §Authorization Model): `requireRole(minRole)` and `requirePermission(resource, action)` are applied per-route alongside `requireAuth`, not shown per-row below except where they gate an otherwise-undocumented action (e.g. admin-only). `hasPermission(role, userId, resource, action)` is the underlying check, also used directly by `reports` routes for the `export` action.

---

## Module: `auth`

| Kind         | Name                           | Signature                                                                                      | Purpose                                                                                                   |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| route public | `POST /auth/login`             | `{ email, password }` → `{ user, permissions }` + cookie                                       | Password login                                                                                            |
| route public | `POST /auth/magic-link`        | `{ email }` → `204`                                                                            | Request magic link                                                                                        |
| route public | `POST /auth/magic-link/verify` | `{ token }` → `{ user, permissions }` + cookie                                                 | Consume magic link                                                                                        |
| route public | `POST /auth/forgot-password`   | `{ email }` → `204`                                                                            | Request reset link                                                                                        |
| route public | `POST /auth/reset-password`    | `{ token, password }` → `204`                                                                  | Set new password                                                                                          |
| route public | `POST /auth/accept-invite`     | `{ token, password }` → `{ user, permissions }` + cookie                                       | Activate invited account                                                                                  |
| route        | `POST /auth/logout`            | `{}` → `204`                                                                                   | Logout current session                                                                                    |
| route        | `POST /auth/logout-all`        | `{}` → `204`                                                                                   | Bump token_version, revoke all sessions                                                                   |
| route        | `POST /auth/logout-others`     | `{}` → `204`                                                                                   | Revoke all sessions except current                                                                        |
| route        | `POST /auth/change-password`   | `{ currentPassword, newPassword }` → `204` + fresh cookie                                      | Self-service; revokes other sessions, keeps current one alive with a re-signed JWT (Phase 21, UPGRADE.md) |
| route        | `GET  /admin/activity`         | `?event&userId&page` → `{ items, total, page, pageSize }`                                      | Admin only; joins `auth_logs` with `users` (SECURITY.md §Auth Event Logging, Phase 21)                    |
| route        | `GET  /me`                     | `→ { ...profile, permissions, sessions }`                                                      | Bootstrap on page load; `permissions` is the real explicit-grant list as of Phase 21 (was hardcoded `[]`) |
| svc          | `auth.issueSession`            | `(user, { ip, ua }) → { sid, jwt }`                                                            | Used by login, magic-link, invite                                                                         |
| svc          | `auth.verifyToken`             | `(jwt) → JwtPayload \| null`                                                                   | Current secret then `JWT_SECRET_PREVIOUS`                                                                 |
| svc          | `auth.toProfile`               | `(user) → MeProfile`                                                                           | Shapes user row for API responses                                                                         |
| svc          | `auth.changePassword`          | `(user, currentSid, currentPassword, newPassword, ctx) → { ok, jwt } \| { ok: false, reason }` | Verifies current password, bumps token_version, re-signs current session                                  |

---

## Module: `users`

Admin only, every route (FUNCTIONS.md convention: user management is not permission-grantable like the domain resources — SECURITY.md §Authorization Model).

| Kind  | Name                | Signature                                                            | Purpose                                                                                                                        |
| ----- | ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| route | `GET  /users`       | `?q&role&page&pageSize` → `{ items: User[], total, page, pageSize }` | List with offset pagination                                                                                                    |
| route | `GET  /users/:id`   | → `User & { permissions: Permission[] }`                             | Detail + explicit grant list                                                                                                   |
| route | `POST /users`       | `{ email, name, role, permissions? }` → `User`                       | Creates (no password) + emails a 7-day invite token                                                                            |
| route | `PATCH /users/:id`  | `{ name?, role?, permissions? }` → `User & { permissions }`          | `permissions` is a full-replace of the grant set, not a diff                                                                   |
| route | `DELETE /users/:id` | → `204`                                                              | Soft delete + revoke all sessions; rejects deleting your own account                                                           |
| svc   | `users.create`      | `(businessId, UserCreate, ctx) → User`                               | Rejects if email already exists (global unique); generates invite token via `auth.generateToken`/`sha256`, sends `inviteEmail` |
| svc   | `users.update`      | `(businessId, id, UserPatch, ctx) → User & { permissions }`          | —                                                                                                                              |
| svc   | `users.softDelete`  | `(businessId, id, ctx) → void`                                       | —                                                                                                                              |

---

## Module: `permissions`

Not exposed via routes — a thin service/repository backing `user_permissions`, called by `middleware/authorize.ts` (`hasExplicitGrant`), `users` (`replaceForUser`/`listForUser`), and `auth` (`listForUser` for `/me` and login responses).

| Kind | Name                         | Signature                                                  | Purpose                                                                 |
| ---- | ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| svc  | `permissions.listForUser`    | `(userId, tx?) → Permission[]`                             | Pass `tx` when reading back inside the same transaction that just wrote |
| svc  | `permissions.replaceForUser` | `(businessId, userId, Permission[], grantedBy, tx) → void` | Deletes all existing grants for the user, then inserts the new set      |

---

## Module: `customers`

| Kind  | Name                             | Signature                                                                  | Purpose                                                                                                                              |
| ----- | -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| route | `GET    /customers`              | `?q&page&pageSize&active` → `{ items: Customer[], total, page, pageSize }` | List with offset pagination (ARCHITECTURE.md §11.5)                                                                                  |
| route | `GET    /customers/:id`          | → `Customer & { contacts, balance }`                                       | Detail + outstanding balance                                                                                                         |
| route | `POST   /customers`              | `CustomerCreate` → `Customer`                                              | `currency` optional, defaults `'MVR'` — default document currency for this customer's invoices/estimates (Phase 30, UPGRADE.md G-10) |
| route | `PATCH  /customers/:id`          | `CustomerPatch` → `Customer`                                               | —                                                                                                                                    |
| route | `DELETE /customers/:id`          | → `204`                                                                    | Soft delete (must have zero balance + no draft invoices)                                                                             |
| route | `GET    /customers/:id/soa`      | `?from&to&format=json\|pdf` → `Soa \| { url }`                             | Statement of account; pdf rate-limited 10/min/user (Phase 23, UPGRADE.md)                                                            |
| route | `POST   /customers/:id/soa/send` | `StatementSendBody { from, to }` → `{ queued: true }` (202)                | Emails the statement PDF to the customer on file; 10/min/user (Phase 24, UPGRADE.md G-3)                                             |
| route | `POST   /customers/:id/contacts` | `Contact` → `Contact`                                                      | —                                                                                                                                    |
| svc   | `customers.assertExists`         | `(id, businessId) → Customer`                                              | Throws if not in `business_id`                                                                                                       |
| svc   | `customers.outstandingBalance`   | `(id, businessId) → Decimal`                                               | Sum of issued invoices − payments                                                                                                    |
| svc   | `customers.buildSoa`             | `(businessId, id, from, to) → Soa`                                         | Aggregates invoices, credit_notes, payments_received; running balance per entry                                                      |

---

## Module: `suppliers`

| Kind  | Name                             | Signature                                                              | Purpose                                                                                                                            |
| ----- | -------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| route | `GET    /suppliers`              | `?q&page&active` → `Supplier[]`                                        | —                                                                                                                                  |
| route | `GET    /suppliers/:id`          | → `Supplier & { contacts, balance }`                                   | —                                                                                                                                  |
| route | `POST   /suppliers`              | `SupplierCreate` → `Supplier`                                          | —                                                                                                                                  |
| route | `PATCH  /suppliers/:id`          | `SupplierPatch` → `Supplier`                                           | —                                                                                                                                  |
| route | `DELETE /suppliers/:id`          | → `204`                                                                | Soft delete (must have zero balance + no draft bills)                                                                              |
| route | `GET    /suppliers/:id/soa`      | `?from&to&format=json\|pdf` → `{ entries, closingBalance } \| { url }` | Delegates to `purchases.buildSupplierSoa`; pdf rate-limited 10/min/user (Phase 23, UPGRADE.md — `format` was previously json-only) |
| route | `POST   /suppliers/:id/contacts` | `Contact` → `Contact`                                                  | —                                                                                                                                  |
| svc   | `suppliers.outstandingBalance`   | `(id) → Decimal`                                                       | Sum of bills − payments made                                                                                                       |
| svc   | `suppliers.buildSoa`             | `(id, from, to) → Soa`                                                 | —                                                                                                                                  |

---

## Module: `items`

| Kind  | Name                      | Signature                                                   | Purpose                                                                 |
| ----- | ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| route | `GET    /items`           | `?q&categoryId&active` → `Item[]`                           | —                                                                       |
| route | `GET    /items/:id`       | → `Item & { stockOnHand, lastCost }`                        | —                                                                       |
| route | `POST   /items`           | `ItemCreate` → `Item`                                       | SKU unique per business                                                 |
| route | `PATCH  /items/:id`       | `ItemPatch & { gstCategoryChangeReason?: string }` → `Item` | GST category change requires `gstCategoryChangeReason`; logged in audit |
| route | `DELETE /items/:id`       | → `204`                                                     | Soft delete (must have zero stock + no active references)               |
| route | `GET    /item-categories` | → `Category[]`                                              | —                                                                       |
| route | `POST   /item-categories` | `{ name, parentId? }` → `Category`                          | —                                                                       |
| svc   | `items.priceFor`          | `(itemId, customerId?) → { price, gstRate, gstCategory }`   | Resolves customer-specific overrides if any                             |

---

## Module: `inventory`

| Kind  | Name                          | Signature                                                  | Purpose                                                                                   |
| ----- | ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| route | `GET  /inventory/movements`   | `?itemId&from&to&page` → `Movement[]`                      | —                                                                                         |
| route | `GET  /inventory/on-hand`     | `?categoryId&belowReorder` → `[{ item, qty }]`             | —                                                                                         |
| route | `POST /inventory/adjustments` | `{ itemId, qty, reason }` → `Movement`                     | Manual adjustment (write-off, recount)                                                    |
| route | `POST /inventory/stock-count` | `{ counts: [{ itemId, qty }] }` → `{ adjustmentsCreated }` | Bulk recount                                                                              |
| svc   | `inventory.applyMovement`     | `(itemId, qty, source, sourceId, tx) → void`               | The only function that writes `stock_movements`. Takes a tx; caller controls transaction. |
| svc   | `inventory.assertAvailable`   | `(itemId, qty, tx) → void`                                 | Throws if would go negative (unless backorder flag)                                       |
| repo  | `inventory.recomputeOnHand`   | `(itemId, tx) → Decimal`                                   | Used by nightly reconcile                                                                 |

---

## Module: `invoicing`

| Kind  | Name                                 | Signature                                                 | Purpose                                                                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| route | `GET    /invoices`                   | `?status&customerId&from&to&q&page` → `Invoice[]`         | —                                                                                                                                                                                                                                                                                                                   |
| route | `GET    /invoices/:id`               | → `Invoice & { lines, payments, creditNotes }`            | —                                                                                                                                                                                                                                                                                                                   |
| route | `POST   /invoices`                   | `InvoiceDraftCreate` → `Invoice`                          | Creates draft, no number, no stock movement. `currency` optional (defaults to the customer's own), snapshots an exchange rate + MVR-equivalent totals (Phase 30, UPGRADE.md G-10)                                                                                                                                   |
| route | `PATCH  /invoices/:id`               | `InvoiceDraftPatch` → `Invoice`                           | Drafts only                                                                                                                                                                                                                                                                                                         |
| route | `POST   /invoices/:id/issue`         | `{}` → `Invoice`                                          | Allocates number, commits stock, locks row                                                                                                                                                                                                                                                                          |
| route | `POST   /invoices/:id/void`          | `{ reason }` → `Invoice`                                  | Issued only; creates reversing credit note (copies currency/rate/Mvr verbatim). Active payments are reversed and credited back to the customer as MVR-equivalent credit rather than blocking the void (Phase 27 F-14; Phase 30 currency conversion)                                                                 |
| route | `GET    /invoices/:id/pdf`           | → `{ url }` (signed URL)                                  | Renders via `pdf` queue (Phase 23, UPGRADE.md)                                                                                                                                                                                                                                                                      |
| route | `POST   /invoices/:id/payments`      | `{ amount, method, ref?, paidAt }` → `Payment`            | Also enqueues a `receipt` email (Phase 24). An amount exceeding what's outstanding is capped, and the excess becomes MVR-equivalent customer credit rather than being rejected (Phase 27 F-15). Snapshots the exchange rate at `paidAt` and records realized gain/loss vs. the invoice's issue-date rate (Phase 30) |
| route | `DELETE /invoices/:id/payments/:pid` | → `204`                                                   | Reverses payment                                                                                                                                                                                                                                                                                                    |
| route | `POST   /invoices/:id/apply-credit`  | `ApplyCreditBody { amount }` → `Payment` (201)            | Consumes the customer's credit balance; recorded as `method: 'credit'` (Phase 27, UPGRADE.md G-7). Rejects (422) if the invoice isn't MVR-denominated — the credit ledger has no currency dimension (Phase 30)                                                                                                      |
| route | `POST   /invoices/:id/write-off`     | `InvoiceVoidBody { reason }` → `Payment` (201)            | Bad-debt write-off, no cash movement; `method: 'write_off'` (Phase 27, UPGRADE.md G-7)                                                                                                                                                                                                                              |
| route | `POST   /invoices/:id/send`          | → `{ queued: true }` (202)                                | Emails the invoice PDF to the customer on file; 20/min/user (Phase 24, UPGRADE.md G-3)                                                                                                                                                                                                                              |
| route | `PATCH  /invoices/:id/reminders`     | `InvoiceRemindersPatch { enabled }` → `Invoice`           | Per-invoice dunning opt-out (Phase 24, UPGRADE.md G-4)                                                                                                                                                                                                                                                              |
| route | `GET    /invoices/:id/emails`        | → `EmailLog[]`                                            | Delivery history — sends, receipts, reminders (Phase 24)                                                                                                                                                                                                                                                            |
| route | `GET    /credit-notes`               | `?customerId&from&to` → `CreditNote[]`                    | —                                                                                                                                                                                                                                                                                                                   |
| route | `POST   /credit-notes`               | `CreditNoteCreate` → `CreditNote`                         | References an issued invoice                                                                                                                                                                                                                                                                                        |
| route | `POST   /credit-notes/:id/issue`     | `{}` → `CreditNote`                                       | Allocates number, reverses stock                                                                                                                                                                                                                                                                                    |
| svc   | `invoicing.createDraft`              | `(businessId, data, ctx) → Invoice & { lines }`           | Creates draft; GST rates preliminary. Snapshots currency (customer default or override) + exchange rate + MVR-equivalent totals, preview only (Phase 30)                                                                                                                                                            |
| svc   | `invoicing.patchDraft`               | `(businessId, id, data, ctx) → Invoice & { lines }`       | Drafts only; replaces lines if provided; refreshes the exchange rate snapshot on every patch (Phase 30)                                                                                                                                                                                                             |
| svc   | `invoicing.issue`                    | `(businessId, invoiceId, ctx) → Invoice`                  | Number, stock, GST snapshot, audit. Also re-snapshots the exchange rate at `issueDate` and freezes MVR-equivalent totals (Phase 30)                                                                                                                                                                                 |
| svc   | `invoicing.voidInvoice`              | `(businessId, invoiceId, reason, ctx) → Invoice`          | Auto-issues reversing CN (copies currency/rate/Mvr verbatim); reverses stock; reverses active payments and grants MVR-equivalent customer credit for each (Phase 27; Phase 30)                                                                                                                                      |
| svc   | `invoicing.addPayment`               | `(businessId, invoiceId, data, ctx) → Payment`            | Syncs paidAmount(+Mvr), derives status; enqueues a `receipt` email after commit (Phase 24) — skipped for `method: 'write_off'`. Caps at outstanding, credits the MVR-equivalent excess (Phase 27; Phase 30). Snapshots the payment-date exchange rate and records realized gain/loss (Phase 30)                     |
| svc   | `invoicing.applyCreditToInvoice`     | `(businessId, invoiceId, amount, ctx) → Payment`          | Debits `customerCredits`, inserts a `method: 'credit'` payment (Phase 27, UPGRADE.md G-7). Throws `ValidationError` for a non-MVR invoice (Phase 30)                                                                                                                                                                |
| svc   | `invoicing.writeOffInvoice`          | `(businessId, invoiceId, reason, ctx) → Payment`          | Thin wrapper over `addPayment` with `method: 'write_off'` for the full outstanding amount (Phase 27)                                                                                                                                                                                                                |
| svc   | `invoicing.listReminderCandidates`   | `(businessId) → Invoice[]`                                | Issued/partially-paid, opted-in, has a due date — used by the reminders worker (Phase 24)                                                                                                                                                                                                                           |
| svc   | `invoicing.setRemindersEnabled`      | `(businessId, invoiceId, enabled, ctx) → Invoice`         | Backs `PATCH /invoices/:id/reminders`; audited as `invoice.reminders_toggled`                                                                                                                                                                                                                                       |
| svc   | `invoicing.reversePayment`           | `(businessId, invoiceId, paymentId, ctx) → void`          | Marks reversed, re-syncs paidAmount                                                                                                                                                                                                                                                                                 |
| svc   | `invoicing.createCreditNote`         | `(businessId, data, ctx) → CreditNote & { lines }`        | Draft CN against issued invoice; always the invoice's own currency, rated fresh at today (Phase 30, mirrors its independent GST re-rating)                                                                                                                                                                          |
| svc   | `invoicing.issueCreditNote`          | `(businessId, creditNoteId, ctx) → CreditNote`            | Allocates CN number, reverses stock                                                                                                                                                                                                                                                                                 |
| svc   | `invoicing.computeTotals`            | `(lines) → Totals`                                        | Pure function — see ARCHITECTURE.md §4.1                                                                                                                                                                                                                                                                            |
| svc   | `invoicing.assertNotLocked`          | `(businessId, date, ctx) → void`                          | Rejects if `date` falls in a locked GST period                                                                                                                                                                                                                                                                      |
| svc   | `invoicing.setEstimateLink`          | `(businessId, invoiceId, estimateId, tx) → void`          | Sets `invoices.estimate_id`; used only by `estimates.convertToInvoice`, inside its own tx (Phase 25)                                                                                                                                                                                                                |
| svc   | `invoicing.setRecurrenceLink`        | `(businessId, invoiceId, recurrenceProfileId, tx) → void` | Sets `invoices.recurrence_profile_id`; used only by `recurrence.generateFromProfile`, inside its own tx (Phase 26)                                                                                                                                                                                                  |

`Invoice` gains `estimateId: string \| null` (Phase 25, UPGRADE.md G-5) — traces back to the estimate this invoice was converted from, if any. And `recurrenceProfileId: string \| null` (Phase 26, UPGRADE.md G-6) — traces back to the recurrence profile that generated it, if any.

---

## Module: `estimates`

Mirrors `invoicing`'s draft pattern (Phase 25, UPGRADE.md G-5): draft → sent → accepted/declined/expired. No stock reservation, no GST period lock at any status — see ARCHITECTURE.md §4.6.

| Kind  | Name                                                      | Signature                                                                | Purpose                                                                                                                                                                                                                                                                                                          |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| route | `GET    /estimates`                                       | `?status&customerId&from&to&q&page` → `{ items, total, page, pageSize }` | Joined with `customers` for `customerName`                                                                                                                                                                                                                                                                       |
| route | `GET    /estimates/:id`                                   | → `Estimate & { lines, customerName }`                                   | —                                                                                                                                                                                                                                                                                                                |
| route | `POST   /estimates`                                       | `EstimateDraftCreate` → `Estimate & { lines }`                           | Creates draft, no number. `currency` optional (defaults to the customer's own), Phase 30                                                                                                                                                                                                                         |
| route | `PATCH  /estimates/:id`                                   | `EstimateDraftPatch` → `Estimate & { lines }`                            | Drafts only                                                                                                                                                                                                                                                                                                      |
| route | `POST   /estimates/:id/send`                              | `{}` → `Estimate`                                                        | Allocates number, transitions to `sent`, enqueues an `estimate` email (PDF attached)                                                                                                                                                                                                                             |
| route | `POST   /estimates/:id/accept`                            | `{}` → `Estimate`                                                        | Staff-recorded. Also called by `portal` (Phase 28) with a null-actor ctx after its own ownership check                                                                                                                                                                                                           |
| route | `POST   /estimates/:id/decline`                           | `{}` → `Estimate`                                                        | Staff-recorded. Also called by `portal` (Phase 28)                                                                                                                                                                                                                                                               |
| route | `POST   /estimates/:id/convert`                           | `{}` → `{ estimate, invoiceId }` (201)                                   | Copies lines into a new draft invoice; rejects if already converted or not sent/accepted                                                                                                                                                                                                                         |
| route | `GET    /estimates/:id/pdf`                               | → `{ url }` (signed URL)                                                 | Renders via `pdf` queue, 20/min/user                                                                                                                                                                                                                                                                             |
| route | `GET    /estimates/:id/emails`                            | → `EmailLog[]`                                                           | Delivery history                                                                                                                                                                                                                                                                                                 |
| svc   | `estimates.createDraft`                                   | `(businessId, data, ctx) → Estimate & { lines }`                         | GST computed for display only (no `gst.assertPeriodOpen`); `expiryDate` defaults to `businesses.defaultEstimateValidityDays`. Also snapshots currency/exchange rate/MVR totals (Phase 30)                                                                                                                        |
| svc   | `estimates.patchDraft`                                    | `(businessId, id, data, ctx) → Estimate & { lines }`                     | Drafts only; replaces lines if provided; refreshes the exchange rate snapshot on every patch (Phase 30)                                                                                                                                                                                                          |
| svc   | `estimates.send`                                          | `(businessId, id, ctx) → Estimate`                                       | Advisory-locked number allocation (`estimate_number_prefix`, default `EST-`), then enqueues email                                                                                                                                                                                                                |
| svc   | `estimates.markAccepted` / `markDeclined` / `markExpired` | `(businessId, id, ctx: AuditRecordCtx) → Estimate`                       | Only from `sent`; each audits its own action name. `ctx.userId` may be `null` (portal-initiated, Phase 28) — `estimates.updated_by` falls back to the estimate's own `createdBy` when so, since that DB column is NOT NULL                                                                                       |
| svc   | `estimates.convertToInvoice`                              | `(businessId, id, ctx) → { estimate, invoiceId }`                        | Re-prices lines via a fresh `invoicing.createDraft` call (does not copy stale GST snapshots); carries the estimate's `currency` through explicitly, but the new invoice re-snapshots its own exchange rate fresh (Phase 30); sets `estimates.converted_at` (blocks double-conversion) and `invoices.estimate_id` |
| svc   | `estimates.listExpiryCandidates`                          | `(businessId) → Estimate[]`                                              | `sent` estimates — the reminders worker filters by `expiryDate < today`                                                                                                                                                                                                                                          |

`EstimateDraftCreate`/`EstimateDraftPatch` (`shared/src/estimates.ts`) mirror `InvoiceDraftCreate`/`InvoiceDraftPatch`. `PermissionResource` gains `'estimates'` (shared/src/primitives.ts; also added to `UserDrawer.vue`'s permission grid).

---

## Module: `recurrence`

Recurring invoice profiles (Phase 26, UPGRADE.md G-6) — see ARCHITECTURE.md §4.7. Late fees are explicitly not implemented.

| Kind  | Name                                       | Signature                                                                       | Purpose                                                                                                                                                                                                               |
| ----- | ------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| route | `GET    /recurrence-profiles`              | `?active&customerId&q&page` → `{ items, total, page, pageSize }`                | Joined with `customers` for `customerName`                                                                                                                                                                            |
| route | `GET    /recurrence-profiles/:id`          | → `RecurrenceProfile & { lines, customerName }`                                 | —                                                                                                                                                                                                                     |
| route | `POST   /recurrence-profiles`              | `RecurrenceProfileCreate` → `RecurrenceProfile & { lines }`                     | `nextRunDate` defaults to `startDate`                                                                                                                                                                                 |
| route | `PATCH  /recurrence-profiles/:id`          | `RecurrenceProfilePatch` → `RecurrenceProfile & { lines }`                      | `customerId`/`startDate` are immutable post-create — not patchable                                                                                                                                                    |
| route | `POST   /recurrence-profiles/:id/generate` | `{}` → `{ profile, invoiceId }` (201) or `422` if not due                       | Manual "run now" (support/testing); the daily cron is the normal path                                                                                                                                                 |
| svc   | `recurrence.createProfile`                 | `(businessId, RecurrenceProfileCreate, ctx) → RecurrenceProfile & { lines }`    | Rejects `endDate < startDate`                                                                                                                                                                                         |
| svc   | `recurrence.patchProfile`                  | `(businessId, id, RecurrenceProfilePatch, ctx) → RecurrenceProfile & { lines }` | Full-replace of lines if `lines` provided                                                                                                                                                                             |
| svc   | `recurrence.generateFromProfile`           | `(businessId, id, ctx) → { profile, invoiceId } \| null`                        | `null` if not due/inactive/past end date. Advances `nextRunDate` under a row lock _before_ creating the invoice (ARCHITECTURE.md §4.7); `autoIssue` profiles call `invoicing.issue` immediately, others leave a draft |
| svc   | `recurrence.listDueProfiles`               | `(businessId, today) → RecurrenceProfile[]`                                     | Active, `nextRunDate <= today`, within date range — used by the reminders worker's daily scan                                                                                                                         |

`RecurrenceProfileCreate`/`RecurrenceProfilePatch` (`shared/src/recurrence.ts`) mirror the estimate/invoice draft pattern. `PermissionResource` gains `'recurring'`. `advanceByFrequency`/`addMonths`/`daysBetween` (`shared/src/dates.ts`) back the date arithmetic.

---

## Module: `customerCredits`

Append-only credit ledger (Phase 27, UPGRADE.md G-7) — see ARCHITECTURE.md §4.8. Mounted under `/customers` in `server.ts` (own routes file, not nested in `customers/routes.ts`, to keep the ledger's cross-cutting concern separate from customer CRUD).

| Kind  | Name                                      | Signature                                                               | Purpose                                                                                                                                                                             |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| route | `GET  /customers/:id/credits`             | → `{ balance, ledger: CustomerCredit[] }`                               | —                                                                                                                                                                                   |
| route | `POST /customers/:id/credits/advance`     | `{ amount, notes? }` → `CustomerCredit` (201)                           | Manually recorded retainer/advance, no invoice reference                                                                                                                            |
| route | `POST /customers/:id/credits/refund`      | `{ amount, notes? }` → `CustomerCredit` (201)                           | Money physically paid back out; rejects if it exceeds the available balance                                                                                                         |
| svc   | `customerCredits.getBalance`              | `(businessId, customerId) → string`                                     | `SUM(amount)` over the ledger, formatted to 2dp (COALESCE's zero-row fallback isn't numeric-typed, so this is normalized through `Decimal` rather than trusted as-is from Postgres) |
| svc   | `customerCredits.listLedger`              | `(businessId, customerId) → CustomerCredit[]`                           | Newest first                                                                                                                                                                        |
| svc   | `customerCredits.creditFromOverpayment`   | `(businessId, customerId, amount, paymentId, ctx, tx) → CustomerCredit` | Called by `invoicing.addPayment`, inside its own tx                                                                                                                                 |
| svc   | `customerCredits.creditFromVoidedInvoice` | `(businessId, customerId, amount, invoiceId, ctx, tx) → CustomerCredit` | Called by `invoicing.voidInvoice`, inside its own tx                                                                                                                                |
| svc   | `customerCredits.applyToInvoice`          | `(businessId, customerId, invoiceId, amount, ctx, tx) → CustomerCredit` | Called by `invoicing.applyCreditToInvoice`; locks the customer's ledger (`pg_advisory_xact_lock`) before checking the balance, throws its own `ValidationError` if insufficient     |
| svc   | `customerCredits.recordAdvance`           | `(businessId, customerId, amount, notes, ctx) → CustomerCredit`         | Backs `POST .../credits/advance`                                                                                                                                                    |
| svc   | `customerCredits.refund`                  | `(businessId, customerId, amount, notes, ctx) → CustomerCredit`         | Backs `POST .../credits/refund`; same advisory lock as `applyToInvoice`                                                                                                             |

`CustomerCredit.kind`: `'overpayment' | 'advance' | 'voided_invoice'` (positive amount, grants credit) or `'applied_to_invoice' | 'refunded'` (negative amount, consumes it). Rows are never updated. `PermissionResource` gains no new value here — credit actions are gated on `customers`/`invoices` permissions depending on which side initiates them.

---

## Module: `exchangeRates`

Manual FX rate entry, rate-at-date lookup, and the realized gain/loss ledger (Phase 30, UPGRADE.md G-10) — see ARCHITECTURE.md §4.10.

| Kind  | Name                                   | Signature                                                                     | Purpose                                                                                                                |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| route | `GET  /exchange-rates`                 | `?currency` → `{ items: ExchangeRate[] }`                                     | Any authenticated role                                                                                                 |
| route | `POST /exchange-rates`                 | `ExchangeRateCreate { currency, rate, rateDate }` → `ExchangeRate` (201)      | Admin only — feeds directly into financial totals. `currency` excludes `'MVR'` (always 1, never stored)                |
| svc   | `exchangeRates.rateAt`                 | `(businessId, currency, date) → Decimal`                                      | `MVR` → `1` always, no lookup. Otherwise: most recent rate on or before `date`; throws `NotFoundError` if none exists  |
| svc   | `exchangeRates.recordRate`             | `(businessId, currency, rate, rateDate, userId) → ExchangeRate`               | Upserts on `(businessId, currency, rateDate)`; rejects `currency: 'MVR'`                                               |
| svc   | `exchangeRates.listRates`              | `(businessId, currency?) → ExchangeRate[]`                                    | Newest first                                                                                                           |
| svc   | `exchangeRates.recordRealizedGainLoss` | `(businessId, invoiceId, paymentId, amount, tx) → FxRealizedGainLoss \| null` | Called by `invoicing.addPayment`, inside its own tx; no-op (`null`) if `amount` is zero — always true for MVR invoices |
| svc   | `exchangeRates.listGainLossByInvoice`  | `(businessId, invoiceId) → FxRealizedGainLoss[]`                              | Newest first                                                                                                           |

`CurrencyCode` (`shared/src/primitives.ts`): `'MVR' | 'USD' | 'EUR' | 'GBP'`. `ExchangeRateValue`: stringified decimal, 6dp.

---

## Module: `files`

| Kind  | Name                    | Signature                                                     | Purpose                                                                                                |
| ----- | ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| route | `POST   /files`         | `multipart { file }` → `{ id, url }`                          | Upload file; magic-byte MIME check, EXIF strip, virus scan, 25 MB cap (SECURITY.md §13.5)              |
| route | `GET    /files/:id/url` | → `{ url }`                                                   | Get 5-minute signed download URL (only for `scan_result='clean'`)                                      |
| svc   | `files.uploadFile`      | `(businessId, buffer, name, mime, ctx) → File`                | Sniffs magic bytes, strips EXIF (images), scans for viruses, SHA-256 keyed storage + DB record + audit |
| svc   | `files.getSignedUrl`    | `(businessId, fileId) → string`                               | Delegates to storage backend                                                                           |
| svc   | `files.attachToEntity`  | `(businessId, fileId, entityType, entityId, ctx, tx?) → void` | Links file to any entity; audited                                                                      |

---

## Module: `purchases`

| Kind  | Name                              | Signature                                                          | Purpose                                                     |
| ----- | --------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| route | `GET    /bills`                   | `?status&supplierId&from&to&page` → `Bill[]`                       | —                                                           |
| route | `GET    /bills/:id`               | → `Bill & { lines, payments }`                                     | —                                                           |
| route | `POST   /bills`                   | `BillDraftCreate` → `Bill & { lines }`                             | Draft; GST rates preliminary                                |
| route | `PATCH  /bills/:id`               | `BillDraftPatch` → `Bill & { lines }`                              | Drafts only; replaces lines if provided                     |
| route | `POST   /bills/:id/confirm`       | `{}` → `Bill`                                                      | Allocates number, re-snapshots GST, commits stock (grn src) |
| route | `POST   /bills/:id/payments`      | `BillPaymentCreate` → `PaymentMade`                                | Syncs paidAmount, derives status                            |
| route | `DELETE /bills/:id/payments/:pid` | → `204`                                                            | Marks reversed, re-syncs paidAmount                         |
| route | `POST   /bills/:id/attach`        | `multipart { file }` → `{ fileId }`                                | Upload + attach supplier invoice scan                       |
| route | `POST   /soa-extract`             | `multipart { file, supplierId }` → `{ jobId }`                     | Enqueues SOA extraction job                                 |
| route | `GET    /soa-extract/:jobId`      | → `{ status, matches?: [{ billId?, line }] }`                      | Poll job result                                             |
| svc   | `purchases.createDraft`           | `(businessId, data, ctx) → Bill & { lines }`                       | Creates draft; preliminary GST rates                        |
| svc   | `purchases.patchDraft`            | `(businessId, id, data, ctx) → Bill & { lines }`                   | Drafts only; replaces lines if provided                     |
| svc   | `purchases.confirmBill`           | `(businessId, billId, ctx) → Bill`                                 | Number, stock (grn), GST snapshot, period-lock, audit       |
| svc   | `purchases.addPayment`            | `(businessId, billId, data, ctx) → PaymentMade`                    | Syncs paidAmount, derives status                            |
| svc   | `purchases.reversePayment`        | `(businessId, billId, paymentId, ctx) → void`                      | Marks reversed, re-syncs paidAmount                         |
| svc   | `purchases.buildSupplierSoa`      | `(businessId, supplierId, from, to) → { entries, closingBalance }` | Aggregates confirmed bills + payments; running balance      |
| svc   | `purchases.matchSoaLine`          | `(businessId, supplierId, line) → Bill \| null`                    | ±14-day date window, ref + amount fuzzy match               |

---

## Module: `po`

| Kind  | Name                      | Signature                                                                    | Purpose                                                                                                                                                                                                                                 |
| ----- | ------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| route | `GET    /pos`             | `?status&supplierId&from&to&page` → `{ items: Po[], total, page, pageSize }` | —                                                                                                                                                                                                                                       |
| route | `GET    /pos/:id`         | → `Po & { lines, grns }`                                                     | —                                                                                                                                                                                                                                       |
| route | `POST   /pos`             | `PoDraftCreate` → `Po & { lines }`                                           | Draft                                                                                                                                                                                                                                   |
| route | `PATCH  /pos/:id`         | `PoDraftPatch` → `Po & { lines }`                                            | Drafts only; replaces lines if provided                                                                                                                                                                                                 |
| route | `POST   /pos/:id/approve` | `{}` → `Po`                                                                  | Allocates number, enqueues PDF job                                                                                                                                                                                                      |
| route | `POST   /pos/:id/cancel`  | `{ reason }` → `Po`                                                          | Blocked if any GRN exists                                                                                                                                                                                                               |
| route | `GET    /pos/:id/pdf`     | → `{ url }` (signed URL)                                                     | Renders via `pdf` queue (Phase 23, UPGRADE.md)                                                                                                                                                                                          |
| route | `POST   /pos/:id/grns`    | `GrnCreate` → `Grn & { lines }`                                              | Receive goods; commits stock via `inventory.applyMovement`                                                                                                                                                                              |
| route | `POST   /pos/:id/bill`    | `{}` → `Bill & { lines, poId }`                                              | Create draft bill pre-filled from GRN-received quantities                                                                                                                                                                               |
| route | `GET    /grns/:id`        | → `Grn & { lines }`                                                          | —                                                                                                                                                                                                                                       |
| svc   | `po.createDraft`          | `(businessId, data, ctx) → Po & { lines }`                                   | Subtotal = Σ qty×cost (no GST on POs)                                                                                                                                                                                                   |
| svc   | `po.patchDraft`           | `(businessId, id, data, ctx) → Po & { lines }`                               | Drafts only; replaces lines if provided                                                                                                                                                                                                 |
| svc   | `po.approvePo`            | `(businessId, poId, ctx) → Po`                                               | Advisory-locked number allocation. Removed a stray pre-Phase-23 `pdfQueue.add('po-pdf', ...)` call whose job data never matched any consumer's shape — PDFs are rendered on demand by `GET /pos/:id/pdf` instead (Phase 23, UPGRADE.md) |
| svc   | `po.cancelPo`             | `(businessId, poId, reason, ctx) → Po`                                       | Blocked if GRNs exist                                                                                                                                                                                                                   |
| svc   | `po.canReceive`           | `(businessId, poLineId, qty, tx?) → bool`                                    | Checks qtyReceived + qty ≤ qtyOrdered, respects `allowBackorders`                                                                                                                                                                       |
| svc   | `po.createGrn`            | `(businessId, poId, data, ctx) → Grn & { lines }`                            | Commits stock, increments `po_line.qty_received`, derives status                                                                                                                                                                        |
| svc   | `po.createBillFromPo`     | `(businessId, poId, ctx) → Bill & { poId }`                                  | Aggregates GRN qty per PO line, calls `purchases.createDraft`                                                                                                                                                                           |

---

## Module: `gst`

| Kind  | Name                              | Signature                                                                        | Purpose                                                                                                                                            |
| ----- | --------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| route | `GET  /gst/periods`               | → `Period[]`                                                                     | List with status                                                                                                                                   |
| route | `POST /gst/periods/:id/build`     | `{}` → `{ jobId }`                                                               | Enqueue MIRA 205/206 build (rate-limited 3/5 min/business — SECURITY.md §13.7)                                                                     |
| route | `GET  /gst/periods/:id/return`    | → `{ status: 'not_built'\|'built', builtAt?, summary?, files: [{ kind, url }] }` | Latest built artefacts; signed URLs for file downloads                                                                                             |
| route | `POST /gst/periods/:id/lock`      | `{ miraReturnRef }` → `Period`                                                   | Mark period filed with MIRAconnect reference; transitions to `locked`                                                                              |
| route | `POST /gst/periods/:id/unlock`    | `{ reason }` → `Period`                                                          | Admin only, fully audited                                                                                                                          |
| route | `GET  /gst/rates`                 | → `RateRow[]`                                                                    | Active and historical                                                                                                                              |
| route | `POST /gst/rates`                 | `{ category, rate, validFrom }` → `RateRow`                                      | Admin only                                                                                                                                         |
| svc   | `gst.buildReturn`                 | `(businessId, periodId, ctx) → GstReturn`                                        | Aggregates issued invoices, credit notes, confirmed bills; produces MIRA 205/206 + ITS CSV; stores snapshot in `gst_returns`; marks period `built` |
| svc   | `gst.getLatestReturn`             | `(businessId, periodId) → GstReturn \| null`                                     | Most recently built snapshot for a period                                                                                                          |
| svc   | `gst.rateAt`                      | `(businessId, category, date) → Decimal`                                         | Resolves historical rate (e.g., tourism 16%→17% on 2025-07-01)                                                                                     |
| svc   | `gst.assertPeriodOpen`            | `(businessId, date, ctx) → void`                                                 | Auto-creates period if needed; throws `PeriodLockedError` if locked. Used by invoicing + purchases.                                                |
| svc   | `gst.lockPeriod`                  | `(businessId, periodId, miraReturnRef, ctx) → Period`                            | Transitions period `open\|built` → `locked`; audited                                                                                               |
| svc   | `gst.unlockPeriod`                | `(businessId, periodId, reason, ctx) → Period`                                   | Admin only; `locked` → `open`; audited                                                                                                             |
| repo  | `gst.getInvoiceLinesForPeriod`    | `(businessId, periodStart, periodEnd) → PeriodLineAgg[]`                         | Aggregates invoice_lines by gst_category; reads persisted amounts only                                                                             |
| repo  | `gst.getCreditNoteLinesForPeriod` | `(businessId, periodStart, periodEnd) → PeriodLineAgg[]`                         | Aggregates credit_note_lines by gst_category                                                                                                       |
| repo  | `gst.getBillLinesForPeriod`       | `(businessId, periodStart, periodEnd) → BillLineAgg[]`                           | Aggregates bill_lines by supplier + gst_category (with TIN)                                                                                        |

---

## Module: `reports`

| Kind  | Name                            | Signature                                                                                                     | Purpose                                                                         |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| route | `GET /reports/sales`            | `?from&to&groupBy=customer\|item\|day&format=json\|csv` → `{ from, to, groupBy, rows: NetGroupRow[] } \| CSV` | Sales register — issued invoices net of credit notes, grouped by entity         |
| route | `GET /reports/purchases`        | `?from&to&groupBy=supplier\|item\|day&format=json\|csv` → `{ from, to, groupBy, rows: NetGroupRow[] } \| CSV` | Purchases register — confirmed bills grouped by entity                          |
| route | `GET /reports/stock-valuation`  | `?asOf&method=avg\|fifo&format=json\|csv` → `{ asOf, method, rows: StockValuationRow[] } \| CSV`              | Inventory valuation as of date; avg uses weighted avg cost, fifo uses lot order |
| route | `GET /reports/aged-receivables` | `?asOf&format=json\|csv` → `{ asOf, rows: AgedEntityRow[] } \| CSV`                                           | Outstanding invoices bucketed into current / 1-30 / 31-60 / 61-90 / 91+ days    |
| route | `GET /reports/aged-payables`    | `?asOf&format=json\|csv` → `{ asOf, rows: AgedEntityRow[] } \| CSV`                                           | Outstanding bills bucketed into same age bands                                  |
| route | `GET /reports/gst-summary`      | `?from&to&format=json\|csv` → `GstSummaryResult \| CSV`                                                       | Live preview of output vs input tax for an arbitrary date range; no storage     |
| svc   | `reports.salesReport`           | `(businessId, from, to, groupBy) → NetGroupRow[]`                                                             | Merges invoice + credit note aggregates; pure read                              |
| svc   | `reports.purchasesReport`       | `(businessId, from, to, groupBy) → NetGroupRow[]`                                                             | Aggregates confirmed bills; pure read                                           |
| svc   | `reports.stockValuationReport`  | `(businessId, asOf, method) → StockValuationRow[]`                                                            | avg: weighted avg cost × net qty; fifo: FIFO lot consumption in app layer       |
| svc   | `reports.agedReceivablesReport` | `(businessId, asOf) → AgedEntityRow[]`                                                                        | Buckets outstanding invoices by (asOf − dueDate) per customer                   |
| svc   | `reports.agedPayablesReport`    | `(businessId, asOf) → AgedEntityRow[]`                                                                        | Buckets outstanding bills by (asOf − dueDate) per supplier                      |
| svc   | `reports.gstSummaryReport`      | `(businessId, from, to) → GstSummaryResult`                                                                   | Reads invoice/CN/bill lines for date range; returns output, input, net payable  |

`NetGroupRow = { groupKey, label, docCount, subtotal, gstAmount, total }` (all monetary as stringified 2dp decimals)

`StockValuationRow = { itemId, itemName, sku, qty (4dp), avgCost (2dp), value (2dp) }`

`AgedEntityRow = { entityId, entityName, current, days1_30, days31_60, days61_90, days91Plus, total }` (all 2dp)

`GstSummaryResult = { from, to, outputTaxByCategory, inputTaxByCategory, totalOutputTax, totalInputTax, netPayable }`

All `reports.*` functions are **pure read-only** — no writes, no audit rows, no period locks.

---

## Module: `audit`

| Kind  | Name                  | Signature                                                                                            | Purpose                                                                          |
| ----- | --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| route | `GET /audit`          | `?entityType&entityId&userId&from&to&page&pageSize` → `{ items: AuditLog[], total, page, pageSize }` | Admin only (Phase 21, UPGRADE.md)                                                |
| svc   | `audit.record`        | `(action, entityType, entityId, before, after, ctx: AuditRecordCtx, tx: DbTx) → void`                | The only writer of `audit_logs`. Always called inside the mutating tx.           |
| repo  | `audit.listAuditLogs` | `(businessId, params) → { rows: AuditLog[], total }`                                                 | Read-only, offset-paginated, filterable by entityType/entityId/userId/date range |

`AuditCtx = { userId: string; businessId: string; ip: string; ua?: string }` — used everywhere `ctx.userId` also feeds a NOT NULL `createdBy`/`updatedBy` column.

`AuditRecordCtx = { userId: string | null; businessId: string; ip: string; ua?: string }` (Phase 28) — `record()`'s own parameter type only. A real `AuditCtx` is assignable to it; only the `portal` module constructs a `userId: null` ctx, for mutations with no staff actor.

---

## Module: `settings`

Business profile, branding, and document defaults (Phase 22, UPGRADE.md G-2/G-15). `GET /settings` is readable by any authenticated role (the profile is displayed throughout the UI); `PATCH`/logo upload are admin only.

| Kind  | Name                   | Signature                                             | Purpose                                                                                                    |
| ----- | ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| route | `GET  /settings`       | → `Business & { logoUrl: string \| null }`            | —                                                                                                          |
| route | `PATCH /settings`      | `BusinessSettingsPatch` → `Business`                  | Admin only                                                                                                 |
| route | `POST  /settings/logo` | `multipart { file }` → `Business & { logoUrl }`       | Admin only; goes through `files.uploadFile` (magic-byte sniff, EXIF strip, virus scan — SECURITY.md §13.5) |
| svc   | `settings.get`         | `(businessId) → Business & { logoUrl }`               | Resolves `logoFileId` to a signed URL                                                                      |
| svc   | `settings.update`      | `(businessId, BusinessSettingsPatch, ctx) → Business` | Audited as `business.settings_updated`                                                                     |
| svc   | `settings.updateLogo`  | `(businessId, buffer, name, mime, ctx) → Business`    | Uploads via `files`, points `businesses.logo_file_id` at it; audited as `business.logo_updated`            |

`BusinessSettingsPatch` (`shared/src/settings.ts`): `name?, tin?, address?, phone?, email?, allowBackorders?, gstPeriodType?, defaultCreditTermsDays?, defaultInvoiceNotes?, invoiceNumberPrefix?, creditNoteNumberPrefix?, billNumberPrefix?, poNumberPrefix?`.

`customers.create` falls back to `settings.defaultCreditTermsDays` (not a hard-coded `30`) when `creditTermsDays` isn't supplied.

---

## Module: `emailLogs`

Append-only outbound email log — no routes of its own; read via `GET /invoices/:id/emails`, written by `worker/email.ts` and `worker/reminders.ts` (Phase 24, UPGRADE.md G-3/G-4).

| Kind | Name                         | Signature                                            | Purpose                                                                                                                                                  |
| ---- | ---------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| repo | `emailLogs.insertLog`        | `(NewEmailLog) → EmailLog`                           | One row per send attempt, `status: 'sent' \| 'failed'`                                                                                                   |
| repo | `emailLogs.listForEntity`    | `(businessId, entityType, entityId) → EmailLog[]`    | Newest first                                                                                                                                             |
| repo | `emailLogs.markReminderSent` | `(businessId, invoiceId, offsetDays, tx?) → boolean` | `INSERT ... ON CONFLICT DO NOTHING` into `invoice_reminders_sent`; returns `true` only on a genuinely new row — the reminders worker's idempotency guard |

---

## Module: `portalAuth`

Customer portal magic-link auth (Phase 28, UPGRADE.md G-8) — see ARCHITECTURE.md §4.9, SECURITY.md §13.14. Mounted at `/portal/auth`. Parallels `auth`'s magic-link mechanics but owns separate tables/secret/cookie; never shares code paths with `modules/auth`.

| Kind         | Name                                               | Signature                                                                  | Purpose                                                                                                          |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| route public | `POST /portal/auth/magic-link`                     | `{ email }` → `204`                                                        | Sends one magic-link email per `(businessId, customerId)` match across all businesses; always 204                |
| route public | `POST /portal/auth/magic-link/verify`              | `{ token }` → `{ id, name, email }` + `portal_session` cookie              | Single-use; returns the customer profile directly (no follow-up `/portal/me` call needed)                        |
| route        | `POST /portal/auth/logout`                         | `{}` → `204`                                                               | Deactivates the portal session                                                                                   |
| svc          | `portalAuth.requestMagicLink`                      | `(email) → void`                                                           | Looks up every active (non-soft-deleted) customer row matching `email` case-insensitively, across all businesses |
| svc          | `portalAuth.verifyMagicLink`                       | `(token, ctx) → { ok, businessId, customerId, sid, jwt } \| { ok: false }` | Atomic single-use consume via `DELETE ... RETURNING`                                                             |
| svc          | `portalAuth.signPortalToken` / `verifyPortalToken` | `(payload) → string` / `(token) → PortalJwtPayload \| null`                | `PORTAL_JWT_SECRET`, 2-hour expiry, `type: 'portal'` discriminator checked on every verify                       |
| svc          | `portalAuth.logout`                                | `(sid) → void`                                                             | —                                                                                                                |

`portal_auth_tokens` / `portal_sessions` mirror `auth_tokens` / `user_sessions` but key on `customer_id`, not `user_id` — a customer has no `users` row.

---

## Module: `portal`

Read-only customer-facing routes (Phase 28, UPGRADE.md G-8) — see ARCHITECTURE.md §4.9. Mounted at `/portal`, gated by `requirePortalAuth` (sets `portalBusinessId`/`portalCustomerId`/`portalSid` on a separate `PortalEnv`, not `AppEnv`). Every route calls straight into the existing `invoicing`/`estimates`/`customers` services, then checks the fetched entity's `customerId` against the session — 404 (never 403) on mismatch.

| Kind  | Name                                 | Signature                                             | Purpose                                                                                          |
| ----- | ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| route | `GET  /portal/me`                    | → `{ id, name, email }`                               | —                                                                                                |
| route | `GET  /portal/invoices`              | `?page&pageSize` → `{ items, total, page, pageSize }` | Scoped to the session's own `customerId` — not a query param                                     |
| route | `GET  /portal/invoices/:id`          | → `Invoice & { lines, payments, creditNotes }`        | 404 if the invoice belongs to a different customer                                               |
| route | `GET  /portal/invoices/:id/pdf`      | → `{ url }` (signed URL)                              | 20/min/session, same signed-URL mechanism as staff PDF downloads                                 |
| route | `GET  /portal/estimates`             | `?page&pageSize` → `{ items, total, page, pageSize }` | —                                                                                                |
| route | `GET  /portal/estimates/:id`         | → `Estimate & { lines }`                              | —                                                                                                |
| route | `GET  /portal/estimates/:id/pdf`     | → `{ url }` (signed URL)                              | 20/min/session                                                                                   |
| route | `POST /portal/estimates/:id/accept`  | `{}` → `Estimate`                                     | 20/min/session; calls `estimates.markAccepted` with `ctx.userId: null` after the ownership check |
| route | `POST /portal/estimates/:id/decline` | `{}` → `Estimate`                                     | Same shape as accept                                                                             |
| route | `GET  /portal/statement`             | `?from&to` → `Soa`                                    | Calls `customers.buildSoa` scoped to the session's own customer                                  |

---

## Shared types (overview)

Detailed Zod schemas live in `/shared/src/*.ts`. Names you'll see in this file:

- `Money` — `z.string().regex(/^-?\d+(\.\d{1,2})?$/)` (stringified decimal, 2dp)
- `Qty` — `z.string().regex(/^-?\d+(\.\d{1,4})?$/)` (stringified decimal, 4dp)
- `IsoDate` — `YYYY-MM-DD`
- `Email` — `z.string().email().max(254)`
- `Tin` — `z.string().regex(/^\d{7,10}$/)` (Maldives TIN: 7–10 digit numeric string)
- `GstCategory` — `'general_8' | 'tourism_16' | 'tourism_17' | 'zero' | 'exempt'` (extend as MIRA evolves)
- `Permission` — `{ resource: 'customers'|'suppliers'|'items'|'invoices'|'bills'|'po'|'gst'|'reports', action: 'view'|'add'|'edit'|'delete' }`
- `Role` — `'admin' | 'manager' | 'staff'`

**Utilities (all in `@koosani/shared`):**

| Export                                                                                                           | Purpose                                                               |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `money.{add,sub,mul,round2,negate,gt,gte,lt,lte,eq,isZero,isNegative,sum}`                                       | Money math (2dp, `decimal.js`)                                        |
| `qty.{add,sub,mul,round4,negate,gt,gte,lt,eq,isZero,isNegative,sum}`                                             | Quantity math (4dp, `decimal.js`)                                     |
| `gstFor(taxableValue, rate)`                                                                                     | Per-line GST calc → `{ gst, gross }` (ARCHITECTURE.md §4.1)           |
| `sumGstLines(lines)`                                                                                             | Aggregate per-line results → `{ totalTaxable, totalGst, totalGross }` |
| `GST_RATES`                                                                                                      | Rate fraction map keyed by `GstCategory`                              |
| `formatMvDate(date)`, `todayMv()`, `parseMvDate(iso)`, `endOfMvDay(iso)`                                         | Maldives tz date I/O                                                  |
| `isInMvRange(date, from, to)`, `mvYearMonth(iso)`, `startOfMvMonth(iso)`, `endOfMvMonth(iso)`, `addDays(iso, n)` | Maldives tz date arithmetic                                           |
| `MV_TZ`                                                                                                          | `'Indian/Maldives'` (UTC+5, no DST)                                   |

**CRUD schemas (Phase 3 — request shapes only):**

| File                      | Exports                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `shared/src/customers.ts` | `CustomerCreate`, `CustomerPatch`, `ContactCreate`         |
| `shared/src/suppliers.ts` | `SupplierCreate`, `SupplierPatch`, `SupplierContactCreate` |
| `shared/src/items.ts`     | `ItemCreate`, `ItemPatch`, `ItemCategoryCreate`            |
| `shared/src/users.ts`     | `UserCreate`, `UserPatch`, `ChangePasswordBody` (Phase 21) |

---

## Change protocol

When a route or service signature changes:

1. Update its row here.
2. If the change is breaking for the SPA, note it in `CHANGELOG.md` under "Breaking".
3. If the function moved between layers (e.g., logic pulled from route into service), update `ARCHITECTURE.md` if a new pattern emerged.
