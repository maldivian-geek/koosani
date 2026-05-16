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

## Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full structural design.
See [STACK.md](STACK.md) for the tech stack and dependency rationale.
