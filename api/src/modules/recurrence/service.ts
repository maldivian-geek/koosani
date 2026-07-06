import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as customers from '../customers/service.js'
import * as invoicing from '../invoicing/service.js'
import * as settings from '../settings/service.js'
import type { AuditCtx } from '../audit/service.js'
import type {
  RecurrenceProfile,
  RecurrenceProfileLine,
  RecurrenceProfileWithCustomer,
  ListProfileParams,
} from './repository.js'
import type { RecurrenceProfileCreate, RecurrenceProfilePatch } from '@koosani/shared'
import { todayMv, addDays, advanceByFrequency } from '@koosani/shared'

export type {
  AuditCtx,
  RecurrenceProfile,
  RecurrenceProfileLine,
  RecurrenceProfileWithCustomer,
  ListProfileParams,
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── createProfile ────────────────────────────────────────────────────────────

export async function createProfile(
  businessId: string,
  data: RecurrenceProfileCreate,
  ctx: AuditCtx,
): Promise<RecurrenceProfile & { lines: RecurrenceProfileLine[] }> {
  await customers.assertExists(data.customerId, businessId)
  if (data.endDate && data.endDate < data.startDate) {
    throw new ValidationError('endDate cannot be before startDate')
  }

  return db.transaction(async (tx) => {
    const profile = await repo.insertProfile(
      {
        businessId,
        customerId: data.customerId,
        name: data.name,
        frequency: data.frequency,
        startDate: data.startDate,
        endDate: data.endDate ?? null,
        nextRunDate: data.startDate,
        autoIssue: data.autoIssue ?? false,
        dueDaysAfterIssue: data.dueDaysAfterIssue ?? null,
        notes: data.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    const lines = await repo.insertLines(
      data.lines.map((l, idx) => ({
        businessId,
        profileId: profile.id,
        itemId: l.itemId ?? null,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        gstCategory: l.gstCategory,
        sortOrder: l.sortOrder ?? idx,
        createdBy: ctx.userId,
      })),
      tx,
    )

    await audit.record(
      'recurrence_profile.created',
      'recurrence_profile',
      profile.id,
      null,
      { customerId: data.customerId, frequency: data.frequency, lineCount: lines.length },
      ctx,
      tx,
    )

    return { ...profile, lines }
  })
}

// ─── getProfile ───────────────────────────────────────────────────────────────

export async function getProfile(
  businessId: string,
  id: string,
): Promise<RecurrenceProfile & { lines: RecurrenceProfileLine[]; customerName: string }> {
  const profile = await repo.getById(businessId, id)
  if (!profile) throw new NotFoundError(`Recurrence profile ${id} not found`)
  const [lines, customer] = await Promise.all([
    repo.getLinesByProfile(businessId, id),
    customers.assertExists(profile.customerId, businessId),
  ])
  return { ...profile, lines, customerName: customer.name }
}

// ─── listProfiles ─────────────────────────────────────────────────────────────

export async function listProfiles(
  businessId: string,
  params: ListProfileParams,
): Promise<{ rows: RecurrenceProfileWithCustomer[]; total: number }> {
  return repo.listProfiles(businessId, params)
}

export async function listDueProfiles(
  businessId: string,
  today: string,
): Promise<RecurrenceProfile[]> {
  return repo.listDueProfiles(businessId, today)
}

// ─── patchProfile ─────────────────────────────────────────────────────────────

export async function patchProfile(
  businessId: string,
  id: string,
  data: RecurrenceProfilePatch,
  ctx: AuditCtx,
): Promise<RecurrenceProfile & { lines: RecurrenceProfileLine[] }> {
  return db.transaction(async (tx) => {
    const before = await repo.getById(businessId, id, tx)
    if (!before) throw new NotFoundError(`Recurrence profile ${id} not found`)
    if (data.endDate && data.endDate < before.startDate) {
      throw new ValidationError('endDate cannot be before startDate')
    }

    let lines = await repo.getLinesByProfile(businessId, id, tx)
    if (data.lines) {
      await repo.deleteLinesByProfile(businessId, id, tx)
      lines = await repo.insertLines(
        data.lines.map((l, idx) => ({
          businessId,
          profileId: id,
          itemId: l.itemId ?? null,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          gstCategory: l.gstCategory,
          sortOrder: l.sortOrder ?? idx,
          createdBy: ctx.userId,
        })),
        tx,
      )
    }

    const updated = await repo.updateProfile(
      businessId,
      id,
      {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
        ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.autoIssue !== undefined ? { autoIssue: data.autoIssue } : {}),
        ...(data.dueDaysAfterIssue !== undefined
          ? { dueDaysAfterIssue: data.dueDaysAfterIssue }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'recurrence_profile.updated',
      'recurrence_profile',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )

    return { ...updated, lines }
  })
}

// ─── generateFromProfile ──────────────────────────────────────────────────────
// Advances nextRunDate FIRST, under a row lock, before creating anything — if
// invoice creation fails partway, the cycle is skipped rather than risking a
// duplicate invoice on retry (UPGRADE.md G-6: always dated today, so this
// never interacts with a locked GST period regardless of when it runs).

export async function generateFromProfile(
  businessId: string,
  profileId: string,
  ctx: AuditCtx,
): Promise<{ profile: RecurrenceProfile; invoiceId: string } | null> {
  const today = todayMv()

  const profile = await db.transaction(async (tx) => {
    const p = await repo.getByIdForUpdate(businessId, profileId, tx)
    if (!p) throw new NotFoundError(`Recurrence profile ${profileId} not found`)
    if (!p.active) return null
    if (p.nextRunDate > today) return null
    if (p.endDate && today > p.endDate) return null

    return repo.updateProfile(
      businessId,
      profileId,
      {
        nextRunDate: advanceByFrequency(p.nextRunDate, p.frequency),
        lastGeneratedAt: new Date(),
        updatedBy: ctx.userId,
      },
      tx,
    )
  })

  if (!profile) return null // not due, inactive, or past end date — no-op

  const lines = await repo.getLinesByProfile(businessId, profileId)
  const business = await settings.get(businessId)
  const dueDate = addDays(today, profile.dueDaysAfterIssue ?? business.defaultCreditTermsDays)

  const invoice = await invoicing.createDraft(
    businessId,
    {
      customerId: profile.customerId,
      dueDate,
      notes: profile.notes ?? undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId ?? undefined,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        gstCategory: l.gstCategory,
        sortOrder: l.sortOrder,
      })),
    },
    ctx,
  )

  await db.transaction(async (tx) => {
    await invoicing.setRecurrenceLink(businessId, invoice.id, profileId, tx)
    await audit.record(
      'recurrence_profile.invoice_generated',
      'recurrence_profile',
      profileId,
      null,
      { invoiceId: invoice.id, autoIssue: profile.autoIssue },
      ctx,
      tx,
    )
  })

  if (profile.autoIssue) {
    await invoicing.issue(businessId, invoice.id, ctx)
  }

  return { profile, invoiceId: invoice.id }
}
