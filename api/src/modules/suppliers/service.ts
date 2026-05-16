import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { SupplierCreate, SupplierPatch, SupplierContactCreate } from '@koosani/shared'
import type { SupplierRow, SupplierContactRow } from './repository.js'

export type { AuditCtx }

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── assertExists ─────────────────────────────────────────────────────────────

export async function assertExists(id: string, businessId: string): Promise<SupplierRow> {
  const supplier = await repo.findSupplierById(businessId, id)
  if (!supplier || supplier.deletedAt !== null) {
    throw new NotFoundError(`Supplier ${id} not found`)
  }
  return supplier
}

// ─── outstandingBalance ───────────────────────────────────────────────────────

export async function outstandingBalance(id: string, businessId: string): Promise<Decimal> {
  const { billOwed } = await repo.supplierBalanceComponents(businessId, id)
  return new Decimal(billOwed)
}

// ─── list ─────────────────────────────────────────────────────────────────────

export async function list(
  businessId: string,
  params: {
    q: string | undefined
    page: number | undefined
    pageSize: number | undefined
    active: boolean | undefined
  },
): Promise<{ items: SupplierRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PAGE_SIZE_DEFAULT))
  const { rows, total } = await repo.listSuppliers(businessId, {
    q: params.q,
    page,
    pageSize,
    active: params.active,
  })
  return { items: rows, total, page, pageSize }
}

// ─── getById ──────────────────────────────────────────────────────────────────

export async function getById(
  businessId: string,
  id: string,
): Promise<SupplierRow & { contacts: SupplierContactRow[]; balance: string }> {
  const supplier = await assertExists(id, businessId)
  const [contacts, balance] = await Promise.all([
    repo.listSupplierContacts(businessId, id),
    outstandingBalance(id, businessId),
  ])
  return { ...supplier, contacts, balance: balance.toFixed(2) }
}

// ─── create ───────────────────────────────────────────────────────────────────

export async function create(
  businessId: string,
  data: SupplierCreate,
  ctx: AuditCtx,
): Promise<SupplierRow> {
  return db.transaction(async (tx) => {
    const row = await repo.insertSupplier({
      businessId,
      name: data.name,
      tin: data.tin ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: data.address ?? null,
      paymentTermsDays: String(data.paymentTermsDays ?? 30),
      notes: data.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    await audit.record(
      'supplier.create',
      'supplier',
      row.id,
      null,
      row as Record<string, unknown>,
      ctx,
      tx,
    )
    return row
  })
}

// ─── update ───────────────────────────────────────────────────────────────────

export async function update(
  businessId: string,
  id: string,
  data: SupplierPatch,
  ctx: AuditCtx,
): Promise<SupplierRow> {
  return db.transaction(async (tx) => {
    const before = await assertExists(id, businessId)

    const patch: Record<string, unknown> = {}
    if (data.name !== undefined) patch['name'] = data.name
    if (data.tin !== undefined) patch['tin'] = data.tin
    if (data.email !== undefined) patch['email'] = data.email
    if (data.phone !== undefined) patch['phone'] = data.phone
    if (data.address !== undefined) patch['address'] = data.address
    if (data.paymentTermsDays !== undefined)
      patch['paymentTermsDays'] = String(data.paymentTermsDays)
    if (data.notes !== undefined) patch['notes'] = data.notes
    patch['updatedBy'] = ctx.userId

    const after = await repo.updateSupplier(businessId, id, patch, tx)
    await audit.record(
      'supplier.update',
      'supplier',
      id,
      before as Record<string, unknown>,
      after as Record<string, unknown>,
      ctx,
      tx,
    )
    return after
  })
}

// ─── softDelete ───────────────────────────────────────────────────────────────

export async function softDelete(businessId: string, id: string, ctx: AuditCtx): Promise<void> {
  const supplier = await assertExists(id, businessId)

  const [hasDrafts, balance] = await Promise.all([
    repo.hasDraftBills(businessId, id),
    outstandingBalance(id, businessId),
  ])

  if (hasDrafts) {
    throw new ValidationError('Cannot delete supplier with draft bills')
  }
  if (balance.gt(0)) {
    throw new ValidationError('Cannot delete supplier with outstanding balance')
  }

  await db.transaction(async (tx) => {
    await repo.softDeleteSupplier(businessId, id, ctx.userId, tx)
    await audit.record(
      'supplier.delete',
      'supplier',
      id,
      supplier as Record<string, unknown>,
      null,
      ctx,
      tx,
    )
  })
}

// ─── addContact ───────────────────────────────────────────────────────────────

export async function addContact(
  businessId: string,
  supplierId: string,
  data: SupplierContactCreate,
  ctx: AuditCtx,
): Promise<SupplierContactRow> {
  await assertExists(supplierId, businessId)

  return db.transaction(async (tx) => {
    const row = await repo.insertSupplierContact(
      {
        businessId,
        supplierId,
        name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        role: data.role ?? null,
        isPrimary: data.isPrimary ?? false,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'supplier.contact.create',
      'supplier',
      supplierId,
      null,
      row as Record<string, unknown>,
      ctx,
      tx,
    )
    return row
  })
}
