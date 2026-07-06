import { z } from 'zod'

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters. Generate: openssl rand -base64 32'),
  JWT_SECRET_PREVIOUS: z.string().min(32).optional(),
  FRONTEND_URL: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('noreply@example.com'),
  GEO_PROVIDER: z.enum(['disabled', 'ip-api', 'maxmind']).default('disabled'),
  // Object-storage CDN hostname for CSP img-src / connect-src (SECURITY.md §13.8)
  STORAGE_HOSTNAME: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(3000),
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
