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
const localStyles = StyleSheet.create({
  notesTop: {
    marginBottom: 16,
  },
  colHash: { flex: 0.4 },
  colItem: { flex: 1.8 },
  colSystemItem: { flex: 1.6 },
  colQty: { flex: 0.6, textAlign: 'right' },
  colUom: { flex: 0.7 },
  colNote: { flex: 1.3 },
  colAdditionalNote: { flex: 1.3 },
  colPayment: { flex: 0.9 },
  colStock: { flex: 1.1 },
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
          { style: styles.tableHeaderRow },
          h(Text, { style: localStyles.colHash }, '#'),
          h(Text, { style: localStyles.colItem }, 'Item'),
          h(Text, { style: localStyles.colSystemItem }, 'System Item'),
          h(Text, { style: localStyles.colQty }, 'Qty'),
          h(Text, { style: localStyles.colUom }, 'UOM'),
          h(Text, { style: localStyles.colNote }, 'Note'),
          h(Text, { style: localStyles.colAdditionalNote }, 'Additional Note'),
          h(Text, { style: localStyles.colPayment }, 'Payment'),
          h(Text, { style: localStyles.colStock }, 'Stock'),
        ),
        ...data.lines.map((line, i) =>
          h(
            View,
            { key: i, style: styles.tableRow },
            h(Text, { style: localStyles.colHash }, String(line.position + 1)),
            h(Text, { style: localStyles.colItem }, line.itemName),
            h(Text, { style: localStyles.colSystemItem }, line.systemItemName ?? '—'),
            h(Text, { style: localStyles.colQty }, formatQty(line.qty)),
            h(Text, { style: localStyles.colUom }, line.uom),
            h(Text, { style: localStyles.colNote }, line.note ?? ''),
            h(Text, { style: localStyles.colAdditionalNote }, line.additionalNote ?? ''),
            h(Text, { style: localStyles.colPayment }, PAYMENT_STATUS_LABELS[line.paymentStatus]),
            h(Text, { style: localStyles.colStock }, STOCK_STATUS_LABELS[line.stockStatus]),
          ),
        ),
      ),
      h(
        Text,
        { style: styles.footer, fixed: true },
        `${data.business.name} — order list, not a financial document`,
      ),
    ),
  )
}
