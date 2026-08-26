import { z } from 'zod'

// Docker Compose's `${VAR:-}` syntax always *defines* the env var (as an
// empty string if the underlying shell var is unset) rather than omitting
// it — so an "optional" field backed by a stricter validator (`.url()`,
// `.min(n)`) sees a defined-but-invalid empty string, not `undefined`, and
// fails validation instead of being skipped. Preprocessing empty string to
// undefined restores the intended "genuinely optional" behavior regardless
// of how the env var reached the process (compose, .env file, shell export).
const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val)

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters. Generate: openssl rand -base64 32'),
  JWT_SECRET_PREVIOUS: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  FRONTEND_URL: z.string().url(),
  // Customer portal (Phase 28, UPGRADE.md G-8, SECURITY.md §13.14) — separate
  // secret and origin from staff auth; never share JWT_SECRET with this.
  // Optional at boot (like RESEND_API_KEY/CLAMAV_HOST) so environments not
  // running the portal don't need it; portal auth throws a clear runtime
  // error if invoked without it configured. Required in any environment that
  // actually serves the portal.
  PORTAL_JWT_SECRET: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .min(
        32,
        'PORTAL_JWT_SECRET must be at least 32 characters. Generate: openssl rand -base64 32',
      )
      .optional(),
  ),
  PORTAL_FRONTEND_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('noreply@example.com'),
  GEO_PROVIDER: z.enum(['disabled', 'ip-api', 'maxmind']).default('disabled'),
  // Object-storage CDN hostname for CSP img-src / connect-src (SECURITY.md §13.8)
  STORAGE_HOSTNAME: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(3000),
  // Public base URL of the API process itself — used only by the LOCAL
  // storage backend to build its signed-download URLs. Optional; when unset,
  // production derives FRONTEND_URL + /api (the api's public address behind
  // web/nginx — SECURITY.md §13.12) and dev/test use http://localhost:<PORT>.
  API_PUBLIC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  FILES_STORAGE: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ENDPOINT_URL: z.string().optional(),
  // ClamAV daemon (clamd) INSTREAM endpoint (SECURITY.md §13.5) — unset in dev/CI
  // by design (see lib/virusScan.ts); required in production.
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
})

const result = configSchema.safeParse(process.env)

if (!result.success) {
  console.error('FATAL: Invalid environment configuration:')
  console.error(JSON.stringify(result.error.format(), null, 2))
  process.exit(1)
}

export const config = result.data
export type Config = typeof config
