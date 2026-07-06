# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- `UPGRADE.md` — full codebase analysis: Zoho Invoice feature-parity matrix (17 gaps, G-1…G-17), verified flaw audit with file:line evidence and fixes (26 findings, F-1…F-26, spanning security, financial correctness, and dead plumbing), and a phased upgrade plan (Phases 20–33). Notable confirmed flaws: `token_version` middleware check is a no-op, no `requireRole`/`requirePermission` layer exists, uploads trust client MIME with no virus scan, negative-stock TOCTOU race, payment reversals skip GST period lock, SOA-extract worker never registered, and no PDF/email capability exists despite documented queues (UPGRADE.md Part 2).
- Root `pnpm dev` script that runs the api and web dev servers concurrently via pnpm's built-in `--parallel` (no new dependency; `dev:api` / `dev:web` retained for running either alone).

### Changed

- Folded the standalone `koosani_design.md` frontend reference into `DESIGN.md` and deleted it — single source of truth for UI/UX. Priority went to `koosani_design.md` for visual/style collisions (DESIGN.md §1, §11–§13). Specifically:
  - Corrected the theme: DESIGN.md said "Aura **noir**"; the codebase actually uses the custom **`Roanuedhuru`** preset (Aura + all primary colours mapped to surface greys). DESIGN.md §1 now carries the real `web/src/main.ts` preset and `main.css`/`.card` definition.
  - Added the concrete visual system: app shell (`AppLayout`/`AppSidebar`/`AppTopBar`) and view-layout markup (DESIGN.md §11), Tailwind v4 `!important` **suffix** syntax (DESIGN.md §2), full DataTable/Dialog markup (DESIGN.md §5–§6), SFC import order (DESIGN.md §3), and reference tables for colour tokens, spacing, control widths, icon sizes, and status maps (DESIGN.md §13).

### Removed

- `koosani_design.md` (content merged into `DESIGN.md`).

### Fixed

- Resolved collisions where `koosani_design.md` contradicted CLAUDE.md hard rules — the architecture rules were kept over the imported reference: money/quantity use `<MoneyInput>` + `Decimal` (not `InputNumber` bound to a number, CLAUDE.md §4); HTTP goes through `apiFetch` (not raw `axios`, DESIGN.md §8, §12); destructive confirms use PrimeVue `ConfirmDialog` (not `window.confirm()`/`alert()`, DESIGN.md §6); types/schemas come from `@koosani/shared` (not a single `src/types.ts`); structure stays `web/src/modules/<module>/views/` + `web/src/shared/ui/` (not flat `src/views`). Resort/guest/booking example code was genericized to this app's domain (invoices, customers, bills).

## [1.0.0] - 2026-05-17

### Security

- **Phase 18 — Hardening pass:**
  - **Audit log verified:** every state-changing service method (invoicing, purchases, PO, GST, files) writes a row to `audit_logs` inside the same DB transaction as the mutation. No gaps found.
  - **GST period lock verified:** all financial mutations (invoice issue, void, payment add/reverse; bill confirm, payment add/reverse; credit note issue) call `gst.assertPeriodOpen(businessId, date, ctx)` before writing. No gaps found.
  - **File download security verified:** all file downloads go through `files.getSignedUrl(businessId, fileId)` which scopes to the caller's business_id — no cross-tenant file access possible.
  - **Rate limits added** to `/reports/*?format=csv` (20/min/user), `GET /invoices/:id/pdf` (20/min/user), `GET /pos/:id/pdf` (20/min/user) via shared `api/src/lib/rateLimiter.ts` (`createRateLimiter(windowMs, max)`). These endpoints were unprotected — an authenticated user could have triggered unbounded CSV generation or PDF worker jobs (SECURITY.md §13.7).
  - **CSP pinned explicitly** in `api/src/server.ts` via `secureHeaders({ contentSecurityPolicy: { ... } })`. Previous call had no CSP arguments, leaving the header absent. Directives: `default-src 'self'`, `script-src 'self'` (no unsafe-inline/eval), `style-src 'self' unsafe-inline` (PrimeVue theming requirement), `img-src 'self' data: blob:`, `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`, `object-src 'none'`, `upgrade-insecure-requests`. Storage CDN hostname appended when `STORAGE_HOSTNAME` env var is set. `X-Frame-Options: DENY` added alongside for older-browser compatibility (SECURITY.md §13.8).
  - **Emergency JWT rotation procedure confirmed** (SECURITY.md §13.1): procedure documented and correct — deploy new `JWT_SECRET` without `JWT_SECRET_PREVIOUS`, then `UPDATE users SET token_version = token_version + 1`, then `UPDATE user_sessions SET is_active = FALSE`. Audit action `emergency_jwt_rotation` is specified. No code change required; procedure was already documented.
  - **Backup procedure confirmed** (SECURITY.md §13.10): daily encrypted DB backup, 5-year monthly snapshot retention, 7-day PITR, WORM object-lock for issued documents, quarterly restore drill. All documented; no code change required.

### Added

- **Phase 17 — Reports & Dashboard:**
  - `web/src/modules/dashboard/views/DashboardView.vue` — rewritten with real data: this-month sales + purchases KPI cards; daily sales `BarChart` (Chart.js via `vue-chartjs`); top-5 outstanding AR DataTable with link to customer SOA; low-stock items DataTable; GST preview card (output tax, input tax, net payable). All data fetched in parallel via `Promise.allSettled` — partial failures show a warning toast without blocking the page (FUNCTIONS.md §reports, §inventory).
  - `web/src/modules/reports/views/ReportsHubView.vue` — landing page with card grid linking to each report.
  - `web/src/modules/reports/views/SalesReportView.vue` — from/to date range + groupBy (customer/item/day) filter bar; `NetGroupRow` DataTable (group, docs, subtotal, GST, total); CSV export via `apiFetchDownload` (FUNCTIONS.md §reports).
  - `web/src/modules/reports/views/PurchasesReportView.vue` — same pattern as sales; groupBy options are supplier/item/day (FUNCTIONS.md §reports).
  - `web/src/modules/reports/views/StockValuationReportView.vue` — asOf date + valuation method (avg/fifo) filter; `StockValuationRow` DataTable (item, SKU, qty, avg cost, value); total value footer row; CSV export (FUNCTIONS.md §reports).
  - `web/src/modules/reports/views/AgedReceivablesView.vue` — asOf date filter; `AgedEntityRow` DataTable with current / 1–30 / 31–60 / 61–90 / 91+ age buckets; 91+ days highlighted red; ExternalLink to customer SOA; CSV export (FUNCTIONS.md §reports).
  - `web/src/modules/reports/views/AgedPayablesView.vue` — same structure as receivables; ExternalLink navigates to supplier SOA (FUNCTIONS.md §reports).
  - `web/src/modules/reports/views/GstSummaryReportView.vue` — from/to date range; summary cards (output tax, input tax, net payable); output tax by category DataTable; input tax by category DataTable; CSV export. Live preview — no period lock required (FUNCTIONS.md §reports).
  - `web/src/router/index.ts` — added protected routes: `/reports`, `/reports/sales`, `/reports/purchases`, `/reports/stock-valuation`, `/reports/aged-receivables`, `/reports/aged-payables`, `/reports/gst-summary`.

- **Phase 16 — GST UI:**
  - `web/src/modules/gst/views/GstView.vue` — two-tab layout (PrimeVue Tabs): **Periods** tab shows all GST periods sorted newest-first with StatusTag, period date range, MIRAconnect ref, and View button navigating to the period detail; **Rates** tab shows historical rates DataTable (category label, percentage, valid from/to) and an "Add Rate Override" form (category Select, decimal fraction InputText, validFrom DatePicker) calling `POST /gst/rates` — 403 handled with a specific message (FUNCTIONS.md §gst, DESIGN.md §5).
  - `web/src/modules/gst/views/GstReturnView.vue` — period detail page; loads period from list then return data; **Build Return** button calls `POST /gst/periods/:id/build` then polls `GET /gst/periods/:id/return` every 3 s until `status === 'built'` or error; 429 rate-limit surfaced as `warn` toast; MIRA 205 summary card (taxable supplies, output tax, input tax, net payable); MIRA 206 summary card (taxable supplies, output tax, net payable); file download buttons open signed URLs in new tab (no auth needed); **Lock Period** button (built status) opens Dialog asking for MIRAconnect reference → `POST /gst/periods/:id/lock`; **Unlock** button (locked status, admin only) opens Dialog asking for reason → `POST /gst/periods/:id/unlock`; poll timer cleared `onBeforeUnmount` (FUNCTIONS.md §gst).
  - `web/src/shared/ui/BarChart.vue` — Chart.js bar chart wrapper via `vue-chartjs`; accepts `labels`, `datasets`, `height` (default 220), `showLegend` (default false); MVR formatter on y-axis ticks and tooltip; uses `CHART_COLORS_MUTED` palette (DESIGN.md §9).
  - `web/src/shared/ui/chartColors.ts` — fixed palette: 5 solid colours (`CHART_COLORS`) and 5 muted rgba variants (`CHART_COLORS_MUTED`) per DESIGN.md §9.
  - `web/src/lib/apiFetch.ts` — added `apiFetchDownload(path, filename)`: authenticated blob fetch (includes session cookie), creates an `<a>` element with an object URL, triggers download, cleans up.
  - `web/src/router/index.ts` — added protected routes: `/gst`, `/gst/periods/:id`.

- **Phase 15 — Purchases & PO UI:**
  - `web/src/modules/purchases/views/BillListView.vue` — paginated bill list; status filter (draft/confirmed/partially_paid/paid) and search; row click navigates to detail; "New Bill" navigates to editor (FUNCTIONS.md §purchases).
  - `web/src/modules/purchases/views/BillEditorView.vue` — full-page draft bill create/edit; supplier AutoComplete; supplier ref, bill date, due date, notes; line editor identical in shape to invoice editor but uses `unitCost`; live GST totals via `gstFor` + `sumGstLines` from `@koosani/shared`; file-attach via `POST /bills/:id/attach` (FUNCTIONS.md §purchases, DESIGN.md §6).
  - `web/src/modules/purchases/views/BillDetailView.vue` — full-page bill detail; **Confirm** button (draft only, ConfirmDialog, `POST /bills/:id/confirm`); **Payments Made** panel (list, add Dialog, reverse per-row); **Attach** button uploads supplier invoice scan (`POST /bills/:id/attach`); link to originating PO if `poId` is set (FUNCTIONS.md §purchases).
  - `web/src/modules/purchases/views/SoaExtractView.vue` — supplier SOA upload page; supplier AutoComplete + file picker (CSV/PDF); uploads to `POST /soa-extract`; polls `GET /soa-extract/:jobId` every 2 s until done/failed; extraction-result review DataTable shows date, ref, description, amount, matched bill number (with link) vs "No match" badge; reset flow to try another file (FUNCTIONS.md §purchases).
  - `web/src/modules/po/views/PoListView.vue` — paginated PO list; status filter (draft/approved/partially_received/received/cancelled); row click navigates to detail (FUNCTIONS.md §po).
  - `web/src/modules/po/views/PoEditorView.vue` — full-page PO draft create/edit; supplier AutoComplete; order date, expected date, notes; line editor with `qtyOrdered` + `unitCost` (no GST on POs per ARCHITECTURE.md); live subtotal via `money.sum` from `@koosani/shared` (FUNCTIONS.md §po, DESIGN.md §6).
  - `web/src/modules/po/views/PoDetailView.vue` — full-page PO detail; **Approve** button (draft, ConfirmDialog, `POST /pos/:id/approve`); **Cancel** button (draft/approved, Dialog with required reason, `POST /pos/:id/cancel` — blocked if GRNs exist); **Receive Goods** button (approved/partially_received) opens GRN Dialog with a checklist of PO lines (select lines, enter qtyReceived and unitCost, received date), submits `POST /pos/:id/grns`; **Convert to Bill** button (partially_received/received with GRNs) calls `POST /pos/:id/bill` and navigates to the new draft bill; GRNs section lists all past receipts with line detail (FUNCTIONS.md §po).
  - `web/src/modules/suppliers/views/SupplierSoaView.vue` — supplier statement of account; from/to date range (defaults to current MV month); summary cards (total billed, total paid, closing balance); transactions DataTable with date, type, reference, debit, credit, running balance; balance colour-coded amber when outstanding; calls `GET /suppliers/:id/soa?from&to` (FUNCTIONS.md §suppliers).
  - `web/src/router/index.ts` — added protected routes: `/bills`, `/bills/soa-extract`, `/bills/new`, `/bills/:id`, `/bills/:id/edit`, `/pos`, `/pos/new`, `/pos/:id`, `/pos/:id/edit`, `/suppliers/:id/soa`.

- **Phase 14 — Invoicing UI:**
  - `web/src/modules/invoicing/views/InvoiceListView.vue` — paginated invoice list; server-side filter by status (`draft/issued/partially_paid/paid/void`) and free-text search; row click navigates to detail; "New Invoice" navigates to editor (FUNCTIONS.md §invoicing).
  - `web/src/modules/invoicing/views/InvoiceEditorView.vue` — full-page draft create/edit form; customer AutoComplete (searches `GET /customers`); due date DatePicker; Notes textarea; line editor with item AutoComplete (searches `GET /items`, auto-fills description / price / GST category on select); qty (4dp) + unit price (`MoneyInput`) + GST category Select per line; live per-line and invoice totals computed via `gstFor` + `sumGstLines` from `@koosani/shared` (no hand-rolled GST math in Vue); saves via `POST /invoices` (create) or `PATCH /invoices/:id` (edit draft) (FUNCTIONS.md §invoicing, DESIGN.md §6).
  - `web/src/modules/invoicing/views/InvoiceDetailView.vue` — full-page invoice detail; summary header (customer, issued date, due date, balance due, notes); read-only line items DataTable with per-line GST; invoice totals; **Issue** button (draft only, ConfirmDialog, calls `POST /invoices/:id/issue`); **Void** button (issued/partially_paid, Dialog with required reason field, calls `POST /invoices/:id/void`); **Payments panel** — active payments DataTable, "Record Payment" Dialog (amount, method, ref, date), reverse button per payment (`DELETE /invoices/:id/payments/:pid`); **PDF** button calls `GET /invoices/:id/pdf` and opens signed URL in new tab; **Credit Notes** panel shows auto-created reversing CNs (FUNCTIONS.md §invoicing, DESIGN.md §6).
  - `web/src/modules/customers/views/CustomerSoaView.vue` — customer statement of account; from/to DatePicker range (defaults to current month); summary cards (opening balance, total invoiced, total received, closing balance); entries DataTable with date, type, reference, debit, credit, running balance columns; balance sign colour-coded (amber = outstanding); calls `GET /customers/:id/soa?from&to&format=json` (FUNCTIONS.md §customers).
  - `web/src/router/index.ts` — added protected routes: `/invoices`, `/invoices/new`, `/invoices/:id`, `/invoices/:id/edit`, `/customers/:id/soa`.

- **Dark mode** — full light/dark toggle in the top bar (sun/moon icon button). Layout surfaces (`SidebarNav`, `TopBar`, `BreadcrumbBar`, `AppLayout` page background, `.card`) now carry explicit `dark:bg-surface-*` / `dark:text-surface-*` / `dark:border-surface-*` Tailwind classes. PrimeVue component internals auto-respond via the theme's `darkModeSelector: '.dark'`. Dark mode choice persisted in `ui` store (`koosani-theme` localStorage key); defaults to system preference (DESIGN.md §1).

### Changed

- Upgraded Tailwind CSS from v3 to v4: replaced `tailwind.config.js` + `postcss.config.js` with `@tailwindcss/vite` Vite plugin; updated `main.css` to `@import "tailwindcss"` + `@custom-variant dark` for `.dark` selector; removed `autoprefixer` and `postcss` dev dependencies (STACK.md §Frontend).

### Added

- **Phase 13 — Master-data UI (Customers, Suppliers, Items):**
  - `web/src/shared/ui/EntityList.vue` — generic `DataTable` wrapper; server-side pagination, lazy loading, debounced search input, configurable empty state; accepts column slots; emits `page`, `search`, `create`, `row-click`.
  - `web/src/modules/customers/views/CustomersView.vue` — paginated customers list (name, TIN, email, phone, terms); server-side `page` / `pageSize` / `q` params; `Customer` interface exported (FUNCTIONS.md §customers).
  - `web/src/modules/customers/CustomerDrawer.vue` — create / edit / soft-delete drawer; validates with `CustomerCreate` / `CustomerCreate.partial()` from `@koosani/shared`; delete guarded by `useConfirm`; 409 error surfaced as human message.
  - `web/src/modules/suppliers/views/SuppliersView.vue` — suppliers list (name, TIN, email, phone, terms); `Supplier` interface exported (FUNCTIONS.md §suppliers).
  - `web/src/modules/suppliers/SupplierDrawer.vue` — create / edit / soft-delete drawer; validates with `SupplierCreate` / `SupplierCreate.partial()`.
  - `web/src/modules/items/views/ItemsView.vue` — items list (SKU, name, unit, category, GST category, price); loads categories from `GET /item-categories` for name resolution; `Item` and `Category` interfaces exported (FUNCTIONS.md §items).
  - `web/src/modules/items/ItemDrawer.vue` — create / edit / soft-delete drawer; validates with `ItemCreate` / `ItemPatch`; conditionally renders `gstCategoryChangeReason` field when GST category changes on an existing item (audit-required per FUNCTIONS.md §items).
  - `web/src/router/index.ts` — added `/customers`, `/suppliers`, `/items` as protected children of `AppLayout`.
  - `web/src/App.vue` — added `<ConfirmDialog />` for delete confirmations.

- **Phase 12 — Frontend foundation:**
  - `web/index.html` — Vite SPA entry point.
  - `web/tailwind.config.js` — Tailwind v3 config; `darkMode: ['class', '.app-dark']` aligned with PrimeVue dark selector; content scoped to `src/**/*.{vue,ts,tsx}`.
  - `web/postcss.config.js` — PostCSS with Tailwind + Autoprefixer.
  - `web/vite.config.ts` — proxy `/api/*` → `localhost:3000/*` with path rewrite (strips `/api` prefix); `@` alias → `src/`.
  - `web/src/assets/main.css` — Tailwind directives (`@tailwind base/components/utilities`).
  - `web/src/main.ts` — creates Vue app; registers Pinia, Vue Router, PrimeVue (Aura preset with noir palette override, `darkModeSelector: '.app-dark'`), ConfirmationService, ToastService; imports PrimeIcons CSS.
  - `web/src/App.vue` — root component; renders `<Toast />` + `<RouterView />`.
  - `web/src/router/index.ts` — history router; public routes (`/login`, `/forgot-password`, `/reset-password`, `/accept-invite`); protected shell route (`/`) with `AppLayout` wrapping `DashboardView`; catch-all 404; `beforeEach` guard calls `authStore.bootstrap()` once then enforces auth/public redirect.
  - `web/src/stores/auth.ts` — Pinia store; `user`, `bootstrapped`, `isAuthenticated`; `bootstrap()` calls `GET /me` idempotently; `logout()` calls `POST /auth/logout` then redirects to `/login`.
  - `web/src/stores/ui.ts` — Pinia store; `theme` (`light`/`dark`/`system`), `isDark` computed; `setTheme()` persists to `localStorage` and toggles `.app-dark` on `<html>`; listens to `prefers-color-scheme` change for system mode.
  - `web/src/lib/apiFetch.ts` — typed fetch wrapper; prepends `/api`; `credentials: 'include'`; 401 → `window.location.replace('/login')`; non-ok throws `ApiError(status, message)`.
  - `web/src/modules/auth/views/LoginView.vue` — email + password form; Zod-validated via `LoginSchema` from `@koosani/shared`; fixed error string on any failure ("Invalid email or password."); supports `?redirect` query.
  - `web/src/modules/auth/views/MagicLinkView.vue` — email-only form; always shows "If an account exists…" on submit regardless of API response (no email enumeration).
  - `web/src/modules/auth/views/ResetPasswordView.vue` — password + confirm form; validates via `ResetPasswordSchema` + local `confirmPassword` refinement; reads `?token` from query.
  - `web/src/modules/auth/views/AcceptInviteView.vue` — name + password + confirm form; validates via `AcceptInviteSchema`; reads `?token` from query.
  - `web/src/modules/auth/views/NotFoundView.vue` — 404 view with back link.
  - `web/src/modules/dashboard/views/DashboardView.vue` — placeholder dashboard.
  - `web/src/shared/ui/AppLayout.vue` — app shell: fixed sidebar + flex column of topbar / breadcrumbs / `<main>` with `<RouterView />`.
  - `web/src/shared/ui/SidebarNav.vue` — vertical nav with groups (Dashboard, Customers/Suppliers/Items, Invoices/Credit Notes, Bills/POs, GST, Reports); active-route highlighting via `useRoute`.
  - `web/src/shared/ui/TopBar.vue` — right-aligned user menu (PrimeVue `Menu` popup); theme picker (light / dark / system); sign-out.
  - `web/src/shared/ui/BreadcrumbBar.vue` — PrimeVue `Breadcrumb` driven by `route.matched[].meta.title`.
  - `web/src/shared/ui/StatusTag.vue` — PrimeVue `Tag` wrapper; maps snake_case status strings to severity and human label.
  - `web/src/shared/ui/DateCell.vue` — formats ISO date string to "DD MMM YYYY" via date-fns; shows "—" for null/undefined.
  - `web/src/shared/ui/MoneyCell.vue` — right-aligned tabular-numeral money display; locale formatter; shows "—" for null.
  - `web/src/shared/ui/MoneyInput.vue` — string-valued money input; normalises to 2 d.p. on blur; emits string; never uses `Number`.
  - `web/src/shared/ui/EmptyState.vue` — three variants: first-time / filtered / restricted; slot for action button.
  - `shared/src/auth.ts` — `LoginSchema`, `ForgotPasswordSchema`, `ResetPasswordSchema`, `AcceptInviteSchema` Zod schemas shared with the backend (FUNCTIONS.md §auth).
  - `shared/src/index.ts` — exports `auth.ts`.
  - New dependency `@primeuix/themes@2.0.3` (Aura preset) added to `@koosani/web` (STACK.md §Frontend).

- **Phase 11 — Reports (read-only aggregations + CSV export):**
  - `api/src/modules/reports/repository.ts` — all DB aggregation queries: sales invoices/credit-notes by customer, item, day; purchases bills by supplier, item, day; `stockMovementsWithCost` (joins `stock_movements` → `grn_lines` for unit cost); `agedReceivablesRaw` / `agedPayablesRaw` (per-invoice/bill outstanding rows); `gstSummaryInvoiceLines`, `gstSummaryCNLines`, `gstSummaryBillLines` for arbitrary date ranges. All functions are pure reads — no writes anywhere (ARCHITECTURE.md §3).
  - `api/src/modules/reports/service.ts` — `salesReport(businessId, from, to, groupBy)` nets invoice aggregates minus credit notes per group key; `purchasesReport` aggregates confirmed bills; `stockValuationReport` implements weighted-average-cost (default) and FIFO lot-consumption (application layer) with `asOf` date filtering; `agedReceivablesReport` / `agedPayablesReport` bucket outstanding balances into current / 1-30 / 31-60 / 61-90 / 91+ days overdue per entity; `gstSummaryReport` produces live output vs input tax preview for an arbitrary date range without storing anything. CSV helpers for every report type (FUNCTIONS.md §reports).
  - `api/src/modules/reports/routes.ts` — `GET /reports/sales`, `GET /reports/purchases`, `GET /reports/stock-valuation`, `GET /reports/aged-receivables`, `GET /reports/aged-payables`, `GET /reports/gst-summary`; all require auth; `format=csv` returns `text/csv` with `Content-Disposition: attachment` (FUNCTIONS.md §reports).
  - `api/src/server.ts` — registers `reportRoutes` at `/reports`.
  - 16 new tests: sales groupBy=customer netting, groupBy=item, groupBy=day; purchases groupBy=supplier, groupBy=item; stock valuation avg cost math (2-lot weighted avg), FIFO lot consumption, `asOf` date filter excludes future movements; aged receivables 4-bucket assertion with partial payment; aged payables bucket check; GST summary output vs input totals; CSV header assertions for every report type; HTTP auth guard (401 without cookie); HTTP CSV format and JSON format route responses.
  - **FUNCTIONS.md §reports** — updated from stub to full signatures for all 6 routes and 6 service functions, with result type definitions.

- **Phase 10 — GST return building (MIRA 205 / 206 + Input Tax Statement):**
  - `gst.buildReturn(businessId, periodId, ctx)` — aggregates issued invoices, credit notes, and confirmed bills for a period by GST category; produces MIRA 205 (general sector) and MIRA 206 (tourism sector) JSON summaries + an Input Tax Statement CSV; uploads CSV via the `files` module; stores snapshot in `gst_returns` (append-only per SECURITY.md §13.4); marks period `built` (FUNCTIONS.md §gst).
  - `gst.getLatestReturn(businessId, periodId)` — retrieves the most recently built return snapshot for a period (FUNCTIONS.md §gst).
  - Repository additions: `getInvoiceLinesForPeriod`, `getCreditNoteLinesForPeriod`, `getBillLinesForPeriod` — Drizzle aggregation queries that read persisted `gst_amount` / `line_total` columns only; never recompute rates (ARCHITECTURE.md §3). `insertGstReturn`, `getLatestReturnForPeriod`, `markPeriodBuilt`.
  - `POST /gst/periods/:id/build` wired to enqueue a job on the `gst` BullMQ queue; rate-limited 3 requests per 5 minutes per business (SECURITY.md §13.7).
  - `GET /gst/periods/:id/return` returns latest build status, MIRA 205/206 summary JSON, and signed download URLs for CSV artefacts.
  - `api/src/worker/gst.ts` — BullMQ worker handler for the `gst` queue; calls `gst.buildReturn` and logs completion. Registered in `worker/index.ts`.
  - `gstQueue` added to `lib/queues.ts`.
  - Tests: totals verified against manually-computed fixture (MIRA 205: taxable supplies 900.00, output tax 72.00, input tax 40.00, net payable 32.00; MIRA 206: taxable supplies 1000.00, output tax 170.00, net payable 170.00); audit row written; period status transitions to `built`; `getLatestReturn` returns most recent snapshot; empty-period build produces null MIRA 205/206; route returns built status with signed ITS file URL.
  - **ARCHITECTURE.md §3** — added MIRAconnect integration note: the app exports files for manual upload; it does not submit returns programmatically.
  - **FUNCTIONS.md §gst** — updated with full signatures for `buildReturn`, `getLatestReturn`, and all new repository functions.

- **Phase 9 — Purchase Orders (PO lifecycle, GRN, PO→Bill):**
  - `shared/src/po.ts` — Zod schemas: `PoLineCreate`, `PoDraftCreate`, `PoDraftPatch`, `PoCancelBody`, `GrnLineCreate`, `GrnCreate` — exported from `@koosani/shared` (FUNCTIONS.md §po).
  - `api/src/lib/queues.ts` — added `pdfQueue` (BullMQ, `pdf` queue name; handles invoice, credit note, PO, SOA PDF generation per ARCHITECTURE.md §8).
  - `api/src/modules/po/repository.ts` — full repository: PO CRUD + lines, per-business advisory-locked number allocation (`PO-NNNNNN`), GRN CRUD + lines, `incrementPoLineReceived` (atomic SQL), `getAggregatedGrnLinesByPo` (joins grn_lines + po_lines + items to aggregate received quantities with GST category).
  - `api/src/modules/po/service.ts` — `createDraft` (PO + lines, subtotal = Σ qty×cost), `patchDraft` (drafts only; replaces lines), `approvePo` (advisory-locked number allocation, enqueues PDF job), `cancelPo` (blocked if GRNs exist), `canReceive` (qty check against `qtyOrdered`, respects `allowBackorders` flag), `createGrn` (validates all lines then commits stock via `inventory.applyMovement` with `grn` source, increments `po_line.qty_received`, derives PO status: `partially_received` → `received`), `getPo`, `listPos`, `getGrn`, `createBillFromPo` (aggregates GRN quantities per PO line, calls `purchases.createDraft`, links `bill.po_id`) (FUNCTIONS.md §po).
  - `api/src/modules/po/routes.ts` — `GET /pos`, `GET /pos/:id`, `POST /pos`, `PATCH /pos/:id`, `POST /pos/:id/approve`, `POST /pos/:id/cancel`, `GET /pos/:id/pdf` (501 stub — Phase 12), `POST /pos/:id/grns`, `POST /pos/:id/bill`, `GET /grns/:id` (FUNCTIONS.md §po).
  - `api/src/server.ts` — registers `poRoutes` at `/pos` and `grnRoutes` at `/grns`.
  - 10 new tests: GRN stock commitment (partial receive, stock-on-hand verified via DB), full-receive → `received` status, sequential `PO-000001` allocation, over-receipt rejection (`allowBackorders = false`), over-receipt allowed (`allowBackorders = true`), GRN on draft PO rejected, bill prefill (qty = GRN received, GST applied, `poId` linked), bill rejected without GRN lines, bill rejected from draft PO, cancel with/without GRNs.

- **Phase 8 — Purchases (bills), files module, and SOA extraction:**
  - `shared/src/purchases.ts` — Zod schemas: `BillLineCreate`, `BillDraftCreate`, `BillDraftPatch`, `BillPaymentCreate`, `SoaExtractLine` — all exported from `@koosani/shared` (FUNCTIONS.md §purchases).
  - `api/src/lib/storage.ts` — dual-backend storage abstraction (`local` for dev/test, `s3` for prod, controlled by `FILES_STORAGE` env var); `sha256Hex` and `isAllowedMime` helpers; MIME allow-list: PDF, PNG, JPEG, WebP, CSV, XLS, XLSX (SECURITY.md §13.5).
  - `api/src/lib/soa-parser.ts` — `parseCsv(text) → SoaExtractLine[]` (papaparse, case-insensitive column headers), `parsePdf(buffer) → Promise<SoaExtractLine[]>` (pdf-parse + text line extraction), `parseTextLines(text) → SoaExtractLine[]` (date ref [description] amount pattern).
  - `api/src/lib/queues.ts` — added `soaExtractQueue` (BullMQ, `soa-extract` queue name).
  - `api/src/modules/files/repository.ts` — `insertFile`, `findById`, `attachToEntity`.
  - `api/src/modules/files/service.ts` — `uploadFile` (MIME + 25 MB validation, SHA-256 keyed storage path, DB record + audit), `getSignedUrl` (1-hour TTL), `attachToEntity`.
  - `api/src/modules/files/routes.ts` — `POST /files` (multipart upload), `GET /files/:id/url` (FUNCTIONS.md §files).
  - `api/src/modules/purchases/repository.ts` — full repository: bill CRUD + lines, advisory-locked bill number allocation (`BILL-NNNNNN`), payment CRUD + reversal, active-payment sum, SOA queries, `findMatchingBill` for SOA line matching.
  - `api/src/modules/purchases/service.ts` — `createDraft` (preliminary GST rates), `patchDraft` (replaces lines, recomputes totals), `confirmBill` (re-snapshots GST at billDate, commits stock via `inventory.applyMovement` with `grn` source for goods-in, allocates bill number, period-lock checked, audit written), `addPayment` / `reversePayment` (syncs `paid_amount`, derives status), `getBill`, `listBills`, `buildSupplierSoa` (entries + running balance), `matchSoaLine` (±14-day date window, ref + amount match) (FUNCTIONS.md §purchases).
  - `api/src/modules/purchases/routes.ts` — `GET /bills`, `GET /bills/:id`, `POST /bills`, `PATCH /bills/:id`, `POST /bills/:id/confirm`, `POST /bills/:id/payments`, `DELETE /bills/:id/payments/:paymentId`, `POST /bills/:id/attach` (file upload + entity link), `POST /soa-extract` (multipart upload → BullMQ job), `GET /soa-extract/:jobId` (poll) (FUNCTIONS.md §purchases).
  - `api/src/worker/soa-extract.ts` — BullMQ worker: retrieves file from storage, parses CSV/PDF, calls `purchases.matchSoaLine` per line, returns `{ matches: [{ line, billId }] }`.
  - `api/src/modules/suppliers/routes.ts` — implemented `GET /suppliers/:id/soa?from&to` (calls `purchases.buildSupplierSoa`, returns `{ entries, closingBalance }`) (FUNCTIONS.md §suppliers).
  - `api/src/server.ts` — registers `billRoutes` at `/bills` and `fileRoutes` at `/files`.
  - 12 new tests: confirm math (GST totals, sequential number allocation), payment paidAmount + status derivation, immutability guard (double-confirm), period-lock rejection, SOA CSV parse (canonical + no-description + reference-alias + invalid-row skip), SOA text line parse, SOA PDF parse.

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
