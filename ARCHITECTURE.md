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

| Module      | Owns                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| `auth`      | Login, sessions, JWT, password reset, invite, magic link (per SECURITY.md)    |
| `users`     | User CRUD, roles, permissions                                                 |
| `customers` | Customer master, contact persons, billing addresses, credit terms, TIN        |
| `suppliers` | Supplier master, contact persons, payment terms, TIN                          |
| `items`     | Item master (SKU, name, unit, GST category, default price/cost), categories   |
| `inventory` | Stock-on-hand per item, movement ledger, adjustments, stock counts            |
| `invoicing` | Sales invoices, credit notes, payments received, customer SOA                 |
| `purchases` | Supplier invoices (bills), payments made, supplier SOA                        |
| `po`        | Purchase orders, goods receipt notes (GRN), PO→bill matching                  |
| `gst`       | GST rate config, MIRA 205 / 206 builders, Input Tax Statement, period locking |
| `reports`   | Cross-module reports (sales, purchases, stock valuation, P&L summary)         |
| `files`     | Upload, virus-scan handoff, signed-URL download for PDFs and uploaded docs    |
| `audit`     | Append-only audit log for all financial mutations                             |

**Forbidden cross-module patterns:**

- `invoicing` reading `items.stock_on_hand` directly → must call `inventory.reserveStock()` / `inventory.commitStock()`.
- `gst` recomputing tax from raw line items → must read from `invoices.gst_amount` / `bills.input_gst_amount` already persisted.
- Any module writing to `audit_logs` directly except through `audit.record(...)`.

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
  - DB trigger that raises on UPDATE of frozen columns when status ≠ `draft`.
- Corrections to an issued invoice happen via a **credit note** (separate row, references original `invoice_id`).
- Invoice numbers come from a per-business sequence with no gaps. Allocated only on issue, never on draft create.

### 4.3 Stock movement ledger

- `stock_movements` is append-only. Every change to on-hand stock is a row: `+10` (GRN), `-3` (invoice line), `-1` (adjustment write-off), etc.
- `items.stock_on_hand` is a _derived_ cache (`SUM(stock_movements.qty)` for that item). Recomputed by trigger on insert into `stock_movements`, or read live via view — pick one and document here. **Decision:** trigger-maintained column for read speed; nightly reconcile job verifies.
- Negative stock is rejected by default (configurable per-business flag for back-orders).

### 4.4 GST period locking

- Once a GST return is generated for a period (e.g., `2026-Q1`), that period is **locked**. No new invoices, credit notes, or bills may be back-dated into a locked period. Stored in `gst_periods` table with `locked_at`, `locked_by`, `mira_return_id`.
- Late entries that would have belonged to a locked period must be entered with today's date and noted on the next return.

### 4.5 Append-only audit log

- Every state-changing service call records to `audit_logs` (`user_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `ip`, `at`). No UPDATE, no DELETE on this table — enforced by revoking those grants from the app role.

---

## 5. Database schema (overview)

Detailed column lists live in Drizzle schema files. This section is the high-level relationship map.

```
businesses ──┬── users ──── user_sessions
             │      └────── auth_logs
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

| Queue         | Job                                                                  |
| ------------- | -------------------------------------------------------------------- |
| `pdf`         | Render invoice PDF, credit note PDF, PO PDF, SOA PDF                 |
| `email`       | Send invoice, send reset link, send invite                           |
| `gst`         | Build MIRA 205 / 206 export bundle for a period                      |
| `soa-extract` | Parse uploaded supplier SOA (PDF/CSV) → match to bills               |
| `reconcile`   | Nightly: verify `items.stock_on_hand` matches `SUM(stock_movements)` |

Jobs are **idempotent**. Each takes a domain ID (e.g., `invoiceId`) and re-reads current state; never trust payload to carry mutable data.

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

## 12. What lives where (directory layout)

```
/
├── api/
│   ├── src/
│   │   ├── modules/<name>/{routes,service,repository,schema}.ts
│   │   ├── db/{schema,migrations,client}.ts
│   │   ├── middleware/
│   │   ├── lib/                 (money, dates, pdf, mailer, queue)
│   │   ├── worker/              (job handlers)
│   │   └── server.ts
│   └── package.json
├── web/
│   ├── src/
│   │   ├── modules/<name>/{views,components,store,routes,api}.ts
│   │   ├── shared/              (apiFetch, layout, ui)
│   │   ├── router.ts
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
