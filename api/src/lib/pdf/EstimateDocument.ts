import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { styles, formatMoney } from './styles.js'
import type { BusinessInfo, PartyInfo, DocumentLine } from './types.js'

const h = React.createElement

export type EstimatePdfData = {
  business: BusinessInfo
  number: string
  issueDate: string
  expiryDate: string | null
  billTo: PartyInfo
  lines: DocumentLine[]
  subtotal: string
  gstAmount: string
  total: string
  notes: string | null
}

export function EstimateDocument(data: EstimatePdfData): React.ReactElement {
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
          h(Text, { style: styles.title }, 'ESTIMATE'),
          h(Text, null, data.number),
        ),
      ),
      h(
        View,
        { style: styles.billToRow },
        h(
          View,
          null,
          h(Text, { style: styles.sectionLabel }, 'Prepared For'),
          h(Text, null, data.billTo.name),
          data.billTo.address ? h(Text, { style: styles.muted }, data.billTo.address) : null,
        ),
        h(
          View,
          { style: styles.titleBlock },
          h(Text, null, `Issue date: ${data.issueDate}`),
          data.expiryDate ? h(Text, null, `Valid until: ${data.expiryDate}`) : null,
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
          h(Text, { style: styles.colRate }, 'Rate'),
          h(Text, { style: styles.colGst }, 'GST'),
          h(Text, { style: styles.colTotal }, 'Total'),
        ),
        ...data.lines.map((line, i) =>
          h(
            View,
            { key: i, style: styles.tableRow },
            h(Text, { style: styles.colDescription }, line.description),
            h(Text, { style: styles.colQty }, line.qty),
            h(Text, { style: styles.colRate }, formatMoney(line.rate)),
            h(Text, { style: styles.colGst }, line.gstAmount ? formatMoney(line.gstAmount) : '—'),
            h(Text, { style: styles.colTotal }, formatMoney(line.lineTotal)),
          ),
        ),
      ),
      h(
        View,
        { style: styles.totalsBlock },
        h(
          View,
          { style: styles.totalsRow },
          h(Text, null, 'Subtotal'),
          h(Text, null, formatMoney(data.subtotal)),
        ),
        h(
          View,
          { style: styles.totalsRow },
          h(Text, null, 'Estimated GST'),
          h(Text, null, formatMoney(data.gstAmount)),
        ),
        h(
          View,
          { style: styles.totalsRowFinal },
          h(Text, null, 'Total'),
          h(Text, null, formatMoney(data.total)),
        ),
      ),
      data.notes ? h(View, { style: styles.notes }, h(Text, null, data.notes)) : null,
      h(
        Text,
        { style: styles.footer, fixed: true },
        `${data.business.name} — this is an estimate, not a tax invoice`,
      ),
    ),
  )
}
