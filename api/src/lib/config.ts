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
})

const result = configSchema.safeParse(process.env)

if (!result.success) {
  console.error('FATAL: Invalid environment configuration:')
  console.error(JSON.stringify(result.error.format(), null, 2))
  process.exit(1)
}

export const config = result.data
export type Config = typeof config
