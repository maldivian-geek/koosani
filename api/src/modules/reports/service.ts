import Decimal from 'decimal.js'
import * as repo from './repository.js'
import type { GroupRow, CreditRow, AgedRow, StockMovementRow } from './repository.js'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface NetGroupRow {
  groupKey: string
  label: string
  docCount: number
  subtotal: string
  gstAmount: string
  total: string
}

export interface StockValuationRow {
  itemId: string
  itemName: string
  sku: string
  qty: string
  avgCost: string
  value: string
}

export interface AgedEntityRow {
  entityId: string
  entityName: string
  current: string
  days1_30: string
  days31_60: string
  days61_90: string
  days91Plus: string
  total: string
}

export interface GstSummaryResult {
  from: string
  to: string
  outputTaxByCategory: Record<string, { net: string; gst: string }>
  inputTaxByCategory: Record<string, { net: string; gst: string }>
  totalOutputTax: string
  totalInputTax: string
  netPayable: string
}

// ─── CSV helper ───────────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join(
    '\n',
  )
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function mergeCreditRows(invRows: GroupRow[], cnRows: CreditRow[]): NetGroupRow[] {
  const cnMap = new Map<string, CreditRow>()
  for (const cn of cnRows) cnMap.set(cn.groupKey, cn)

  return invRows.map((inv) => {
    const cn = cnMap.get(inv.groupKey)
    const netSubtotal = new Decimal(inv.subtotal).minus(cn ? new Decimal(cn.subtotal) : 0)
    const netGst = new Decimal(inv.gstAmount).minus(cn ? new Decimal(cn.gstAmount) : 0)
    const netTotal = new Decimal(inv.total).minus(cn ? new Decimal(cn.total) : 0)
    return {
      groupKey: inv.groupKey,
      label: inv.label,
      docCount: Number(inv.docCount),
      subtotal: netSubtotal.toFixed(2),
      gstAmount: netGst.toFixed(2),
      total: netTotal.toFixed(2),
    }
  })
}

// ─── Sales register ───────────────────────────────────────────────────────────

export async function salesReport(
  businessId: string,
  from: string,
  to: string,
  groupBy: 'customer' | 'item' | 'day',
): Promise<NetGroupRow[]> {
  if (groupBy === 'customer') {
    const [invRows, cnRows] = await Promise.all([
      repo.salesInvoicesByCustomer(businessId, from, to),
      repo.salesCNByCustomer(businessId, from, to),
    ])
    return mergeCreditRows(invRows, cnRows)
  }
  if (groupBy === 'item') {
    const [invRows, cnRows] = await Promise.all([
      repo.salesInvoicesByItem(businessId, from, to),
      repo.salesCNByItem(businessId, from, to),
    ])
    return mergeCreditRows(invRows, cnRows)
  }
  // groupBy === 'day'
  const [invRows, cnRows] = await Promise.all([
    repo.salesInvoicesByDay(businessId, from, to),
    repo.salesCNByDay(businessId, from, to),
  ])
  return mergeCreditRows(invRows, cnRows)
}

export function salesReportCsv(rows: NetGroupRow[], groupBy: string): string {
  const labelHeader = groupBy === 'customer' ? 'Customer' : groupBy === 'item' ? 'Item' : 'Date'
  return buildCsv(
    [labelHeader, 'Invoices', 'Subtotal (MVR)', 'GST (MVR)', 'Total (MVR)'],
    rows.map((r) => [r.label, String(r.docCount), r.subtotal, r.gstAmount, r.total]),
  )
}

// ─── Purchases register ───────────────────────────────────────────────────────

export async function purchasesReport(
  businessId: string,
  from: string,
  to: string,
  groupBy: 'supplier' | 'item' | 'day',
): Promise<NetGroupRow[]> {
  let rows: GroupRow[]
  if (groupBy === 'supplier') {
    rows = await repo.purchasesBySupplier(businessId, from, to)
  } else if (groupBy === 'item') {
    rows = await repo.purchasesByItem(businessId, from, to)
  } else {
    rows = await repo.purchasesByDay(businessId, from, to)
  }
  return rows.map((r) => ({
    groupKey: r.groupKey,
    label: r.label,
    docCount: Number(r.docCount),
    subtotal: new Decimal(r.subtotal).toFixed(2),
    gstAmount: new Decimal(r.gstAmount).toFixed(2),
    total: new Decimal(r.total).toFixed(2),
  }))
}

export function purchasesReportCsv(rows: NetGroupRow[], groupBy: string): string {
  const labelHeader = groupBy === 'supplier' ? 'Supplier' : groupBy === 'item' ? 'Item' : 'Date'
  return buildCsv(
    [labelHeader, 'Bills', 'Subtotal (MVR)', 'GST (MVR)', 'Total (MVR)'],
    rows.map((r) => [r.label, String(r.docCount), r.subtotal, r.gstAmount, r.total]),
  )
}

// ─── Stock valuation ──────────────────────────────────────────────────────────

interface Lot {
  qty: Decimal
  unitCost: Decimal
}

function computeAvgCostValue(movements: StockMovementRow[]): { qty: Decimal; avgCost: Decimal } {
  let costBasis = new Decimal(0)
  let inQty = new Decimal(0)
  let netQty = new Decimal(0)

  for (const m of movements) {
    const qty = new Decimal(m.qty)
    netQty = netQty.plus(qty)
    if (qty.gt(0) && m.unitCost) {
      costBasis = costBasis.plus(qty.times(new Decimal(m.unitCost)))
      inQty = inQty.plus(qty)
    }
  }

  const avgCost = inQty.gt(0) ? costBasis.div(inQty) : new Decimal(0)
  return { qty: netQty.gt(0) ? netQty : new Decimal(0), avgCost }
}

function computeFifoValue(movements: StockMovementRow[]): { qty: Decimal; value: Decimal } {
  const lots: Lot[] = []
  let netQty = new Decimal(0)

  for (const m of movements) {
    const qty = new Decimal(m.qty)
    netQty = netQty.plus(qty)
    if (qty.gt(0)) {
      lots.push({ qty, unitCost: new Decimal(m.unitCost ?? '0') })
    } else if (qty.lt(0)) {
      let remaining = qty.abs()
      while (remaining.gt(0) && lots.length > 0) {
        const lot = lots[0]!
        if (lot.qty.lte(remaining)) {
          remaining = remaining.minus(lot.qty)
          lots.shift()
        } else {
          lot.qty = lot.qty.minus(remaining)
          remaining = new Decimal(0)
        }
      }
    }
  }

  const fifoQty = netQty.gt(0) ? netQty : new Decimal(0)
  const fifoValue = lots.reduce((acc, l) => acc.plus(l.qty.times(l.unitCost)), new Decimal(0))
  return { qty: fifoQty, value: fifoValue }
}

export async function stockValuationReport(
  businessId: string,
  asOf: string,
  method: 'avg' | 'fifo',
): Promise<StockValuationRow[]> {
  const [allItemRows, movements] = await Promise.all([
    repo.allItems(businessId),
    repo.stockMovementsWithCost(businessId, asOf),
  ])

  // Group movements by item
  const byItem = new Map<string, StockMovementRow[]>()
  for (const m of movements) {
    const list = byItem.get(m.itemId) ?? []
    list.push(m)
    byItem.set(m.itemId, list)
  }

  const rows: StockValuationRow[] = []
  for (const item of allItemRows) {
    const itemMovements = byItem.get(item.id) ?? []

    if (method === 'fifo') {
      const { qty, value } = computeFifoValue(itemMovements)
      if (qty.isZero() && value.isZero()) continue
      const avgCostForDisplay = qty.gt(0) ? value.div(qty) : new Decimal(0)
      rows.push({
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        qty: qty.toFixed(4),
        avgCost: avgCostForDisplay.toFixed(2),
        value: value.toFixed(2),
      })
    } else {
      const { qty, avgCost } = computeAvgCostValue(itemMovements)
      if (qty.isZero()) continue
      rows.push({
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        qty: qty.toFixed(4),
        avgCost: avgCost.toFixed(2),
        value: qty.times(avgCost).toFixed(2),
      })
    }
  }

  return rows
}

export function stockValuationCsv(rows: StockValuationRow[], method: string): string {
  return buildCsv(
    [
      'SKU',
      'Item',
      'Qty on Hand',
      `${method === 'fifo' ? 'FIFO' : 'Avg'} Cost (MVR)`,
      'Value (MVR)',
    ],
    rows.map((r) => [r.sku, r.itemName, r.qty, r.avgCost, r.value]),
  )
}

// ─── Aged receivables / payables ──────────────────────────────────────────────

function daysBetween(asOf: string, dueDate: string | null): number {
  if (!dueDate) return 0
  const msPerDay = 86_400_000
  return Math.floor((new Date(asOf).getTime() - new Date(dueDate).getTime()) / msPerDay)
}

function bucketRows(rawRows: AgedRow[], asOf: string): AgedEntityRow[] {
  const byEntity = new Map<
    string,
    {
      name: string
      current: Decimal
      d1_30: Decimal
      d31_60: Decimal
      d61_90: Decimal
      d91p: Decimal
    }
  >()

  for (const row of rawRows) {
    if (!byEntity.has(row.entityId)) {
      byEntity.set(row.entityId, {
        name: row.entityName,
        current: new Decimal(0),
        d1_30: new Decimal(0),
        d31_60: new Decimal(0),
        d61_90: new Decimal(0),
        d91p: new Decimal(0),
      })
    }
    const entity = byEntity.get(row.entityId)!
    const amount = new Decimal(row.outstanding)
    const daysOverdue = daysBetween(asOf, row.dueDate)

    if (daysOverdue <= 0) {
      entity.current = entity.current.plus(amount)
    } else if (daysOverdue <= 30) {
      entity.d1_30 = entity.d1_30.plus(amount)
    } else if (daysOverdue <= 60) {
      entity.d31_60 = entity.d31_60.plus(amount)
    } else if (daysOverdue <= 90) {
      entity.d61_90 = entity.d61_90.plus(amount)
    } else {
      entity.d91p = entity.d91p.plus(amount)
    }
  }

  return Array.from(byEntity.entries()).map(([entityId, e]) => ({
    entityId,
    entityName: e.name,
    current: e.current.toFixed(2),
    days1_30: e.d1_30.toFixed(2),
    days31_60: e.d31_60.toFixed(2),
    days61_90: e.d61_90.toFixed(2),
    days91Plus: e.d91p.toFixed(2),
    total: e.current.plus(e.d1_30).plus(e.d31_60).plus(e.d61_90).plus(e.d91p).toFixed(2),
  }))
}

export async function agedReceivablesReport(
  businessId: string,
  asOf: string,
): Promise<AgedEntityRow[]> {
  const rawRows = await repo.agedReceivablesRaw(businessId, asOf)
  return bucketRows(rawRows, asOf)
}

export async function agedPayablesReport(
  businessId: string,
  asOf: string,
): Promise<AgedEntityRow[]> {
  const rawRows = await repo.agedPayablesRaw(businessId, asOf)
  return bucketRows(rawRows, asOf)
}

export function agedCsv(rows: AgedEntityRow[], entityLabel: string): string {
  return buildCsv(
    [entityLabel, 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '91+ Days', 'Total (MVR)'],
    rows.map((r) => [
      r.entityName,
      r.current,
      r.days1_30,
      r.days31_60,
      r.days61_90,
      r.days91Plus,
      r.total,
    ]),
  )
}

// ─── GST summary ──────────────────────────────────────────────────────────────

export async function gstSummaryReport(
  businessId: string,
  from: string,
  to: string,
): Promise<GstSummaryResult> {
  const [invLines, cnLines, billLines] = await Promise.all([
    repo.gstSummaryInvoiceLines(businessId, from, to),
    repo.gstSummaryCNLines(businessId, from, to),
    repo.gstSummaryBillLines(businessId, from, to),
  ])

  // Output tax: invoices minus credit notes, grouped by category
  const outputByCategory: Record<string, { net: Decimal; gst: Decimal }> = {}
  for (const row of invLines) {
    outputByCategory[row.category] = {
      net: new Decimal(row.netAmount),
      gst: new Decimal(row.gstAmount),
    }
  }
  for (const row of cnLines) {
    const existing = outputByCategory[row.category]
    if (existing) {
      existing.net = existing.net.minus(new Decimal(row.netAmount))
      existing.gst = existing.gst.minus(new Decimal(row.gstAmount))
    } else {
      outputByCategory[row.category] = {
        net: new Decimal(row.netAmount).negated(),
        gst: new Decimal(row.gstAmount).negated(),
      }
    }
  }

  // Input tax: bills grouped by category
  const inputByCategory: Record<string, { net: Decimal; gst: Decimal }> = {}
  for (const row of billLines) {
    const existing = inputByCategory[row.category]
    if (existing) {
      existing.net = existing.net.plus(new Decimal(row.netAmount))
      existing.gst = existing.gst.plus(new Decimal(row.gstAmount))
    } else {
      inputByCategory[row.category] = {
        net: new Decimal(row.netAmount),
        gst: new Decimal(row.gstAmount),
      }
    }
  }

  const totalOutput = Object.values(outputByCategory).reduce(
    (acc, v) => acc.plus(v.gst),
    new Decimal(0),
  )
  const totalInput = Object.values(inputByCategory).reduce(
    (acc, v) => acc.plus(v.gst),
    new Decimal(0),
  )

  return {
    from,
    to,
    outputTaxByCategory: Object.fromEntries(
      Object.entries(outputByCategory).map(([k, v]) => [
        k,
        { net: v.net.toFixed(2), gst: v.gst.toFixed(2) },
      ]),
    ),
    inputTaxByCategory: Object.fromEntries(
      Object.entries(inputByCategory).map(([k, v]) => [
        k,
        { net: v.net.toFixed(2), gst: v.gst.toFixed(2) },
      ]),
    ),
    totalOutputTax: totalOutput.toFixed(2),
    totalInputTax: totalInput.toFixed(2),
    netPayable: totalOutput.minus(totalInput).toFixed(2),
  }
}

export function gstSummaryCsv(result: GstSummaryResult): string {
  const rows: string[][] = []
  for (const [cat, { net, gst }] of Object.entries(result.outputTaxByCategory)) {
    rows.push(['Output', cat, net, gst])
  }
  for (const [cat, { net, gst }] of Object.entries(result.inputTaxByCategory)) {
    rows.push(['Input', cat, net, gst])
  }
  rows.push(['', 'Total Output Tax', '', result.totalOutputTax])
  rows.push(['', 'Total Input Tax', '', result.totalInputTax])
  rows.push(['', 'Net Payable', '', result.netPayable])
  return buildCsv(['Type', 'Category', 'Taxable Amount (MVR)', 'GST (MVR)'], rows)
}
