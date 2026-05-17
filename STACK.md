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

| Package                                                         | Purpose                           | Notes                                                              |
| --------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `hono`                                                          | HTTP framework                    | Node adapter (`@hono/node-server`)                                 |
| `@hono/zod-validator`                                           | Bind Zod schemas to routes        | Use for every input                                                |
| `zod`                                                           | Schemas                           | Shared with web via `shared/`                                      |
| `drizzle-orm`                                                   | Queries                           | Use the query builder, not raw SQL, except in migrations           |
| `drizzle-kit`                                                   | Migrations                        | `drizzle-kit generate` + `drizzle-kit migrate`                     |
| `postgres` (postgres.js)                                        | DB driver                         | Drizzle's preferred Node driver                                    |
| `pino` + `pino-http`                                            | Logging                           | JSON in prod, `pino-pretty` in dev                                 |
| `argon2`                                                        | Password hashing                  | Per SECURITY.md                                                    |
| `jsonwebtoken`                                                  | JWT                               | HS256, per SECURITY.md                                             |
| `cookie`                                                        | Cookie parse/serialise            | —                                                                  |
| `helmet` (Hono port: `hono/secure-headers`)                     | Security headers                  | Use Hono's built-in `secureHeaders` middleware                     |
| `decimal.js`                                                    | Money math                        | Never `Number` for currency                                        |
| `date-fns` + `date-fns-tz`                                      | Dates                             | Maldives is `Indian/Maldives` (UTC+5, no DST)                      |
| `bullmq`                                                        | Job queue                         | Redis-backed                                                       |
| `ioredis`                                                       | Redis client                      | BullMQ dependency                                                  |
| `resend`                                                        | Email (transactional)             | Replaced nodemailer — TypeScript-native SDK, no SMTP config needed |
| `pdfkit` _or_ `@react-pdf/renderer` headlessly _or_ `puppeteer` | PDF generation                    | **Pick one** — see _Open decisions_ below                          |
| `papaparse`                                                     | CSV parse (SOA extract)           | —                                                                  |
| `pdf-parse`                                                     | PDF text extraction (SOA extract) | —                                                                  |
| `clamav.js` _or_ hosted scanner                                 | Virus scan uploads                | —                                                                  |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`          | Object storage                    | Works with any S3-compatible (Cloudflare R2, MinIO, AWS)           |
| `rate-limiter-flexible`                                         | Rate limiting                     | Redis-backed for multi-instance                                    |

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
| `tailwindcss`              | Layout / spacing                               |
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

---

## Open decisions (flag and pick before Phase 2)

1. **PDF generator.** Three real options:
   - `pdfkit` — programmatic, fastest, hardest to style. Good for invoices that are mostly tables.
   - `puppeteer` — render an HTML template (you already have Vue), heavy memory, slow cold start.
   - `@react-pdf/renderer` — declarative components, no headless browser. _Recommended_ unless you want pixel-identical-to-web rendering.
2. **Virus scanning.** ClamAV sidecar (free, you operate it) vs hosted (Cloudmersive, etc.). For SME volume ClamAV is fine.
3. **MaxMind GeoLite2** for IP→country (per SECURITY.md). Free with attribution; needs license key.
4. **Background OCR for scanned SOAs?** If suppliers send scanned PDFs, `pdf-parse` won't help. Add `tesseract.js` only if/when needed — don't pre-optimise.

---

## Change protocol

Adding or removing any package:

1. Update this file (the right table + a one-line reason in the row).
2. Add a `CHANGELOG.md` entry under the next unreleased version.
3. If the change affects how modules are wired (e.g., swapping PDF generator), update `ARCHITECTURE.md` section 8 or 9 accordingly.
