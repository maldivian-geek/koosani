# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Phase 7 — Invoicing (sales):**
  - `shared/src/invoicing.ts` — Zod schemas: `InvoiceLineCreate`, `InvoiceDraftCreate`, `InvoiceDraftPatch`, `InvoicePaymentCreate`, `InvoiceVoidBody`, `CreditNoteCreate` — all exported from `@koosani/shared` (FUNCTIONS.md §invoicing).
  - `api/src/modules/invoicing/repository.ts` — full repository: invoice CRUD + lines, payment CRUD + sync, credit note CRUD + lines, per-business advisory-locked number sequences (`INV-NNNNNN`, `CN-NNNNNN`).
  - `api/src/modules/invoicing/service.ts` — `createDraft` (preliminary GST rates via `gst.rateAt` at today's MV date), `patchDraft` (replaces lines, recomputes totals), `issue` (re-snapshots GST at issueDate, checks + commits stock via `inventory.assertAvailable` / `inventory.applyMovement`, allocates invoice number, period-lock checked, audit written), `voidInvoice` (auto-creates and auto-issues reversing CN, reverses stock), `addPayment` / `reversePayment` (syncs `paid_amount`, derives status: issued → partially_paid → paid), `createCreditNote`, `issueCreditNote` (allocates CN number, reverses stock), `listInvoices`, `getInvoice`, `listCreditNotes`, `assertNotLocked`, `computeTotals` (FUNCTIONS.md §invoicing, ARCHITECTURE.md §4.1).
  - `api/src/modules/invoicing/routes.ts` — `GET /invoices`, `GET /invoices/:id`, `POST /invoices`, `PATCH /invoices/:id`, `POST /invoices/:id/issue`, `POST /invoices/:id/void`, `GET /invoices/:id/pdf` (501 stub — Phase 8), `POST /invoices/:id/payments`, `DELETE /invoices/:id/payments/:pid`, `GET /credit-notes`, `POST /credit-notes`, `POST /credit-notes/:id/issue` (FUNCTIONS.md §invoicing).
  - `api/src/modules/customers/repository.ts` — added SOA query functions: `soaInvoices`, `soaCreditNotes`, `soaPayments`, `openingBalanceComponentsAt`.
  - `api/src/modules/customers/service.ts` — `buildSoa(businessId, customerId, from, to) → Soa` pure aggregation over issued invoices, credit notes, and non-reversed payments; computes running balance per entry (FUNCTIONS.md §customers).
  - `api/src/modules/customers/routes.ts` — `GET /customers/:id/soa?from&to&format` implemented (json only; pdf returns 501) (FUNCTIONS.md §customers).
  - `api/src/server.ts` — registers `invoiceRoutes` at `/invoices` and `creditNoteRoutes` at `/credit-notes`.
  - 22 new tests: GST total math with mixed categories, per-line rounding before summing, draft create/patch, issue with stock commitment, sequential number allocation under concurrency, period-lock rejection, insufficient stock rejection, void with reversing CN + stock restoration, payment / reversal, credit note create + issue, immutability guards (PATCH/issue on issued invoices).

- **Phase 6 — GST configuration & period locking:**
  - `shared/src/gst.ts` — `GstRateCreate` Zod schema (`category`, `rate`, `validFrom`) exported from `@koosani/shared` (FUNCTIONS.md §gst).
  - `api/src/modules/gst/repository.ts` — `getRateAt`, `listRates`, `insertRate`, `getPeriodForDate`, `upsertPeriod` (ON CONFLICT DO NOTHING), `getPeriodById`, `listPeriods`, `lockPeriod`, `unlockPeriod`, `getBusinessPeriodType`.
  - `api/src/modules/gst/service.ts` — `rateAt(businessId, category, date) → Decimal` (resolves historical rate; throws `NotFoundError` if gap in coverage); `assertPeriodOpen(businessId, date, ctx) → void` (auto-creates period on first use per business `gstPeriodType`, throws `PeriodLockedError` if locked — ARCHITECTURE.md §4.4); `listPeriods`, `listRates`, `createRate`, `lockPeriod`, `unlockPeriod`.
  - `api/src/modules/gst/routes.ts` — `GET /gst/rates`, `POST /gst/rates` (admin only), `GET /gst/periods`, `POST /gst/periods/:id/lock`, `POST /gst/periods/:id/unlock` (admin only, fully audited), `POST /gst/periods/:id/build` (stub — Phase 7), `GET /gst/periods/:id/return` (stub — Phase 7) (FUNCTIONS.md §gst).
  - `api/src/db/seed.ts` — seeds MIRA GST rates: `general_8` 8% from 2023-01-01; `tourism_16` 16% from 2023-01-01 to 2025-06-30; `tourism_17` 17% from 2025-07-01; `zero` and `exempt` at 0%.
  - `api/src/server.ts` — registers `gstRoutes` at `/gst`.
  - 19 new tests: rate resolution across the 2025-07-01 tourism rate boundary, monthly/quarterly period auto-creation, period-lock rejection, lock/unlock routes, audit log written on rate creation.

- **Phase 5 — Inventory module:**
  - `shared/src/inventory.ts` — `InventoryAdjustmentCreate` (itemId + non-zero Qty + reason) and `StockCountCreate` (array of `{itemId, qty≥0}`) schemas exported from `@koosani/shared`.
  - `api/src/modules/inventory/repository.ts` — `insertMovement`, `listMovements`, `listOnHand`, `getItemOnHand`, `recomputeOnHand`, `getBackorderFlag`.
  - `api/src/modules/inventory/service.ts` — `applyMovement` (sole writer of `stock_movements`; caller owns the transaction), `assertAvailable` (rejects if would go negative, respects `businesses.allow_backorders`), `createAdjustment`, `bulkStockCount`, `listMovements`, `listOnHand`.
  - `api/src/modules/inventory/routes.ts` — `GET /inventory/movements`, `GET /inventory/on-hand`, `POST /inventory/adjustments`, `POST /inventory/stock-count` (FUNCTIONS.md §inventory).
  - `api/src/lib/queues.ts` — `reconcileQueue` (BullMQ Queue); scheduling deferred to Phase 11 (ARCHITECTURE.md §8).
  - `api/src/lib/logger.ts` — extracted from `server.ts` so the worker process can import it without starting the HTTP server.
  - `api/src/worker/reconcile.ts` — `registerReconcileWorker()`: verifies `items.stock_on_hand` matches `SUM(stock_movements.qty)`, logs discrepancies.
  - `api/src/worker/index.ts` — `registerWorkers()` entry point; Phase 11 wires scheduling.
  - 14 new tests covering trigger-maintained cache, negative-stock rejection, backorder flag, recount diffs, audit log, auth guard.

- **Phase 4 — Master data: customers, suppliers, items:**
  - `api/src/modules/audit/service.ts` — `audit.record(action, entityType, entityId, before, after, ctx, tx)`: the only writer of `audit_logs`; called inside every mutating transaction (SECURITY.md §13.3, ARCHITECTURE.md §3).
  - `api/src/modules/customers/` — full CRUD: `GET /customers`, `GET /customers/:id` (with contacts + balance), `POST /customers`, `PATCH /customers/:id`, `DELETE /customers/:id` (soft-delete guard: no draft invoices, zero balance), `POST /customers/:id/contacts`; `GET /customers/:id/soa` stub (Phase 7). (FUNCTIONS.md §customers)
  - `api/src/modules/suppliers/` — full CRUD: `GET /suppliers`, `GET /suppliers/:id` (with contacts + balance), `POST /suppliers`, `PATCH /suppliers/:id`, `DELETE /suppliers/:id` (soft-delete guard: no draft bills, zero balance), `POST /suppliers/:id/contacts`; `GET /suppliers/:id/soa` stub (Phase 8). (FUNCTIONS.md §suppliers)
  - `api/src/modules/items/` — full CRUD: `GET /items`, `GET /items/:id`, `POST /items`, `PATCH /items/:id` (GST category change requires `gstCategoryChangeReason`; reason recorded in audit), `DELETE /items/:id` (guard: zero stock + no active draft/PO references), `GET /item-categories`, `POST /item-categories`. (FUNCTIONS.md §items)
  - All mutations write an audit log row inside the same transaction.
  - Offset-based pagination (`page` + `pageSize`, default 50, max 200) documented in ARCHITECTURE.md §11.5.
  - `api/src/db/client.ts` — exports `DbTx` type for typed transaction parameters in repositories and audit service.
  - Tests for all three modules: CRUD happy path, soft-delete-guard rejection, audit log written (customers, suppliers, items test files).

- **Phase 3 — Shared schemas & money/date utilities (`/shared`):**
  - `shared/src/primitives.ts` — Zod primitives: `Money` (`/^-?\d+(\.\d{1,2})?$/`), `Qty` (4dp), `IsoDate` (YYYY-MM-DD), `Email`, `Tin` (Maldives TIN: 7–10 digits), `GstCategory` (enum), `Permission`, `Role` (FUNCTIONS.md §Shared types).
  - `shared/src/money.ts` — `money` and `qty` namespaces: `add`, `sub`, `mul`, `round2`/`round4`, `negate`, `gt`, `gte`, `lt`, `lte`, `eq`, `isZero`, `isNegative`, `sum` — all using `decimal.js`, all operating on stringified decimals, never native `Number`.
  - `shared/src/gst.ts` — `gstFor(taxableValue, rate)` returning `{ gst, gross }` with **per-line** `ROUND_HALF_UP` to 2dp (ARCHITECTURE.md §4.1); `sumGstLines()` for document totals; `GST_RATES` constant map.
  - `shared/src/dates.ts` — Maldives tz helpers using native `Intl.DateTimeFormat` (no extra deps): `formatMvDate`, `todayMv`, `parseMvDate`, `endOfMvDay`, `isInMvRange`, `mvYearMonth`, `startOfMvMonth`, `endOfMvMonth`, `addDays`; `MV_TZ = 'Indian/Maldives'`.
  - `shared/src/customers.ts` — `CustomerCreate`, `CustomerPatch`, `ContactCreate` schemas (FUNCTIONS.md §customers).
  - `shared/src/suppliers.ts` — `SupplierCreate`, `SupplierPatch`, `SupplierContactCreate` schemas (FUNCTIONS.md §suppliers).
  - `shared/src/items.ts` — `ItemCreate`, `ItemPatch`, `ItemCategoryCreate` schemas (FUNCTIONS.md §items).
  - 148 tests across 7 test files; 100% function coverage on all shared modules.

- **Phase 2 — Auth module:**
  - `api/src/lib/config.ts` — boot-time env validation via Zod; exits with FATAL if `JWT_SECRET` is missing or under 32 chars (SECURITY.md §JWT).
  - `api/src/lib/redis.ts` — ioredis singleton with `maxRetriesPerRequest: null` (BullMQ-compatible) and error logging.
  - `api/src/lib/ip.ts` — `getRealIp()` per SECURITY.md priority order: X-Real-IP → X-Forwarded-For (first public IP) → raw socket; `isPrivateIp()` helper.
  - `api/src/lib/geo.ts` — `geoLookup()` supporting `disabled` (default) and `ip-api` providers; private IPs always return null.
  - `api/src/lib/mailer.ts` — Resend client with dev fallback (log-only when `RESEND_API_KEY` absent); `magicLinkEmail`, `passwordResetEmail`, `inviteEmail` template helpers.
  - `api/src/modules/auth/schema.ts` — Zod schemas for all auth request bodies (login, magic-link, reset, invite).
  - `api/src/modules/auth/repository.ts` — all DB queries: user lookup, session CRUD (with 10-session cap + oldest eviction), `touchSession` throttle (60s in-process Map capped at 10 000), login-attempt recording + `countRecentAttempts`, probabilistic `maybePurgeStaleAttempts` (~1%), `createAuthToken` / `consumeAuthToken` (atomic DELETE+RETURNING for single-use), `hasRecentResetToken`, `incrementTokenVersion`, `activateAccount`.
  - `api/src/modules/auth/service.ts` — Argon2id with OWASP params (`memoryCost: 19456, timeCost: 2, parallelism: 1`); `DUMMY_HASH_PROMISE` pre-computed at module load (never per-request); `dummyVerify` for timing-safe rejection; `signToken` / `verifyToken` (tries `JWT_SECRET` then `JWT_SECRET_PREVIOUS`); full flows: `login` (dual lockout: 5/15 min per-source, 20/1 hr per-email), `logout`, `logoutAll`, `logoutOthers`, `requestMagicLink` (15 min token), `verifyMagicLink`, `forgotPassword` (1 hr token, 10 min cooldown), `resetPassword` (increments token_version + deactivates all sessions), `acceptInvite`, `issueSession`, `toProfile`.
  - `api/src/middleware/requireAuth.ts` — JWT signature check → 30-second in-process cache keyed `(userId, sid)` → session validity check → `touchSession`; `invalidateSessionCache` exported for logout paths; prevents stolen-JWT+swapped-sid attack.
  - `api/src/modules/auth/routes.ts` — all auth endpoints with rate limiters (`rate-limiter-flexible` on Redis with `RateLimiterMemory` insurance fallback); fire-and-forget magic-link / forgot-password to prevent email enumeration; generic fixed error strings on all auth failures (SECURITY.md).
  - `api/src/server.ts` — full Hono server: `secureHeaders`, CORS, request logger (pino), auth routes, `/healthz`, `/readyz`, global error handler; boots via `@hono/node-server`; silent in `NODE_ENV=test`.
  - Tests (`api/src/modules/auth/__tests__/auth.test.ts`): happy path login, wrong password / unverified account rejection, per-source lockout threshold, timing-safe dummy-verify path, `JWT_SECRET_PREVIOUS` fallback logic, `token_version` bump invalidating existing sessions, `/me` with session list.

- Initial project documentation: `ARCHITECTURE.md`, `STACK.md`, `FUNCTIONS.md`, `CLAUDE.md`, `PROMPTS.md`, `CHANGELOG.md`.
- `SECURITY.md` carried over from previous app, with a new section _"Domain-specific additions for accounting app"_ covering financial audit log, invoice immutability, file-upload threat surface, PII export controls, PDF rate-limit, and tax-record retention (SECURITY.md §13).
- **Phase 0 — Repo & tooling scaffolding:**
  - `pnpm-workspace.yaml` with packages `api`, `web`, `shared`.
  - Root `tsconfig.json` with project references to `shared` and `api`.
  - Per-package `tsconfig.json` (NodeNext strict for `api`/`shared`; Bundler + `noEmit` for `web` via `tsconfig.app.json` / `tsconfig.node.json`).
  - ESLint 9 flat config (`eslint.config.js`): `@typescript-eslint/no-explicit-any: error`, `vue/block-lang` enforcing `<script setup lang="ts">`, and a `no-restricted-imports` rule blocking Drizzle imports outside `repository.ts` and `db/` files (ARCHITECTURE.md §2, CLAUDE.md §4–5).
  - Prettier 3 at root with `singleQuote`, `semi: false`, `printWidth: 100`.
  - Husky 9 + lint-staged: ESLint + Prettier on staged files; selective per-package typecheck in pre-commit hook.
  - Vitest configured in `api`, `web`, and `shared`; `testTimeout: 30_000` in `api` for testcontainers.
  - GitHub Actions CI workflow (`.github/workflows/ci.yml`): install → typecheck (all packages) → lint → test (all packages) on push/PR; Postgres 16 + Redis 7 service containers for api tests.
  - `docker-compose.yml` for local Postgres 16 + Redis 7 with health checks.
  - `api/.env.example` and `web/.env.example` documenting all required env vars.
  - Root `README.md` with prerequisites and run commands.

### Changed

- Added hard rule: no overriding PrimeVue styles via custom CSS, `<style>` blocks, `!important`, or deep selectors without prior owner approval — theme/`pt` only (DESIGN.md §2, CLAUDE.md §5).
- UI theme set to PrimeVue **Aura noir**; added required **light/dark/system theme selector** in the topbar, persisted in a new global `useUiStore`, with Tailwind `darkMode: 'selector'` synced to the `.app-dark` class (DESIGN.md §1, ARCHITECTURE.md §7).
- TypeScript is now explicitly **mandatory and strict on both backend and frontend** (was only implied for the frontend via `vue-tsc`). All `.vue` SFCs use `<script setup lang="ts">`; no JS source in `api/`, `web/`, or `shared/` (STACK.md, CLAUDE.md §5, ARCHITECTURE.md §7, DESIGN.md §3).
- Tech stack confirmed: Hono (over Express) for the api, Vue 3 + PrimeVue + Tailwind for web, Pinia, Zod, Drizzle, PostgreSQL, Pino, Chart.js (STACK.md).
- Replaced `nodemailer` with `resend` for transactional email — TypeScript-native, no SMTP config (STACK.md).
- Removed `@primevue/themes` (deprecated in PrimeVue 4.x; themes now bundled in `primevue` itself) (STACK.md).
- Removed `@types/cookie` (cookie v1 ships its own types) and `@types/nodemailer` (replaced by resend).
- Added supporting dependencies needed but not in the original brief: `decimal.js`, `date-fns` (+ `-tz`), `bullmq` + `ioredis`, `nodemailer`, S3 SDK, `pdf-parse`, `papaparse`, `rate-limiter-flexible`, an S3-compatible object store, ClamAV. Reasons documented per row in STACK.md.

### Security

- Documented additional controls for the accounting domain on top of the inherited auth design (SECURITY.md §13).
- Documented network exposure / deployment topology: only SPA + API origin are internet-reachable; API binds to localhost behind a reverse proxy; DB, Redis, worker, and storage are private (SECURITY.md §13.12).
- Flagged emergency JWT rotation procedure (`token_version` bump for all users) as the answer to a leaked-secret scenario where waiting out the 8-hour expiry is unacceptable.

- **Phase 1 — Database foundation:**
  - Drizzle ORM schema for all 30 tables across 13 schema files (`api/src/db/schema/`): businesses, users + auth, customers, suppliers, items + inventory, invoicing (invoices, credit notes, payments received), purchases (bills, payments made), purchase orders + GRNs, GST rates/periods/returns, files, audit log (ARCHITECTURE.md §5).
  - Migration `0000_moaning_liz_osborn.sql` generated by `drizzle-kit generate` and applied via `drizzle-kit migrate`.
  - Migration augmented with: `set_updated_at()` trigger on all 24 tables with `updated_at`; immutability triggers for invoices, bills, credit notes, and purchase orders (ARCHITECTURE.md §4.2); `update_stock_on_hand()` trigger maintaining `items.stock_on_hand` on every `stock_movements` INSERT (ARCHITECTURE.md §4.3); `REVOKE UPDATE, DELETE ON audit_logs, stock_movements FROM koosani_app` (SECURITY.md §13.3/§13.4).
  - `api/src/db/seed.ts` — seeds one demo business + one admin user with argon2id-hashed password; run with `pnpm --filter @koosani/api db:seed`.
  - Switched `api/tsconfig.json` from `moduleResolution: NodeNext` to `moduleResolution: Bundler` to unblock drizzle-kit's esbuild bundler, which cannot remap `.js` → `.ts` imports (compatible with `tsx` dev/build pipeline).

### Notes

- MIRA submission is **export-only**: MIRAconnect has no public API at the time of writing. The app produces MIRA 205 / 206 summaries and the Input Tax Statement CSV in MIRAconnect-acceptable format; the user uploads them via MIRAconnect manually (ARCHITECTURE.md §3, FUNCTIONS.md > gst).

---

<!--
TEMPLATE — copy this block to start the next version on release:

## [X.Y.Z] - YYYY-MM-DD

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
### Breaking
-->
