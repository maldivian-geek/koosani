import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from './config.js'
import { logger } from './logger.js'

// ─── Storage abstraction ──────────────────────────────────────────────────────
// Two backends controlled by FILES_STORAGE env var (default: 'local').
//   local — writes to OS temp dir; for dev and tests only
//   s3    — AWS-compatible object storage; for production

export interface StorageBackend {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>
}

// ─── SHA-256 helper ───────────────────────────────────────────────────────────

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

// ─── MIME allow-list (SECURITY.md §13.5) ──────────────────────────────────────

const ALLOWED_MIME: Set<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_MIME.has(mimeType)
}

// ─── Local backend ────────────────────────────────────────────────────────────

const LOCAL_ROOT = join(tmpdir(), 'koosani-uploads')

// Local "signed URL" support: HMAC-expiring links served by the public
// GET /files/local route (files/routes.ts, mounted without cookie auth — the
// signature IS the authorization, mirroring S3's signed-URL semantics
// including the expiry). Signed with the existing JWT_SECRET; only the server
// can mint a valid (key, exp, sig) triple. Still a dev/test-only backend —
// production uses S3 (STACK.md).
export function signLocalKey(key: string, exp: number): string {
  return createHmac('sha256', config.JWT_SECRET).update(`${key}\n${exp}`).digest('hex')
}

export function verifyLocalKey(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false
  const expected = Buffer.from(signLocalKey(key, exp))
  const provided = Buffer.from(sig)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

class LocalStorage implements StorageBackend {
  async put(key: string, data: Buffer): Promise<void> {
    const fullPath = join(LOCAL_ROOT, key)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, data)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(join(LOCAL_ROOT, key))
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
    const sig = signLocalKey(key, exp)
    const base = config.API_PUBLIC_URL ?? `http://localhost:${config.PORT}`
    return `${base}/files/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`
  }
}

// ─── S3 backend ───────────────────────────────────────────────────────────────

class S3Storage implements StorageBackend {
  private client: S3Client
  private bucket: string

  constructor(bucket: string) {
    this.bucket = bucket
    this.client = new S3Client({
      region: config.AWS_REGION,
      ...(config.AWS_ENDPOINT_URL
        ? { endpoint: config.AWS_ENDPOINT_URL, forcePathStyle: true }
        : {}),
    })
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentDisposition: 'attachment',
      }),
    )
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    const stream = res.Body
    if (!stream) throw new Error(`Storage: empty body for key ${key}`)
    const chunks: Uint8Array[] = []
    // @ts-expect-error — stream is ReadableStream in AWS SDK v3
    for await (const chunk of stream) {
      chunks.push(chunk as Uint8Array)
    }
    return Buffer.concat(chunks)
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: 'attachment',
      }),
      { expiresIn: expiresInSeconds },
    )
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

function createStorage(): StorageBackend {
  if (config.FILES_STORAGE === 's3') {
    if (!config.S3_BUCKET) {
      logger.fatal('FILES_STORAGE=s3 but S3_BUCKET is not set')
      process.exit(1)
    }
    return new S3Storage(config.S3_BUCKET)
  }
  return new LocalStorage()
}

export const storage = createStorage()
