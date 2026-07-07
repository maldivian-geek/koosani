# Dev container for the api service — runs the same `tsx watch` dev server as
# `pnpm run dev` on the host, just containerized. Also used by the `worker`
# compose service (same image, different command). Build context is the repo
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
COPY api ./api

RUN pnpm --filter @koosani/shared build

WORKDIR /repo/api
EXPOSE 3000

# Not `pnpm dev` — that hardcodes `--env-file=.env`, but this container gets
# its env vars from docker-compose (env_file/environment), not a local .env.
CMD ["pnpm", "exec", "tsx", "watch", "src/server.ts"]
