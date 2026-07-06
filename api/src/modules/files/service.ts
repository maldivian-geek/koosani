import { extname } from 'path'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import { storage, sha256Hex, isAllowedMime } from '../../lib/storage.js'
import { scanBuffer } from '../../lib/virusScan.js'
import { config } from '../../lib/config.js'
import type { AuditCtx } from '../audit/service.js'
import type { File } from './repository.js'

export type { File }

// 25MB per SECURITY.md §13.5
const MAX_BYTES = 25 * 1024 * 1024

// file-type can't reliably detect plain-text formats by magic bytes — these
// declared MIME types are allowed through as long as the content doesn't look
// like a disguised binary (SECURITY.md §13.5 rule 1).
const TEXT_LIKE_MIME = new Set(['text/csv', 'application/vnd.ms-excel'])
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

function looksLikeBinary(buffer: Buffer): boolean {
  // A NUL byte in the first 8 KB is a strong signal of a disguised binary —
  // legitimate CSV/plain-text files never contain one.
  return buffer.subarray(0, 8192).includes(0)
}

export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ValidationError'
  }
}

// ─── uploadFile ───────────────────────────────────────────────────────────────

export async function uploadFile(
  businessId: string,
  buffer: Buffer,
  originalName: string,
  declaredMimeType: string,
  ctx: AuditCtx,
): Promise<File> {
  if (!isAllowedMime(declaredMimeType)) {
    throw new ValidationError(`MIME type ${declaredMimeType} is not allowed`)
  }
  if (buffer.byteLength > MAX_BYTES) throw new ValidationError('File exceeds 25 MB limit')

  // Magic-byte sniff (SECURITY.md §13.5 rule 1) — never trust the client's
  // Content-Type header alone.
  const detected = await fileTypeFromBuffer(buffer)
  if (detected) {
    if (!isAllowedMime(detected.mime) || detected.mime !== declaredMimeType) {
      throw new ValidationError(
        `File content (${detected.mime}) does not match declared type (${declaredMimeType})`,
      )
    }
  } else {
    // No magic-byte match — only acceptable for text-like formats, and only
    // if the content doesn't look like a disguised binary.
    if (!TEXT_LIKE_MIME.has(declaredMimeType) || looksLikeBinary(buffer)) {
      throw new ValidationError('File content could not be verified as the declared type')
    }
  }

  // Strip EXIF/metadata from images by re-encoding (sharp drops metadata
  // unless .withMetadata() is called) — SECURITY.md §13.5 rule 8.
  let finalBuffer = buffer
  if (IMAGE_MIME.has(declaredMimeType)) {
    finalBuffer = await sharp(buffer).rotate().toBuffer()
  }

  // Synchronous scan before the file is ever written to storage (SECURITY.md
  // §13.5 rule 3) — reject on a positive AND on scanner failure, except in
  // test, where no clamd instance is available (documented trade-off; see
  // CLAMAV_HOST in STACK.md).
  const scanResult = await scanBuffer(finalBuffer)
  if (scanResult === 'infected') {
    throw new ValidationError('File rejected: failed virus scan')
  }
  if (scanResult === 'scanner_unreachable' && config.NODE_ENV !== 'test') {
    throw new ValidationError('File rejected: virus scanner unavailable')
  }

  const sha256 = sha256Hex(finalBuffer)
  const ext = extname(originalName).toLowerCase() || '.bin'
  // Key is never user-controlled (SECURITY.md §13.5)
  const storageKey = `${businessId}/uploads/${sha256}${ext}`

  await storage.put(storageKey, finalBuffer, declaredMimeType)

  return db.transaction(async (tx) => {
    const file = await repo.insertFile(
      {
        businessId,
        originalName,
        mimeType: declaredMimeType,
        sizeBytes: finalBuffer.byteLength,
        sha256,
        storageKey,
        uploadedBy: ctx.userId,
        scanResult: 'clean',
        scannedAt: new Date(),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'file.uploaded',
      'file',
      file.id,
      {},
      { originalName, mimeType: declaredMimeType, sizeBytes: finalBuffer.byteLength },
      ctx,
      tx,
    )

    return file
  })
}

// ─── getSignedUrl ─────────────────────────────────────────────────────────────

// 5-minute expiry per SECURITY.md §13.5 rule 4.
const SIGNED_URL_TTL_SEC = 300

export async function getSignedUrl(businessId: string, fileId: string): Promise<string> {
  const file = await repo.findById(businessId, fileId)
  if (!file) throw new NotFoundError(`File ${fileId} not found`)
  if (file.scanResult !== 'clean') throw new NotFoundError(`File ${fileId} not found`)
  return storage.getSignedUrl(file.storageKey, SIGNED_URL_TTL_SEC)
}

// ─── attachToEntity ───────────────────────────────────────────────────────────

export async function attachToEntity(
  businessId: string,
  fileId: string,
  entityType: string,
  entityId: string,
  ctx: AuditCtx,
  tx?: DbTx,
): Promise<void> {
  const doAttach = async (t: DbTx) => {
    const file = await repo.findById(businessId, fileId, t)
    if (!file) throw new NotFoundError(`File ${fileId} not found`)
    await repo.attachToEntity(businessId, fileId, entityType, entityId, t)
    await audit.record('file.attached', 'file', fileId, {}, { entityType, entityId }, ctx, t)
  }
  if (tx) {
    await doAttach(tx)
  } else {
    await db.transaction(doAttach)
  }
}
