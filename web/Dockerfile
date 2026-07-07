# Dev container for the web SPA — runs the Vite dev server, same as
# `pnpm run dev` on the host, just containerized. Build context is the repo
# root (pnpm workspace requires the full monorepo to resolve `workspace:*`
# deps), not this directory.
FROM node:22

WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
COPY portal/package.json ./portal/package.json
COPY shared/package.json ./shared/package.json

RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY web ./web

RUN pnpm --filter @koosani/shared build

WORKDIR /repo/web
EXPOSE 5173

# Invoke vite directly (not `pnpm dev`) — pnpm's `--` passthrough doesn't
# reach vite reliably in exec-form CMD, leaving it bound to the container's
# internal localhost only. --host binds 0.0.0.0 so it's reachable from outside.
CMD ["pnpm", "exec", "vite", "--host"]
