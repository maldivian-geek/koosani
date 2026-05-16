import { extname } from 'path'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import { storage, sha256Hex, isAllowedMime } from '../../lib/storage.js'
import type { AuditCtx } from '../audit/service.js'
import type { File } from './repository.js'

export type { File }

// 25MB per SECURITY.md §13.5
const MAX_BYTES = 25 * 1024 * 1024

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
  mimeType: string,
  ctx: AuditCtx,
): Promise<File> {
  if (!isAllowedMime(mimeType)) throw new ValidationError(`MIME type ${mimeType} is not allowed`)
  if (buffer.byteLength > MAX_BYTES) throw new ValidationError('File exceeds 25 MB limit')

  const sha256 = sha256Hex(buffer)
  const ext = extname(originalName).toLowerCase() || '.bin'
  // Key is never user-controlled (SECURITY.md §13.5)
  const storageKey = `${businessId}/uploads/${sha256}${ext}`

  await storage.put(storageKey, buffer, mimeType)

  return db.transaction(async (tx) => {
    const file = await repo.insertFile(
      {
        businessId,
        originalName,
        mimeType,
        sizeBytes: buffer.byteLength,
        sha256,
        storageKey,
        uploadedBy: ctx.userId,
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
      { originalName, mimeType, sizeBytes: buffer.byteLength },
      ctx,
      tx,
    )

    return file
  })
}

// ─── getSignedUrl ─────────────────────────────────────────────────────────────

export async function getSignedUrl(businessId: string, fileId: string): Promise<string> {
  const file = await repo.findById(businessId, fileId)
  if (!file) throw new NotFoundError(`File ${fileId} not found`)
  return storage.getSignedUrl(file.storageKey, 3600)
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
