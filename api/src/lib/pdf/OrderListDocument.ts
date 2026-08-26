import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { styles } from './styles.js'
import type { BusinessInfo } from './types.js'

const h = React.createElement

// Order lists are a checklist, not a financial document (ARCHITECTURE.md
// §4.16) — no prices anywhere in this template, same reasoning as
// DeliveryNoteDocument.ts. The extra columns (System Item, UOM, Note,
// Additional Note, Payment, Stock) don't fit the shared colDescription/
// colQty/... styles in styles.ts (those are sized for a 5-column priced
// table), so this template defines its own column widths locally.
// Flex weights are shared with the wrap-aware one-page fitting below — keep
// COL_FLEX and the StyleSheet in sync. Item gets the lion's share: product
// names are the longest field and wrapping them doubles row height.
// System Item is deliberately NOT on the PDF (owner request — the printed
// sheet uses the customer's wording only; the CSV export still carries it).
const COL_FLEX = {
  hash: 0.4,
  item: 3.2,
  qty: 0.55,
  uom: 0.6,
  note: 1.2,
  additionalNote: 1.1,
  payment: 0.75,
  stock: 0.95,
}
const FLEX_SUM = Object.values(COL_FLEX).reduce((a, b) => a + b, 0)

const localStyles = StyleSheet.create({
  notesTop: {
    marginBottom: 16,
  },
  colHash: { flex: COL_FLEX.hash },
  colItem: { flex: COL_FLEX.item },
  colQty: { flex: COL_FLEX.qty, textAlign: 'right' },
  colUom: { flex: COL_FLEX.uom },
  colNote: { flex: COL_FLEX.note },
  colAdditionalNote: { flex: COL_FLEX.additionalNote },
  colPayment: { flex: COL_FLEX.payment },
  colStock: { flex: COL_FLEX.stock },
})

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
}

const STOCK_STATUS_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  in_stock: 'In Stock',
  available: 'Available',
  not_available: 'Not Available',
}

// Quantities transport as NUMERIC strings ("24.0000") — trim insignificant
// trailing decimals for display, same rule as the frontend's formatQty
// (web/src/modules/orderLists/views/OrderListDetailView.vue).
function formatQty(q: string): string {
  return q.includes('.') ? q.replace(/0+$/, '').replace(/\.$/, '') : q
}

// One-page fit: these lists get printed and carried around, so the table
// densifies as it grows instead of spilling to page 2. Tier selection is
// WRAP-AWARE — it estimates each row's height from the actual text widths
// against the real column geometry (long product names wrapping to a second
// line is what actually blows the page budget, not the row count), then
// picks the largest font that fits. Floors at 5.5pt; past that a second
// page is unavoidable at readable sizes.
const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const PAGE_PADDING = 40
const HEADER_ALLOWANCE = 75 // business/title header + its margin
const NOTES_ALLOWANCE = 40 // notes block when present
const TABLE_CHROME = 16 // table margin + borders
const AVG_CHAR_FACTOR = 0.52 // Helvetica average glyph width ≈ 0.52 × fontSize
const LINE_HEIGHT = 1.2

// Starts at 8pt (owner preference — denser than the shared 9pt document
// base) and steps down as the wrap-aware fit requires.
const TIERS: Array<{ fontSize: number; paddingVertical: number }> = [
  { fontSize: 8, paddingVertical: 3 },
  { fontSize: 7.5, paddingVertical: 2.5 },
  { fontSize: 7, paddingVertical: 2 },
  { fontSize: 6.5, paddingVertical: 2 },
  { fontSize: 6, paddingVertical: 1.5 },
  { fontSize: 5.5, paddingVertical: 1.5 },
]

function tableScale(
  lines: OrderListLinePdfData[],
  hasNotes: boolean,
): { fontSize: number; paddingVertical: number } {
  const usableWidth = A4_WIDTH - 2 * PAGE_PADDING
  const colWidth = (flex: number) => (usableWidth * flex) / FLEX_SUM
  const widths = {
    item: colWidth(COL_FLEX.item),
    note: colWidth(COL_FLEX.note),
    additionalNote: colWidth(COL_FLEX.additionalNote),
  }
  const budget =
    A4_HEIGHT -
    2 * PAGE_PADDING -
    HEADER_ALLOWANCE -
    (hasNotes ? NOTES_ALLOWANCE : 0) -
    TABLE_CHROME

  for (const tier of TIERS) {
    const charWidth = tier.fontSize * AVG_CHAR_FACTOR
    const textLines = (text: string | null, width: number) =>
      Math.max(1, Math.ceil(((text ?? '').length * charWidth) / width))
    const headerRowHeight = tier.fontSize * LINE_HEIGHT + 2 * tier.paddingVertical
    const rowsHeight = lines.reduce((sum, line) => {
      const rowLines = Math.max(
        textLines(line.itemName, widths.item),
        textLines(line.note, widths.note),
        textLines(line.additionalNote, widths.additionalNote),
      )
      return sum + rowLines * tier.fontSize * LINE_HEIGHT + 2 * tier.paddingVertical + 0.5
    }, 0)
    if (headerRowHeight + rowsHeight <= budget) return tier
  }
  return TIERS[TIERS.length - 1] as { fontSize: number; paddingVertical: number }
}

// Row tints mirroring the owner's original spreadsheet: paid rows green,
// not-available rows red (red wins when both apply — unavailability is the
// more actionable signal). Light tints so black text stays printable.
function rowTint(line: OrderListLinePdfData): string | null {
  if (line.stockStatus === 'not_available') return '#fdecea'
  if (line.paymentStatus === 'paid') return '#e8f5e9'
  return null
}

export type OrderListLinePdfData = {
  position: number
  itemName: string
  systemItemName: string | null
  qty: string
  uom: string
  note: string | null
  additionalNote: string | null
  paymentStatus: string
  stockStatus: string
}

export type OrderListPdfData = {
  business: BusinessInfo
  title: string
  notes: string | null
  lines: OrderListLinePdfData[]
}

export function OrderListDocument(data: OrderListPdfData): React.ReactElement {
  const scale = tableScale(data.lines, !!data.notes)
  const scaleStyle = { fontSize: scale.fontSize, paddingVertical: scale.paddingVertical }
  return h(
    Document,
    null,
    h(
      Page,
      { size: 'A4', style: styles.page },
      h(
        View,
        { style: styles.headerRow },
        h(
          View,
          null,
          data.business.logoUrl
            ? h(Image, { style: styles.logo, src: data.business.logoUrl })
            : null,
          h(Text, { style: styles.businessName }, data.business.name),
          data.business.address ? h(Text, { style: styles.muted }, data.business.address) : null,
          data.business.tin ? h(Text, { style: styles.muted }, `TIN: ${data.business.tin}`) : null,
        ),
        h(
          View,
          { style: styles.titleBlock },
          h(Text, { style: styles.title }, 'ORDER LIST'),
          h(Text, null, data.title),
        ),
      ),
      data.notes
        ? h(
            View,
            { style: localStyles.notesTop },
            h(Text, { style: styles.sectionLabel }, 'Notes'),
            h(Text, null, data.notes),
          )
        : null,
      h(
        View,
        { style: styles.table },
        h(
          View,
          { style: [styles.tableHeaderRow, scaleStyle] },
          h(Text, { style: localStyles.colHash }, '#'),
          h(Text, { style: localStyles.colItem }, 'Item'),
          h(Text, { style: localStyles.colQty }, 'Qty'),
          h(Text, { style: localStyles.colUom }, 'UOM'),
          h(Text, { style: localStyles.colNote }, 'Note'),
          h(Text, { style: localStyles.colAdditionalNote }, 'Additional Note'),
          h(Text, { style: localStyles.colPayment }, 'Payment'),
          h(Text, { style: localStyles.colStock }, 'Stock'),
        ),
        ...data.lines.map((line, i) => {
          const tint = rowTint(line)
          return h(
            View,
            {
              key: i,
              style: tint
                ? [styles.tableRow, scaleStyle, { backgroundColor: tint }]
                : [styles.tableRow, scaleStyle],
            },
            h(Text, { style: localStyles.colHash }, String(line.position + 1)),
            h(Text, { style: localStyles.colItem }, line.itemName),
            h(Text, { style: localStyles.colQty }, formatQty(line.qty)),
            h(Text, { style: localStyles.colUom }, line.uom),
            h(Text, { style: localStyles.colNote }, line.note ?? ''),
            h(Text, { style: localStyles.colAdditionalNote }, line.additionalNote ?? ''),
            h(Text, { style: localStyles.colPayment }, PAYMENT_STATUS_LABELS[line.paymentStatus]),
            h(Text, { style: localStyles.colStock }, STOCK_STATUS_LABELS[line.stockStatus]),
          )
        }),
      ),
      h(
        Text,
        { style: styles.footer, fixed: true },
        `${data.business.name} — order list, not a financial document`,
      ),
    ),
  )
}
