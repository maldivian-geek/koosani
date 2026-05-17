# Koosani

Accounting & inventory management for Maldives SMEs.

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9
- Docker (for local Postgres + Redis)

## Quick start

```sh
# Install dependencies
pnpm install

# Start local services (Postgres + Redis)
docker compose up -d

# Copy and fill env files
cp api/.env.example api/.env
cp web/.env.example web/.env

# Start dev servers (two terminals)
pnpm dev:api
pnpm dev:web
```

## Commands

| Command                                  | Description                                |
| ---------------------------------------- | ------------------------------------------ |
| `pnpm dev:api`                           | API dev server with hot reload (port 3000) |
| `pnpm dev:web`                           | Web dev server (port 5173)                 |
| `pnpm typecheck`                         | Typecheck all packages                     |
| `pnpm lint`                              | Lint all packages                          |
| `pnpm lint:fix`                          | Lint and auto-fix                          |
| `pnpm format`                            | Format all files with Prettier             |
| `pnpm test`                              | Run all tests                              |
| `pnpm build`                             | Build all packages                         |
| `docker compose up -d`                   | Start Postgres + Redis                     |
| `docker compose down`                    | Stop local services                        |
| `pnpm --filter @koosani/api db:generate` | Generate Drizzle migration                 |
| `pnpm --filter @koosani/api db:migrate`  | Run pending migrations                     |

## Production deploy

### Prerequisites

- Node.js ≥ 22, pnpm ≥ 9
- Postgres 16, Redis 7
- Object storage (S3-compatible) for file uploads

### Environment variables

Copy `api/.env.example` → `api/.env` and fill every value:

| Variable              | Required | Notes                                                           |
| --------------------- | -------- | --------------------------------------------------------------- |
| `DATABASE_URL`        | ✅       | `postgresql://user:pass@host:5432/db?sslmode=require`           |
| `REDIS_URL`           | ✅       | `redis://:pass@host:6379`                                       |
| `JWT_SECRET`          | ✅       | ≥ 32 chars — `openssl rand -base64 32`                          |
| `JWT_SECRET_PREVIOUS` | —        | Set during key rotation only; remove afterwards                 |
| `FRONTEND_URL`        | ✅       | Exact origin, no trailing slash — e.g. `https://app.koosani.mv` |
| `RESEND_API_KEY`      | —        | Required for email (magic link, invite, password reset)         |
| `RESEND_FROM`         | —        | Sender address; defaults to `noreply@example.com`               |
| `STORAGE_HOSTNAME`    | —        | CDN hostname for object storage (appended to CSP `img-src`)     |
| `GEO_PROVIDER`        | —        | `disabled` \| `ip-api` \| `maxmind`; defaults to `disabled`     |

Copy `web/.env.example` → `web/.env`. The only required variable is `VITE_API_BASE_URL` (set to the API origin, e.g. `https://api.koosani.mv`).

### Build

```sh
pnpm install --frozen-lockfile
pnpm build
```

Output: `api/dist/` (Node ESM bundle) and `web/dist/` (static SPA).

### Migrate the database

```sh
NODE_ENV=production pnpm --filter @koosani/api db:migrate
```

Run this before starting the API on every deploy.

### Start

```sh
# API (port 3000 by default; override with PORT env var)
node api/dist/server.js

# Serve the SPA — any static-file host works (Nginx, Caddy, S3+CloudFront, etc.)
# Rewrite all paths to index.html for client-side routing.
```

### Emergency JWT rotation

See [SECURITY.md §13.1](SECURITY.md) for the full procedure. Short form:

1. Deploy new `JWT_SECRET` (remove `JWT_SECRET_PREVIOUS`).
2. `UPDATE users SET token_version = token_version + 1;`
3. `UPDATE user_sessions SET is_active = FALSE;`

All active sessions are immediately invalidated.

## Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full structural design.
See [STACK.md](STACK.md) for the tech stack and dependency rationale.
