#!/bin/sh
set -e

# With no args, this is the `api` service's default CMD: run migrations +
# the idempotent production seed, then start the server. The `worker`
# service (same image, docker-compose.prod.yml) overrides the container
# command with `node dist/worker.js` — since a Dockerfile ENTRYPOINT
# receives an overridden CMD as arguments rather than replacing itself,
# this script must explicitly detect that case and just exec it, or
# `worker` would silently also run migrate/seed/server instead of the
# worker process.
if [ "$#" -ne 0 ]; then
  exec "$@"
fi

echo "docker-entrypoint: running migrations..."
pnpm exec drizzle-kit migrate

echo "docker-entrypoint: running production seed (idempotent no-op if a business already exists)..."
node dist/db/seedProd.js

echo "docker-entrypoint: starting server..."
exec node dist/server.js
