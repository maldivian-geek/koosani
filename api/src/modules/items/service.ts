import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { ItemCreate, ItemPatch } from '@koosani/shared'
import type { ItemRow, CategoryRow } from './repository.js'

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

export async function assertExists(id: string, businessId: string): Promise<ItemRow> {
  const item = await repo.findItemById(businessId, id)
  if (!item || item.deletedAt !== null) {
    throw new NotFoundError(`Item ${id} not found`)
  }
  return item
}

// ─── list ─────────────────────────────────────────────────────────────────────

export async function list(
  businessId: string,
  params: {
    q: string | undefined
    categoryId: string | undefined
    active: boolean | undefined
    page: number | undefined
    pageSize: number | undefined
  },
): Promise<{ items: ItemRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PAGE_SIZE_DEFAULT))
  const { rows, total } = await repo.listItems(businessId, {
    q: params.q,
    categoryId: params.categoryId,
    active: params.active,
    page,
    pageSize,
  })
  return { items: rows, total, page, pageSize }
}

// ─── getById ──────────────────────────────────────────────────────────────────

export async function getById(
  businessId: string,
  id: string,
): Promise<ItemRow & { stockOnHand: string; lastCost: string | null }> {
  const item = await assertExists(id, businessId)
  return {
    ...item,
    stockOnHand: item.stockOnHand,
    lastCost: item.defaultCost ?? null,
  }
}

// ─── findByCustomerItemNames ──────────────────────────────────────────────────
// Read-only lookup for resolving a customer's wording (order-list lines) to
// catalogue items. Cross-module callers use this, not the repository (CLAUDE.md §4).

export async function findByCustomerItemNames(
  businessId: string,
  namesLower: string[],
): Promise<Array<{ id: string; name: string; customerItemName: string | null }>> {
  return repo.findByCustomerItemNames(businessId, namesLower)
}

// ─── listCategories ───────────────────────────────────────────────────────────

export async function listCategories(businessId: string): Promise<CategoryRow[]> {
  return repo.listCategories(businessId)
}

// ─── createCategory ───────────────────────────────────────────────────────────

export async function createCategory(
  businessId: string,
  data: { name: string; parentId?: string },
  ctx: AuditCtx,
): Promise<CategoryRow> {
  return db.transaction(async (tx) => {
    const row = await repo.insertCategory({
      businessId,
      name: data.name,
      parentId: data.parentId ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    await audit.record(
      'item_category.create',
      'item_category',
      row.id,
      null,
      row as Record<string, unknown>,
      ctx,
      tx,
    )
    return row
  })
}

// ─── create ───────────────────────────────────────────────────────────────────

export async function create(
  businessId: string,
  data: ItemCreate,
  ctx: AuditCtx,
): Promise<ItemRow> {
  const skuTaken = await repo.skuExists(businessId, data.sku, undefined)
  if (skuTaken) {
    throw new ValidationError(`SKU '${data.sku}' is already in use`)
  }

  return db.transaction(async (tx) => {
    const row = await repo.insertItem({
      businessId,
      sku: data.sku,
      name: data.name,
      customerItemName: data.customerItemName ?? null,
      unit: data.unit,
      categoryId: data.categoryId ?? null,
      gstCategory: data.gstCategory,
      defaultPrice: data.defaultPrice ?? null,
      defaultCost: data.defaultCost ?? null,
      reorderPoint: data.reorderPoint ?? null,
      notes: data.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    await audit.record('item.create', 'item', row.id, null, row as Record<string, unknown>, ctx, tx)
    return row
  })
}

// ─── update ───────────────────────────────────────────────────────────────────

export async function update(
  businessId: string,
  id: string,
  data: ItemPatch,
  gstCategoryChangeReason: string | undefined,
  ctx: AuditCtx,
): Promise<ItemRow> {
  return db.transaction(async (tx) => {
    const before = await assertExists(id, businessId)

    if (data.sku !== undefined && data.sku !== before.sku) {
      const skuTaken = await repo.skuExists(businessId, data.sku, id)
      if (skuTaken) throw new ValidationError(`SKU '${data.sku}' is already in use`)
    }

    // GST category change requires a reason (FUNCTIONS.md §items)
    if (data.gstCategory !== undefined && data.gstCategory !== before.gstCategory) {
      if (!gstCategoryChangeReason?.trim()) {
        throw new ValidationError('A reason is required when changing the GST category')
      }
    }

    const patch: Record<string, unknown> = {}
    if (data.sku !== undefined) patch['sku'] = data.sku
    if (data.name !== undefined) patch['name'] = data.name
    if (data.customerItemName !== undefined) patch['customerItemName'] = data.customerItemName
    if (data.unit !== undefined) patch['unit'] = data.unit
    if (data.categoryId !== undefined) patch['categoryId'] = data.categoryId
    if (data.gstCategory !== undefined) patch['gstCategory'] = data.gstCategory
    if (data.defaultPrice !== undefined) patch['defaultPrice'] = data.defaultPrice
    if (data.defaultCost !== undefined) patch['defaultCost'] = data.defaultCost
    if (data.reorderPoint !== undefined) patch['reorderPoint'] = data.reorderPoint
    if (data.notes !== undefined) patch['notes'] = data.notes
    patch['updatedBy'] = ctx.userId

    const after = await repo.updateItem(businessId, id, patch, tx)

    const auditAfter: Record<string, unknown> = { ...(after as Record<string, unknown>) }
    if (gstCategoryChangeReason) {
      auditAfter['gstCategoryChangeReason'] = gstCategoryChangeReason
    }

    await audit.record(
      'item.update',
      'item',
      id,
      before as Record<string, unknown>,
      auditAfter,
      ctx,
      tx,
    )
    return after
  })
}

// ─── softDelete ───────────────────────────────────────────────────────────────

export async function softDelete(businessId: string, id: string, ctx: AuditCtx): Promise<void> {
  const item = await assertExists(id, businessId)

  const [hasStock, hasRefs] = await Promise.all([
    repo.hasPositiveStock(businessId, id),
    repo.hasActiveReferences(businessId, id),
  ])

  if (hasStock) {
    throw new ValidationError('Cannot delete item with positive stock on hand')
  }
  if (hasRefs) {
    throw new ValidationError(
      'Cannot delete item with active references (draft invoices, bills, or open POs)',
    )
  }

  await db.transaction(async (tx) => {
    await repo.softDeleteItem(businessId, id, ctx.userId, tx)
    await audit.record('item.delete', 'item', id, item as Record<string, unknown>, null, ctx, tx)
  })
}
