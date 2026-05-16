# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

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
