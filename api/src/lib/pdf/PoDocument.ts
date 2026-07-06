import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { styles, formatMoney } from './styles.js'
import type { BusinessInfo, PartyInfo } from './types.js'

const h = React.createElement

export type PoLineData = {
  description: string
  qtyOrdered: string
  unitCost: string
  lineTotal: string
}

export type PoPdfData = {
  business: BusinessInfo
  number: string
  orderDate: string
  expectedDate: string | null
  supplier: PartyInfo
  lines: PoLineData[]
  subtotal: string
  notes: string | null
}

export function PoDocument(data: PoPdfData): React.ReactElement {
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
          h(Text, { style: styles.title }, 'PURCHASE ORDER'),
          h(Text, null, data.number),
        ),
      ),
      h(
        View,
        { style: styles.billToRow },
        h(
          View,
          null,
          h(Text, { style: styles.sectionLabel }, 'Supplier'),
          h(Text, null, data.supplier.name),
          data.supplier.address ? h(Text, { style: styles.muted }, data.supplier.address) : null,
          data.supplier.tin ? h(Text, { style: styles.muted }, `TIN: ${data.supplier.tin}`) : null,
        ),
        h(
          View,
          { style: styles.titleBlock },
          h(Text, null, `Order date: ${data.orderDate}`),
          data.expectedDate ? h(Text, null, `Expected: ${data.expectedDate}`) : null,
        ),
      ),
      h(
        View,
        { style: styles.table },
        h(
          View,
          { style: styles.tableHeaderRow },
          h(Text, { style: styles.colDescription }, 'Description'),
          h(Text, { style: styles.colQty }, 'Qty'),
          h(Text, { style: styles.colRate }, 'Unit cost'),
          h(Text, { style: styles.colTotal }, 'Total'),
        ),
        ...data.lines.map((line, i) =>
          h(
            View,
            { key: i, style: styles.tableRow },
            h(Text, { style: styles.colDescription }, line.description),
            h(Text, { style: styles.colQty }, line.qtyOrdered),
            h(Text, { style: styles.colRate }, formatMoney(line.unitCost)),
            h(Text, { style: styles.colTotal }, formatMoney(line.lineTotal)),
          ),
        ),
      ),
      h(
        View,
        { style: styles.totalsBlock },
        h(
          View,
          { style: styles.totalsRowFinal },
          h(Text, null, 'Subtotal'),
          h(Text, null, formatMoney(data.subtotal)),
        ),
      ),
      data.notes ? h(View, { style: styles.notes }, h(Text, null, data.notes)) : null,
      h(
        Text,
        { style: styles.footer, fixed: true },
        `${data.business.name} — Purchase order (no GST)`,
      ),
    ),
  )
}
