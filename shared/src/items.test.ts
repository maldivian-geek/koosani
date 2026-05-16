import { describe, it, expect } from 'vitest'
import { ItemCreate, ItemPatch, ItemCategoryCreate } from './items.js'

describe('ItemCreate', () => {
  const valid = {
    sku: 'WATER-1L',
    name: 'Mineral Water 1L',
    unit: 'pcs',
    categoryId: '550e8400-e29b-41d4-a716-446655440000',
    gstCategory: 'general_8' as const,
    defaultPrice: '15.00',
    defaultCost: '8.00',
    reorderPoint: '50.0000',
    notes: 'Refrigerate after opening',
  }

  it('accepts a fully populated record', () => {
    expect(ItemCreate.safeParse(valid).success).toBe(true)
  })

  it('accepts minimal record (required fields only)', () => {
    expect(
      ItemCreate.safeParse({ sku: 'SKU-001', name: 'Widget', unit: 'pcs', gstCategory: 'zero' })
        .success,
    ).toBe(true)
  })

  it('rejects missing sku', () => {
    expect(ItemCreate.safeParse({ name: 'Widget', unit: 'pcs', gstCategory: 'zero' }).success).toBe(
      false,
    )
  })

  it('rejects empty sku', () => {
    expect(ItemCreate.safeParse({ ...valid, sku: '' }).success).toBe(false)
  })

  it('rejects sku over 100 chars', () => {
    expect(ItemCreate.safeParse({ ...valid, sku: 'x'.repeat(101) }).success).toBe(false)
  })

  it('rejects missing name', () => {
    expect(ItemCreate.safeParse({ sku: 'SKU-X', unit: 'pcs', gstCategory: 'zero' }).success).toBe(
      false,
    )
  })

  it('rejects missing unit', () => {
    expect(
      ItemCreate.safeParse({ sku: 'SKU-X', name: 'Widget', gstCategory: 'zero' }).success,
    ).toBe(false)
  })

  it('rejects unit over 50 chars', () => {
    expect(ItemCreate.safeParse({ ...valid, unit: 'u'.repeat(51) }).success).toBe(false)
  })

  it('rejects missing gstCategory', () => {
    expect(ItemCreate.safeParse({ sku: 'SKU-X', name: 'Widget', unit: 'pcs' }).success).toBe(false)
  })

  it('rejects invalid gstCategory', () => {
    expect(ItemCreate.safeParse({ ...valid, gstCategory: 'vat_5' }).success).toBe(false)
  })

  it('accepts all valid gstCategory values', () => {
    const categories = ['general_8', 'tourism_16', 'tourism_17', 'zero', 'exempt'] as const
    for (const cat of categories) {
      expect(ItemCreate.safeParse({ ...valid, gstCategory: cat }).success).toBe(true)
    }
  })

  it('rejects invalid money format for defaultPrice', () => {
    expect(ItemCreate.safeParse({ ...valid, defaultPrice: '15.999' }).success).toBe(false)
  })

  it('rejects invalid qty format for reorderPoint', () => {
    expect(ItemCreate.safeParse({ ...valid, reorderPoint: '50.00001' }).success).toBe(false)
  })

  it('rejects invalid categoryId (non-UUID)', () => {
    expect(ItemCreate.safeParse({ ...valid, categoryId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('ItemPatch', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(ItemPatch.safeParse({}).success).toBe(true)
  })

  it('accepts partial update', () => {
    expect(ItemPatch.safeParse({ defaultPrice: '20.00' }).success).toBe(true)
  })

  it('still validates provided fields', () => {
    expect(ItemPatch.safeParse({ gstCategory: 'invalid' }).success).toBe(false)
  })
})

describe('ItemCategoryCreate', () => {
  it('accepts name only', () => {
    expect(ItemCategoryCreate.safeParse({ name: 'Beverages' }).success).toBe(true)
  })

  it('accepts name with parentId', () => {
    expect(
      ItemCategoryCreate.safeParse({
        name: 'Soft Drinks',
        parentId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true)
  })

  it('rejects empty name', () => {
    expect(ItemCategoryCreate.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    expect(ItemCategoryCreate.safeParse({ name: 'c'.repeat(201) }).success).toBe(false)
  })

  it('rejects non-UUID parentId', () => {
    expect(ItemCategoryCreate.safeParse({ name: 'Sub', parentId: 'not-a-uuid' }).success).toBe(
      false,
    )
  })
})
