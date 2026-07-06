import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as filesService from '../files/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { BusinessSettingsPatch } from '@koosani/shared'
import type { Business } from './repository.js'

export type { AuditCtx, Business }

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export async function get(businessId: string): Promise<Business & { logoUrl: string | null }> {
  const business = await repo.getBusiness(businessId)
  if (!business) throw new NotFoundError(`Business ${businessId} not found`)

  const logoUrl = business.logoFileId
    ? await filesService.getSignedUrl(businessId, business.logoFileId).catch(() => null)
    : null

  return { ...business, logoUrl }
}

export async function update(
  businessId: string,
  data: BusinessSettingsPatch,
  ctx: AuditCtx,
): Promise<Business> {
  return db.transaction(async (tx) => {
    const before = await repo.getBusiness(businessId)
    if (!before) throw new NotFoundError(`Business ${businessId} not found`)

    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) patch[key] = value
    }

    const after = await repo.updateBusiness(businessId, patch, tx)

    await audit.record(
      'business.settings_updated',
      'business',
      businessId,
      before as Record<string, unknown>,
      after as Record<string, unknown>,
      ctx,
      tx,
    )

    return after
  })
}

// ─── Logo upload ──────────────────────────────────────────────────────────────
// Stores the file via the files module (magic-byte sniff, virus scan, EXIF
// strip — SECURITY.md §13.5), then points businesses.logo_file_id at it. No
// polymorphic files.attachToEntity link needed since businesses already holds
// the reference directly.

export async function updateLogo(
  businessId: string,
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  ctx: AuditCtx,
): Promise<Business> {
  const file = await filesService.uploadFile(businessId, buffer, originalName, mimeType, ctx)

  return db.transaction(async (tx) => {
    const before = await repo.getBusiness(businessId)
    const after = await repo.updateBusiness(businessId, { logoFileId: file.id }, tx)

    await audit.record(
      'business.logo_updated',
      'business',
      businessId,
      { logoFileId: before?.logoFileId ?? null } as Record<string, unknown>,
      { logoFileId: file.id } as Record<string, unknown>,
      ctx,
      tx,
    )

    return after
  })
}
