# Tech Stack

> Single source of truth for what the app is built with. Update in the same PR that introduces or removes a dependency.

---

## Decisions at a glance

| Concern          | Choice                                                            | Why this and not the obvious alternative                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language         | **TypeScript** (strict) — **mandatory** on backend _and_ frontend | Shared Zod-derived types only work end-to-end if both sides are TS. `strict: true`, no implicit `any`, no JS source files in `api/`, `web/`, or `shared/`.                     |
| API framework    | **Hono**                                                          | Faster cold start and lower overhead than Express; first-class TS types; runs anywhere (Node, Bun, edge). For a JSON-only REST API this app needs, Express buys nothing extra. |
| Frontend         | **Vue 3** — `<script setup lang="ts">` only                       | Every `.vue` SFC uses `lang="ts"`. No `<script setup>` without `lang="ts"`, no plain-JS components.                                                                            |
| UI components    | **PrimeVue**                                                      | DataTable, Calendar, Dialog handle the heavy lifting; matches accounting-app UX expectations.                                                                                  |
| Styling          | **Tailwind CSS**                                                  | Layout and spacing only. PrimeVue handles component internals.                                                                                                                 |
| State            | **Pinia**                                                         | —                                                                                                                                                                              |
| Validation       | **Zod**                                                           | One schema, used on both api and web (shared package).                                                                                                                         |
| ORM / migrations | **Drizzle** + **drizzle-kit**                                     | TS-native, no codegen runtime, transparent SQL.                                                                                                                                |
| Database         | **PostgreSQL 16+**                                                | —                                                                                                                                                                              |
| Logging          | **Pino**                                                          | —                                                                                                                                                                              |
| Charts           | **Chart.js** via `vue-chartjs`                                    | —                                                                                                                                                                              |

---

## Backend (api + worker)

| Package                                                | Purpose                           | Notes                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono`                                                 | HTTP framework                    | Node adapter (`@hono/node-server`)                                                                                                                                                                                                                                                            |
| `@hono/zod-validator`                                  | Bind Zod schemas to routes        | Use for every input                                                                                                                                                                                                                                                                           |
| `zod`                                                  | Schemas                           | Shared with web via `shared/`                                                                                                                                                                                                                                                                 |
| `drizzle-orm`                                          | Queries                           | Use the query builder, not raw SQL, except in migrations                                                                                                                                                                                                                                      |
| `drizzle-kit`                                          | Migrations                        | `drizzle-kit generate` + `drizzle-kit migrate`                                                                                                                                                                                                                                                |
| `postgres` (postgres.js)                               | DB driver                         | Drizzle's preferred Node driver                                                                                                                                                                                                                                                               |
| `pino` + `pino-http`                                   | Logging                           | JSON in prod, `pino-pretty` in dev                                                                                                                                                                                                                                                            |
| `argon2`                                               | Password hashing                  | Per SECURITY.md                                                                                                                                                                                                                                                                               |
| `jsonwebtoken`                                         | JWT                               | HS256, per SECURITY.md                                                                                                                                                                                                                                                                        |
| `cookie`                                               | Cookie parse/serialise            | —                                                                                                                                                                                                                                                                                             |
| `helmet` (Hono port: `hono/secure-headers`)            | Security headers                  | Use Hono's built-in `secureHeaders` middleware                                                                                                                                                                                                                                                |
| `decimal.js`                                           | Money math                        | Never `Number` for currency                                                                                                                                                                                                                                                                   |
| `date-fns` + `date-fns-tz`                             | Dates                             | Maldives is `Indian/Maldives` (UTC+5, no DST)                                                                                                                                                                                                                                                 |
| `bullmq`                                               | Job queue                         | Redis-backed                                                                                                                                                                                                                                                                                  |
| `ioredis`                                              | Redis client                      | BullMQ dependency                                                                                                                                                                                                                                                                             |
| `resend`                                               | Email (transactional)             | Replaced nodemailer — TypeScript-native SDK, no SMTP config needed. `lib/mailer.ts`'s `SendOpts.attachments` (Buffer content, no base64 step) added Phase 24 for invoice/statement PDF attachments. No `RESEND_API_KEY` set → dev fallback logs the email instead of sending, same as before. |
| `@react-pdf/renderer`                                  | PDF generation                    | Decided Phase 23: declarative components, no headless browser — see _Open decisions_ below (was unresolved through Phase 20). Templates built with `React.createElement` (no JSX) to avoid adding a `jsx` tsconfig option to a backend-only package.                                          |
| `react` + `@types/react` (dev)                         | `@react-pdf/renderer` peer dep    | Not used for anything else in `api` — pulled in solely so react-pdf can build its element tree.                                                                                                                                                                                               |
| `papaparse`                                            | CSV parse (SOA extract)           | —                                                                                                                                                                                                                                                                                             |
| `pdf-parse`                                            | PDF text extraction (SOA extract) | —                                                                                                                                                                                                                                                                                             |
| `file-type`                                            | Magic-byte MIME sniff on uploads  | Added Phase 20 (SECURITY.md §13.5 rule 1, UPGRADE.md F-3)                                                                                                                                                                                                                                     |
| `sharp`                                                | Strip EXIF from uploaded images   | Added Phase 20 (SECURITY.md §13.5 rule 8, UPGRADE.md F-3)                                                                                                                                                                                                                                     |
| ClamAV (`clamd`, spoken over raw TCP — no npm client)  | Virus scan uploads                | Decided Phase 20: self-hosted clamd (`docker-compose.yml`'s `clamav` service). `api/src/lib/virusScan.ts` implements clamd's INSTREAM protocol directly; no client library needed. `CLAMAV_HOST`/`CLAMAV_PORT` config.                                                                        |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | Object storage                    | Works with any S3-compatible (Cloudflare R2, MinIO, AWS)                                                                                                                                                                                                                                      |
| `rate-limiter-flexible`                                | Rate limiting                     | Redis-backed for multi-instance. All domain limiters (invoice/PO PDF, GST build, report CSV/bulk export) migrated to it in Phase 20 — previously in-process only (UPGRADE.md F-7)                                                                                                             |

### Dev / test

| Package                                 | Purpose                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsx`                                   | Run TS without build in dev (and production build via esbuild bundling)                                                                                                                  |
| `typescript`                            | TypeScript compiler — strict mode, frontend uses it too (not just `vue-tsc`). `api` uses `moduleResolution: Bundler` (not NodeNext) so drizzle-kit's esbuild can resolve schema imports. |
| `vitest`                                | Unit + integration tests                                                                                                                                                                 |
| `supertest` _or_ Hono's `app.request()` | HTTP-level tests                                                                                                                                                                         |
| `@testcontainers/postgresql`            | Real Postgres in tests                                                                                                                                                                   |
| `eslint` + `@typescript-eslint`         | Lint                                                                                                                                                                                     |
| `prettier`                              | Format                                                                                                                                                                                   |

---

## Frontend (web)

| Package                    | Purpose                                        |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `vue`                      | —                                              |
| `vue-router`               | —                                              |
| `pinia`                    | —                                              |
| `primevue`                 | UI                                             |                                                                        |
| `@primeuix/themes`         | Aura preset (noir palette) for PrimeVue 4.5+   | `@primevue/themes` was deprecated; presets moved to `@primeuix/themes` |
| `primeicons`               | Icon set bundled with PrimeVue                 |
| `tailwindcss` v4           | Layout / spacing                               |
| `@tailwindcss/vite`        | Tailwind v4 Vite plugin (replaces PostCSS)     |
| `chart.js` + `vue-chartjs` | Charts                                         |
| `zod`                      | Shared schemas                                 |
| `date-fns`                 | —                                              |
| `@vueuse/core`             | Composables (debounce, useEventListener, etc.) |

### Build / test

| Package                      | Purpose                                            |
| ---------------------------- | -------------------------------------------------- |
| `vite`                       | Build + dev server                                 |
| `typescript`                 | Strict mode; required — frontend is TS, not JS     |
| `vue-tsc`                    | Type-check `.vue` SFCs (runs in CI and pre-commit) |
| `vitest` + `@vue/test-utils` | Tests                                              |
| `playwright`                 | E2E (a small smoke suite, not exhaustive)          |

---

## Customer portal (portal)

Phase 28, UPGRADE.md G-8; SECURITY.md §13.14. A **separate** pnpm workspace package (`/portal`), not a route added to `web/` — deliberately its own deployable frontend on its own origin/port (5174 dev). Reuses the identical stack as `web/` minus what it doesn't need:

| Package                                      | Purpose                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `vue`, `vue-router`, `pinia`                 | Same as `web/`                                                                    |
| `primevue`, `@primeuix/themes`, `primeicons` | Same theme preset as `web/`, kept in sync so the portal reads as the same product |
| `tailwindcss` v4 + `@tailwindcss/vite`       | Same as `web/`                                                                    |
| `zod`                                        | Shared schemas                                                                    |
| `vite`, `vue-tsc`, `typescript`              | Same build/typecheck setup as `web/`                                              |

**Deliberately not included**: `chart.js`/`vue-chartjs` (no charts in a 5-view read-only portal), `date-fns`/`@vueuse/core` (not needed at this scope), `playwright` (no E2E suite yet — flag if the portal grows past the current small surface). Add these only when a concrete portal feature needs them, not preemptively.

---

## Shared package

A workspace package (`/shared`) used by both api and web. Contains:

- Zod schemas for all request/response shapes
- TS types derived from those schemas (`z.infer`)
- Pure functions for money/tax/date logic that must behave identically on both sides

No runtime dependencies except `zod` and `decimal.js`. Never import Vue, Hono, or Drizzle here.

---

## Infrastructure (recommended baseline)

| Concern                | Choice                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Hosting (api + worker) | Any Node-capable PaaS (Fly.io, Railway) or VPS                               |
| Reverse proxy          | Caddy or nginx (TLS, gzip, X-Real-IP)                                        |
| Database hosting       | Managed Postgres (Neon, Supabase, RDS) — daily backups, PITR                 |
| Redis                  | Managed (Upstash) or self-hosted                                             |
| Object storage         | Cloudflare R2 (cheapest egress) or AWS S3                                    |
| Email                  | Postmark or SES                                                              |
| Secrets                | Platform's secret manager (Doppler, Fly secrets, etc.) — never `.env` in git |

**Local dev containers (optional).** `docker-compose.yml` also defines `api`, `worker`, and `web` services alongside the infra ones (postgres/redis/clamav) — dev-mode containers running the same `tsx watch`/`vite --host` commands as `pnpm run dev`, with `src/` bind-mounted for hot reload. Not the default workflow (`pnpm run dev` on the host is faster to iterate with); useful when you specifically want to verify the app runs the same way inside a container as it will in production. Host ports 3001 (api) / 5180 (web) — chosen to avoid clashing with the host-run dev servers on 3000/5173. `api`/`worker` share one Dockerfile (`api/Dockerfile`); differ only in `command:`. Secrets come from the gitignored `api/.env` via `env_file:`, never hardcoded in the compose file.

---

## Open decisions (flag and pick before Phase 2)

1. **~~PDF generator~~ — decided Phase 23.** `@react-pdf/renderer` (was recommended, is now installed). Templates live in `api/src/lib/pdf/` (`InvoiceDocument`, `PoDocument`, `SoaDocument` — shared by customer and supplier statements). Rendered via the `pdf` BullMQ queue (worker isolates the CPU cost, per ARCHITECTURE.md §8); routes enqueue and synchronously await completion via `lib/pdfClient.ts`'s `renderAndWaitForFile` (20s timeout) so the documented `GET .../pdf → signed URL` contract holds without the client having to poll a job id.
2. **~~Virus scanning~~ — decided Phase 20.** Self-hosted ClamAV sidecar (`clamd`), spoken directly over TCP via `api/src/lib/virusScan.ts` — no client library needed. `docker-compose.yml` runs it locally; deploy the same image alongside the API in production.
3. **MaxMind GeoLite2** for IP→country (per SECURITY.md). Free with attribution; needs license key.
4. **Background OCR for scanned SOAs?** If suppliers send scanned PDFs, `pdf-parse` won't help. Add `tesseract.js` only if/when needed — don't pre-optimise.
5. **FX rate data provider — not decided (Phase 30).** Exchange rates (ARCHITECTURE.md §4.10) are manual entry only in this phase; `exchange_rates.source` is `'manual'` for every row today, but the column exists as an extension point for an automated daily-rate job. No vendor has been chosen or integrated — mirror the `GEO_PROVIDER` pattern (an env-configured provider enum, `disabled` as the safe default) if/when one is picked, rather than hardcoding a single vendor's API.

---

## Change protocol

Adding or removing any package:

1. Update this file (the right table + a one-line reason in the row).
2. Add a `CHANGELOG.md` entry under the next unreleased version.
3. If the change affects how modules are wired (e.g., swapping PDF generator), update `ARCHITECTURE.md` section 8 or 9 accordingly.
