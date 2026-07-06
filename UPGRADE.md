# UPGRADE.md — Codebase Analysis & Upgrade Plan

> Goal (per owner request, 2026-07-06): bring Koosani to **full Zoho Invoice feature parity** while keeping everything Koosani already does beyond Zoho Invoice (inventory, purchasing, MIRA GST). This document has three parts:
>
> 1. **Where we stand** — feature parity matrix vs Zoho Invoice
> 2. **Flaws found** — verified against the code (file:line), with fixes
> 3. **Phased upgrade plan** — Phases 20–33, ordered by risk and dependency
>
> Analysis method: doc set (ARCHITECTURE / SECURITY / FUNCTIONS / STACK / DESIGN / CHANGELOG) + three targeted code audits (financial correctness, security & tenancy, completeness/stubs) run 2026-07-06 against `dev` @ `3b8f51b`.

---

## Part 1 — Feature parity vs Zoho Invoice

### 1.1 Already at parity (or stronger)

| Area                                | Status                 | Notes                                                                                                 |
| ----------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Customers & contact persons         | ✅                     | Plus TIN + credit terms (Zoho parity)                                                                 |
| Invoices (draft → issued lifecycle) | ✅                     | **Stronger**: DB-enforced immutability, gap-free numbering, GST period locks — Zoho has none of these |
| Credit notes                        | ✅ API / ⚠️ UI         | Standalone CN creation has no UI (only auto-CN via void) — see F-24                                   |
| Payments received (manual)          | ✅                     | Partial payments, status derivation                                                                   |
| Customer statements (SOA)           | ✅ JSON / ❌ PDF       | PDF is a 501 stub                                                                                     |
| Items & categories                  | ✅                     | Plus GST category with audited change reason                                                          |
| Taxes                               | ✅ **Beyond Zoho**     | Historical GST rates, MIRA 205/206 return builds, period locking                                      |
| Reports                             | ✅ core set            | Sales, purchases, stock valuation, aged AR/AP, GST summary, CSV export                                |
| Dashboard                           | ✅                     | KPIs, charts, AR top-5, low stock, GST preview                                                        |
| Users & roles                       | ❌ **documented only** | FUNCTIONS.md §users describes a module that does not exist in api or web — see F-6                    |

### 1.2 Beyond Zoho Invoice (keep — these live in Zoho Books/Inventory, not Zoho Invoice)

- Inventory: append-only stock ledger, on-hand cache, adjustments, stock counts, avg/FIFO valuation
- Purchasing: supplier bills, payments made, supplier SOA, SOA upload + auto-matching
- Purchase orders: approval lifecycle, GRNs, PO→bill conversion
- MIRA GST: return building, Input Tax Statement CSV, period lock with MIRAconnect reference
- Append-only financial audit log (no Zoho product exposes this to SMEs)

### 1.3 Missing vs Zoho Invoice (the gap to close)

| #    | Zoho Invoice feature                                                                              | Koosani today                                                                          | Planned phase                      |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| G-1  | Invoice/CN/PO/SOA **PDF generation**                                                              | Nothing — 501 stubs, no PDF library installed, `pdf` queue has no producer or consumer | 23                                 |
| G-2  | **Templates & branding** (logo, layout, footer terms)                                             | No settings module at all; `businesses` table has no read/edit route                   | 22–23                              |
| G-3  | **Email documents** to customers (invoice, receipt, statement)                                    | Resend wired for auth emails only; no `email` queue exists                             | 24                                 |
| G-4  | **Payment reminders** (automated dunning) + late fees                                             | None                                                                                   | 24, 26                             |
| G-5  | **Estimates / quotes** (send → accept/decline → convert)                                          | None                                                                                   | 25                                 |
| G-6  | **Recurring invoices** (+ optional auto-issue)                                                    | None                                                                                   | 26                                 |
| G-7  | **Customer credits**: apply CN to invoice, advance/retainer payments, refunds, bad-debt write-off | CN reduces balance only via SOA math; no application model                             | 27                                 |
| G-8  | **Customer portal** (view/pay invoices, accept estimates)                                         | None                                                                                   | 28                                 |
| G-9  | **Online payments** + payment links                                                               | None (SECURITY.md §13.13 currently forbids webhooks — must be revised first)           | 29                                 |
| G-10 | **Multi-currency**                                                                                | MVR only. Real gap for Maldives — USD invoicing is routine for resorts/tourism B2B     | 30                                 |
| G-11 | **Expenses** (lightweight, billable, receipt capture)                                             | Only full supplier bills                                                               | 31 (optional)                      |
| G-12 | **Projects & time tracking** → billable invoices                                                  | None                                                                                   | 32 (optional)                      |
| G-13 | Delivery notes / packing slips                                                                    | None                                                                                   | 33                                 |
| G-14 | Custom fields on documents                                                                        | None                                                                                   | 33                                 |
| G-15 | Numbering customization (prefix/format per doc type)                                              | Hard-coded `INV-`/`CN-`/`BILL-`/`PO-`                                                  | 22                                 |
| G-16 | Public API / webhooks / integrations                                                              | Deliberately excluded (SECURITY.md §13.13)                                             | Out of scope unless owner revisits |
| G-17 | Native mobile apps                                                                                | Responsive web + mobile bottom nav instead                                             | Accepted divergence                |

**Recommendation on priority:** G-1…G-4 first (an invoicing app that can't produce or send an invoice PDF isn't at parity with anything), then G-5/G-6/G-7 (quote-to-cash loop), then portal/payments/multi-currency. G-11/G-12 are genuinely optional for a Maldives SME accounting product — marked as such.

---

## Part 2 — Flaws found (verified in code)

Severity: 🔴 fix before any new features · 🟠 fix in the next hardening phase · 🟡 scheduled cleanup.

### 2.1 Security

| #   | Sev | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Fix                                                                                                                                                                                                                     |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | 🔴  | **`token_version` check is a no-op.** `api/src/middleware/requireAuth.ts:68,81` compares `payload.tokenVersion` against itself; `getSession()` never reads `users.token_version`. Emergency JWT rotation (SECURITY.md §13.1) silently doesn't work; only session deactivation saves the other flows.                                                                                                                                                           | Join `users.token_version` in the session lookup and compare against the JWT claim; add a regression test that bumps the version and asserts 401.                                                                       |
| F-2 | 🔴  | **No authorization layer exists.** `requireRole`/`requirePermission` are absent from the codebase; only two inline admin checks exist (`gst/routes.ts:41,80`). Any `staff` user can issue/void invoices, record payments, **lock GST periods** (lock is not admin-gated; unlock is), approve POs, confirm bills, delete customers, and export every report. SECURITY.md's authorization section still describes the previous app (guests/bookings/excursions). | Implement `requireRole` + `requirePermission(resource, action)` middleware using the `Permission` type already defined in FUNCTIONS.md shared types; gate every route; rewrite SECURITY.md §Authorization for this app. |
| F-3 | 🔴  | **File uploads trust the client MIME header; no virus scan; no EXIF strip.** `files/routes.ts:25` passes browser `entry.type` to `isAllowedMime` (`lib/storage.ts:39` string-match). `files.scan_result` defaults `'pending'` and is never updated (`db/schema/files.ts:25`), yet signed URLs are issued immediately. Violates SECURITY.md §13.5 rules 1, 3, 8.                                                                                                | Sniff magic bytes (`file-type` pkg), run synchronous ClamAV before commit, strip EXIF via `sharp`, only serve `scan_result='clean'` files.                                                                              |
| F-4 | 🟠  | **RLS documented but absent.** No `ROW LEVEL SECURITY`/`POLICY`/`current_business_id` anywhere in migrations, contradicting SECURITY.md §13.11.4. Tenancy rests solely on hand-written WHERE clauses (which the audit confirmed are otherwise consistently applied from auth ctx).                                                                                                                                                                             | Either implement RLS with `SET LOCAL app.current_business_id` on the five sensitive tables, or amend SECURITY.md to state it's deferred. Recommend implementing — it's cheap insurance.                                 |
| F-5 | 🟠  | **CSRF mitigation #2 not implemented.** No route enforces `Content-Type: application/json`; Hono's `c.req.json()` parses `text/plain` simple-request bodies, and bodyless mutations (issue, approve) check nothing. `sameSite=strict` is the only real defense.                                                                                                                                                                                                | Global middleware: reject non-GET requests whose content-type isn't `application/json` (exempting the two multipart upload routes).                                                                                     |
| F-6 | 🟠  | **`users` module doesn't exist** (api or web) despite FUNCTIONS.md §users. `inviteEmail()` in `lib/mailer.ts:51` is dead code; nothing can create users or send invites — only the seeded admin can ever log in. Also missing: password-change endpoint (SECURITY.md claims a `password_changed` event), admin activity log route, `GET /audit`.                                                                                                               | Build the users module (CRUD + invite + permissions), password change, `GET /audit`, admin activity log — Phase 21.                                                                                                     |
| F-7 | 🟠  | **Rate limiting inconsistent.** Domain limiters are in-process Maps (`lib/rateLimiter.ts`, `gst/routes.ts:13-25`) — reset on restart, multiply by N instances. Auth correctly uses Redis. No limits at all on financial mutations; report exports lack the `admin`/`reports.export` gate and 10/hour bulk cap required by SECURITY.md §13.6 (CSV is also streamed from the api, contradicting §13.6).                                                          | Back domain limiters with `rate-limiter-flexible` (Redis, already a dep); add export permission gate + bulk cap.                                                                                                        |
| F-8 | 🟡  | Signed URLs live 1 hour (`files/service.ts:83`) vs the 5 minutes mandated by SECURITY.md §13.5.4. FUNCTIONS.md lists the files module **twice** with contradictory signatures; the second block (incl. `files.requirePermission`) describes functions that don't exist.                                                                                                                                                                                        | Drop expiry to 300 s; delete the stale duplicate FUNCTIONS.md block.                                                                                                                                                    |
| F-9 | 🟡  | Append-only REVOKE on `audit_logs`/`stock_movements` only binds if the app connects as `koosani_app`; seed default suggests it may connect as the table owner. Config also read from `process.env` outside `lib/config.ts` (`storage.ts`, `server.ts:125`, `db/client.ts:8`). No MFA/2FA anywhere.                                                                                                                                                             | Verify prod role; centralize env reads in `config.ts`; consider TOTP in Phase 21.                                                                                                                                       |

### 2.2 Financial correctness

| #    | Sev | Finding                                                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                              |
| ---- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-10 | 🔴  | **Negative-stock race (TOCTOU).** `inventory/service.ts:74` checks `stock_on_hand` with a plain SELECT — no `FOR UPDATE`, and no DB `CHECK` backstop — so two concurrent issues can both pass and drive stock negative even with `allowBackorders=false`.                                                                              | `SELECT … FOR UPDATE` on the item row inside `assertAvailable`; add a conditional trigger/CHECK enforcing non-negative stock.                    |
| F-11 | 🟠  | **Payment reversals skip the GST period lock.** `invoicing/service.ts:534` and `purchases/service.ts:390` never call `gst.assertPeriodOpen`, while `addPayment` on both sides does. A payment in a filed period can be silently reversed.                                                                                              | Call `assertPeriodOpen` (against the payment's `paidAt`) in both `reversePayment` paths + tests.                                                 |
| F-12 | 🟠  | **Line tables aren't covered by immutability triggers.** Migration guards only document headers (`0000_….sql:596-656`); `invoice_lines` / `bill_lines` / `credit_note_lines` of an issued document can be UPDATEd/DELETEd at the DB level, contradicting ARCHITECTURE.md §4.2. Also no DELETE guard on the document tables themselves. | Add BEFORE UPDATE/DELETE triggers on line tables checking parent status; `REVOKE DELETE` (or BEFORE DELETE guards) on financial document tables. |
| F-13 | 🟠  | **`MoneyInput.vue:26` uses `parseFloat(...).toFixed(2)`** — the single money-entry widget on the write path violates the Decimal rule and loses precision at large magnitudes.                                                                                                                                                         | Normalize with `money.round2` from `@koosani/shared`.                                                                                            |
| F-14 | ✅  | **Voiding a partially-paid invoice orphans its payments.** ~~Block void while active payments exist~~ — **properly resolved in Phase 27**: active payments are reversed and their amounts granted back as customer credit (ARCHITECTURE.md §4.8), replacing the Phase 20 interim "reject the void" policy.                             | Done — `invoicing.voidInvoice` + `customerCredits.creditFromVoidedInvoice`.                                                                      |
| F-15 | ✅  | **Zero and unbounded overpayments accepted.** ~~Reject non-positive; cap at outstanding~~ — **properly resolved in Phase 27**: the payment is capped at outstanding (so `paidAmount` still never exceeds `total`) and the excess becomes customer credit rather than being rejected.                                                   | Done — `invoicing.addPayment` + `customerCredits.creditFromOverpayment`.                                                                         |
| F-16 | 🟡  | **GRN over-receipt race** — `po/service.ts:239,320` checks then increments without locking the PO line.                                                                                                                                                                                                                                | `FOR UPDATE` on the PO line in the GRN transaction.                                                                                              |
| F-17 | 🟡  | **Double-reverse race on payments** — `markPaymentReversed` (`invoicing/repository.ts:219`) has no `WHERE reversed_at IS NULL`; payment read outside tx. Impact limited (paid-amount is recomputed), but duplicate audit rows possible.                                                                                                | Lock/read in-tx; add the `IS NULL` guard.                                                                                                        |
| F-18 | 🟡  | **Period auto-creation isn't atomic with the caller.** `gst/service.ts:112` opens its own transaction inside `assertPeriodOpen`, so a rolled-back issue still creates the period.                                                                                                                                                      | Thread the caller's `tx` through.                                                                                                                |
| F-19 | 🟡  | Float leakage in display code: `parseFloat` in `items/repository.ts:156`; JS arithmetic on money in `DashboardView.vue:62-70`, `StockValuationReportView.vue:50`, both SOA views, `InvoiceDetailView.vue:400`. Display-only, but off-by-a-cent totals are possible.                                                                    | Use shared `money`/`qty` helpers.                                                                                                                |

Verified sound (no action): per-line GST rounding then sum (`shared/src/gst.ts:35,53`), advisory-locked gap-free numbering across all four doc types, `applyMovement` as sole stock writer, Decimal-clean stock valuation, audit coverage (~40 call sites), Argon2id + timing-safe dummy verify, cookie flags, CSP, header immutability triggers, REVOKE on audit/stock tables, pagination envelope consistency.

### 2.3 Dead or unfinished plumbing

| #    | Sev | Finding                                                                                                                                                                                                              | Fix                                                                                         |
| ---- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| F-20 | 🔴  | **SOA extraction is silently dead.** `soaExtractWorker` (`worker/soa-extract.ts:8`) is never registered in `worker/index.ts:6-11` — uploads enqueue a job no consumer ever processes; the UI polls forever.          | Register the worker. One-line fix; add an integration test.                                 |
| F-21 | 🟠  | **Nightly stock reconcile never runs.** Worker registered, but no repeatable/cron scheduling exists anywhere; nothing enqueues to `reconcileQueue`.                                                                  | Add a BullMQ job scheduler (repeatable, 02:00 MV time).                                     |
| F-22 | 🟠  | **`pdf` queue has no producer or consumer**, yet FUNCTIONS.md says `po.approvePo` "enqueues PDF job".                                                                                                                | Resolved by Phase 23; until then correct FUNCTIONS.md.                                      |
| F-23 | 🟡  | Supplier SOA has no `format=pdf` branch at all (customer SOA at least 501s) — `suppliers/routes.ts:95-111`.                                                                                                          | Add with Phase 23.                                                                          |
| F-24 | 🟡  | UI gaps for existing APIs: standalone credit-note creation, inventory adjustments/stock-count/movements, users admin, audit log.                                                                                     | Phases 20–21 + 33.                                                                          |
| F-25 | 🟡  | Tests: `web` has **zero** tests (no unit, no Playwright despite STACK.md); api `files` + `audit` modules and all workers/lib untested.                                                                               | Add alongside each phase; Playwright smoke suite in Phase 23 when the app is demo-complete. |
| F-26 | 🟡  | Doc drift beyond the above: SECURITY.md authorization section describes the previous app; geo lookup stubbed (`lib/geo.ts:28`) with maxmind absent; STACK.md lists clamav/PDF lib/maxmind as chosen-but-uninstalled. | Sweep docs in Phase 20.                                                                     |

---

## Part 3 — Phased upgrade plan

Order rationale: fix trust in the numbers first (20), unblock user management (21), then build toward parity in dependency order — settings → PDF → email → estimates → recurring → credits → portal → payments → multi-currency. Each phase ends with its CLAUDE.md §10 definition-of-done (docs + CHANGELOG + commit).

### Phase 20 — Correctness & security hardening 🔴 (do first, no features)

- Fix F-1 (token_version), F-2 (authz middleware — `requireRole` + `requirePermission` on every route; admin-gate GST lock), F-3 (magic-byte sniff + ClamAV + EXIF strip), F-5 (JSON content-type middleware), F-10 (stock `FOR UPDATE` + DB backstop), F-11 (period lock on reversals), F-12 (line-table + DELETE immutability triggers), F-13 (MoneyInput → Decimal), F-14 (block void while payments active — interim policy), F-20 (register SOA worker), F-21 (schedule reconcile).
- F-4 (RLS), F-7 (Redis limiters + export gating), F-15…F-19 (small races/validation), F-9 config centralization.
- Doc sweep: rewrite SECURITY.md §Authorization; delete FUNCTIONS.md duplicate files block; correct signed-URL expiry decision; note RLS status.
- Tests: regression test per fixed flaw (CLAUDE.md §6 — these are the high-blast-radius spots).

### Phase 21 — Users, admin & account security

- `users` module per FUNCTIONS.md: list/create/patch/soft-delete, invite issuance (wire the dead `inviteEmail`), permission editing.
- Password-change endpoint (bumps token_version); optional TOTP MFA (recommended for a financial app).
- `GET /audit` + audit log admin UI; admin activity log (auth events).
- Web: users admin view, audit view.

### Phase 22 — Business settings & branding (Zoho: org profile) — G-2, G-15

- `settings` module: business profile (name, address, TIN, logo upload via files module), default payment terms/notes, invoice/CN/bill/PO numbering prefix + padding, `allowBackorders`, GST period type.
- Web settings views. This is prerequisite plumbing for PDFs and emails.

### Phase 23 — PDF engine — G-1 (closes F-22, F-23)

- Pick `@react-pdf/renderer` (STACK.md's own recommendation) — resolve the open decision, update STACK.md.
- `pdf` worker + producers: invoice, credit note, PO, customer/supplier SOA. Store rendered PDFs via files module (feeds the §13.10 WORM archive requirement).
- Template with business branding from Phase 22; MIRA-compliant tax invoice layout (TIN, GST breakdown per category).
- Replace all 501 stubs; SOA PDF rate limits (SECURITY.md §13.7 pending rows).
- Playwright smoke suite starts here.

### Phase 24 — Email & payment reminders — G-3, G-4

- `email` BullMQ queue + worker; send invoice/CN/statement with PDF attached; payment receipt ("thank you") emails.
- Automated payment reminders: per-business dunning schedule (e.g., −3/0/+7/+14 days vs due date), per-invoice opt-out, reminder history on the invoice.
- Email log table (what was sent, to whom, when) — audit-adjacent.

### Phase 25 — Estimates / quotes — G-5

- `estimates` module mirroring invoicing's draft pattern: draft → sent → accepted/declined/expired; convert-to-invoice (copies lines, links `estimate_id`); PDF + email reuse Phases 23–24. No stock, no GST period interaction until converted.

### Phase 26 — Recurring invoices & late fees — G-6, G-4b

- ✅ Done: Recurrence profiles (frequency, start/end, template lines); worker cron generates drafts (or auto-issues, per-profile flag) — respects GST period locks by construction (always dated today). See ARCHITECTURE.md §4.7, CHANGELOG.md.
- ⏸ Deferred: optional late-fee rule per business (flat/%, grace days) applied as a generated line on reminders — owner decision; MIRA GST treatment of late fees must be confirmed before enabling. No schema or logic for this exists yet.

### Phase 27 — Customer credits, advances & write-offs — G-7 (properly fixes F-14, F-15)

- ✅ Done: Credit application model (`customer_credits` append-only ledger, ARCHITECTURE.md §4.8): apply credit balance to invoices (`POST /invoices/:id/apply-credit`); customer credit balance; advance/retainer invoices (`POST /customers/:id/credits/advance`); refunds, recorded never updated (`POST /customers/:id/credits/refund`); bad-debt write-off with audit (`POST /invoices/:id/write-off`).
- This is the accounting-correct resolution of the void-with-payments and overpayment interim policies from Phase 20 — see F-14/F-15 above.
- Note: standalone credit notes not tied to a specific invoice (e.g. a goodwill credit note applied generically) weren't built — credit notes remain invoice-specific reversals as before; only overpayments/voids/manual advances feed the credit ledger. Revisit if a real "general credit note" workflow is requested.

### Phase 28 — Customer portal — G-8 ⚠️ threat-model change

- Separate portal origin + separate auth (magic-link only, no passwords), read-only invoice/estimate/statement views, estimate accept/decline, PDF downloads via short-lived signed URLs.
- **SECURITY.md must be updated first** (new public surface, new rate limits, portal session model). Treat as its own security review.

### Phase 29 — Online payments & payment links — G-9 ⚠️ requires revising SECURITY.md §13.13

- Gateway abstraction; realistic Maldives options: BML payment gateway (MVR) + Stripe (USD) — confirm with owner.
- Payment links on invoices/emails/portal; inbound webhooks (signature-verified, idempotent, IP-allowlisted) — §13.13 currently forbids webhooks, so the section is amended first with the trade-off named, per CLAUDE.md §9.

### Phase 30 — Multi-currency — G-10 (largest schema change; recommended for Maldives)

- Currency on customers/invoices/estimates; manual + daily exchange rates; document stored in doc currency **and** MVR at the document-date rate (MIRA reporting stays MVR); realized gain/loss rows on payment.
- Touches invoicing, payments, reports, GST build — plan a dedicated design pass before implementation.

### Phase 31 (optional) — Expenses — G-11

- Lightweight expense capture (category, amount, GST, receipt upload, billable→invoice line). Distinct from supplier bills; skippable if bills suffice for the target users.

### Phase 32 (optional) — Projects & time tracking — G-12

- Projects, tasks, timesheets, billable rates → invoice generation. Only if the customer base is service businesses; otherwise skip — this is the least-fitting Zoho Invoice feature for an inventory-centric SME product.

### Phase 33 — Parity odds & ends — G-13, G-14, F-24 remainder

- Delivery notes/packing slips (from issued invoices), custom fields (typed key-value per doc type, shown on PDFs), inventory UI (adjustments, stock counts, movement ledger), standalone credit-note UI.

---

## Suggested immediate next step

Phase 20 — nothing else should ship on top of a broken authorization layer and a dead token-revocation check. Phases 20–24 together make Koosani a _sendable-invoice_ product (PDF + email + reminders), which is the minimum credible Zoho Invoice comparison point; 25–30 complete parity; 31–33 are optional polish.
