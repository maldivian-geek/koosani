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

| Kind  | Name                             | Signature                                                                  | Purpose                                                                         |
| ----- | -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| route | `GET    /customers`              | `?q&page&pageSize&active` → `{ items: Customer[], total, page, pageSize }` | List with offset pagination (ARCHITECTURE.md §11.5)                             |
| route | `GET    /customers/:id`          | → `Customer & { contacts, balance }`                                       | Detail + outstanding balance                                                    |
| route | `POST   /customers`              | `CustomerCreate` → `Customer`                                              | —                                                                               |
| route | `PATCH  /customers/:id`          | `CustomerPatch` → `Customer`                                               | —                                                                               |
| route | `DELETE /customers/:id`          | → `204`                                                                    | Soft delete (must have zero balance + no draft invoices)                        |
| route | `GET    /customers/:id/soa`      | `?from&to&format=json\|pdf` → `Soa \| PDF`                                 | Statement of account (json implemented; pdf stub — Phase 8)                     |
| route | `POST   /customers/:id/contacts` | `Contact` → `Contact`                                                      | —                                                                               |
| svc   | `customers.assertExists`         | `(id, businessId) → Customer`                                              | Throws if not in `business_id`                                                  |
| svc   | `customers.outstandingBalance`   | `(id, businessId) → Decimal`                                               | Sum of issued invoices − payments                                               |
| svc   | `customers.buildSoa`             | `(businessId, id, from, to) → Soa`                                         | Aggregates invoices, credit_notes, payments_received; running balance per entry |

---

## Module: `suppliers`

| Kind  | Name                             | Signature                                  | Purpose                                               |
| ----- | -------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| route | `GET    /suppliers`              | `?q&page&active` → `Supplier[]`            | —                                                     |
| route | `GET    /suppliers/:id`          | → `Supplier & { contacts, balance }`       | —                                                     |
| route | `POST   /suppliers`              | `SupplierCreate` → `Supplier`              | —                                                     |
| route | `PATCH  /suppliers/:id`          | `SupplierPatch` → `Supplier`               | —                                                     |
| route | `DELETE /suppliers/:id`          | → `204`                                    | Soft delete (must have zero balance + no draft bills) |
| route | `GET    /suppliers/:id/soa`      | `?from&to` → `{ entries, closingBalance }` | Delegates to `purchases.buildSupplierSoa`             |
| route | `POST   /suppliers/:id/contacts` | `Contact` → `Contact`                      | —                                                     |
| svc   | `suppliers.outstandingBalance`   | `(id) → Decimal`                           | Sum of bills − payments made                          |
| svc   | `suppliers.buildSoa`             | `(id, from, to) → Soa`                     | —                                                     |

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

| Kind  | Name                                 | Signature                                           | Purpose                                        |
| ----- | ------------------------------------ | --------------------------------------------------- | ---------------------------------------------- |
| route | `GET    /invoices`                   | `?status&customerId&from&to&q&page` → `Invoice[]`   | —                                              |
| route | `GET    /invoices/:id`               | → `Invoice & { lines, payments, creditNotes }`      | —                                              |
| route | `POST   /invoices`                   | `InvoiceDraftCreate` → `Invoice`                    | Creates draft, no number, no stock movement    |
| route | `PATCH  /invoices/:id`               | `InvoiceDraftPatch` → `Invoice`                     | Drafts only                                    |
| route | `POST   /invoices/:id/issue`         | `{}` → `Invoice`                                    | Allocates number, commits stock, locks row     |
| route | `POST   /invoices/:id/void`          | `{ reason }` → `Invoice`                            | Issued only; creates reversing credit note     |
| route | `GET    /invoices/:id/pdf`           | → `PDF` (signed URL)                                | —                                              |
| route | `POST   /invoices/:id/payments`      | `{ amount, method, ref?, paidAt }` → `Payment`      | —                                              |
| route | `DELETE /invoices/:id/payments/:pid` | → `204`                                             | Reverses payment                               |
| route | `GET    /credit-notes`               | `?customerId&from&to` → `CreditNote[]`              | —                                              |
| route | `POST   /credit-notes`               | `CreditNoteCreate` → `CreditNote`                   | References an issued invoice                   |
| route | `POST   /credit-notes/:id/issue`     | `{}` → `CreditNote`                                 | Allocates number, reverses stock               |
| svc   | `invoicing.createDraft`              | `(businessId, data, ctx) → Invoice & { lines }`     | Creates draft; GST rates preliminary           |
| svc   | `invoicing.patchDraft`               | `(businessId, id, data, ctx) → Invoice & { lines }` | Drafts only; replaces lines if provided        |
| svc   | `invoicing.issue`                    | `(businessId, invoiceId, ctx) → Invoice`            | Number, stock, GST snapshot, audit             |
| svc   | `invoicing.voidInvoice`              | `(businessId, invoiceId, reason, ctx) → Invoice`    | Auto-issues reversing CN; reverses stock       |
| svc   | `invoicing.addPayment`               | `(businessId, invoiceId, data, ctx) → Payment`      | Syncs paidAmount, derives status               |
| svc   | `invoicing.reversePayment`           | `(businessId, invoiceId, paymentId, ctx) → void`    | Marks reversed, re-syncs paidAmount            |
| svc   | `invoicing.createCreditNote`         | `(businessId, data, ctx) → CreditNote & { lines }`  | Draft CN against issued invoice                |
| svc   | `invoicing.issueCreditNote`          | `(businessId, creditNoteId, ctx) → CreditNote`      | Allocates CN number, reverses stock            |
| svc   | `invoicing.computeTotals`            | `(lines) → Totals`                                  | Pure function — see ARCHITECTURE.md §4.1       |
| svc   | `invoicing.assertNotLocked`          | `(businessId, date, ctx) → void`                    | Rejects if `date` falls in a locked GST period |

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

| Kind  | Name                      | Signature                                                                    | Purpose                                                           |
| ----- | ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| route | `GET    /pos`             | `?status&supplierId&from&to&page` → `{ items: Po[], total, page, pageSize }` | —                                                                 |
| route | `GET    /pos/:id`         | → `Po & { lines, grns }`                                                     | —                                                                 |
| route | `POST   /pos`             | `PoDraftCreate` → `Po & { lines }`                                           | Draft                                                             |
| route | `PATCH  /pos/:id`         | `PoDraftPatch` → `Po & { lines }`                                            | Drafts only; replaces lines if provided                           |
| route | `POST   /pos/:id/approve` | `{}` → `Po`                                                                  | Allocates number, enqueues PDF job                                |
| route | `POST   /pos/:id/cancel`  | `{ reason }` → `Po`                                                          | Blocked if any GRN exists                                         |
| route | `GET    /pos/:id/pdf`     | → `501` (stub — Phase 12)                                                    | —                                                                 |
| route | `POST   /pos/:id/grns`    | `GrnCreate` → `Grn & { lines }`                                              | Receive goods; commits stock via `inventory.applyMovement`        |
| route | `POST   /pos/:id/bill`    | `{}` → `Bill & { lines, poId }`                                              | Create draft bill pre-filled from GRN-received quantities         |
| route | `GET    /grns/:id`        | → `Grn & { lines }`                                                          | —                                                                 |
| svc   | `po.createDraft`          | `(businessId, data, ctx) → Po & { lines }`                                   | Subtotal = Σ qty×cost (no GST on POs)                             |
| svc   | `po.patchDraft`           | `(businessId, id, data, ctx) → Po & { lines }`                               | Drafts only; replaces lines if provided                           |
| svc   | `po.approvePo`            | `(businessId, poId, ctx) → Po`                                               | Advisory-locked number, enqueues `pdf` job                        |
| svc   | `po.cancelPo`             | `(businessId, poId, reason, ctx) → Po`                                       | Blocked if GRNs exist                                             |
| svc   | `po.canReceive`           | `(businessId, poLineId, qty, tx?) → bool`                                    | Checks qtyReceived + qty ≤ qtyOrdered, respects `allowBackorders` |
| svc   | `po.createGrn`            | `(businessId, poId, data, ctx) → Grn & { lines }`                            | Commits stock, increments `po_line.qty_received`, derives status  |
| svc   | `po.createBillFromPo`     | `(businessId, poId, ctx) → Bill & { poId }`                                  | Aggregates GRN qty per PO line, calls `purchases.createDraft`     |

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
| svc   | `audit.record`        | `(action, entityType, entityId, before, after, ctx: AuditCtx, tx: DbTx) → void`                      | The only writer of `audit_logs`. Always called inside the mutating tx.           |
| repo  | `audit.listAuditLogs` | `(businessId, params) → { rows: AuditLog[], total }`                                                 | Read-only, offset-paginated, filterable by entityType/entityId/userId/date range |

`AuditCtx = { userId: string; businessId: string; ip: string; ua?: string }`

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
