import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { styles } from './styles.js'
import type { BusinessInfo, PartyInfo } from './types.js'

const h = React.createElement

// No prices — a delivery note/packing slip is a physical-goods document, not
// a financial one (ARCHITECTURE.md §4.14).
export type DeliveryNoteLineData = {
  description: string
  qty: string
}

export type DeliveryNotePdfData = {
  business: BusinessInfo
  number: string
  issueDate: string
  againstInvoiceNumber: string
  deliverTo: PartyInfo
  lines: DeliveryNoteLineData[]
  notes: string | null
}

export function DeliveryNoteDocument(data: DeliveryNotePdfData): React.ReactElement {
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
        ),
        h(
          View,
          { style: styles.titleBlock },
          h(Text, { style: styles.title }, 'DELIVERY NOTE'),
          h(Text, null, data.number),
        ),
      ),
      h(
        View,
        { style: styles.billToRow },
        h(
          View,
          null,
          h(Text, { style: styles.sectionLabel }, 'Deliver To'),
          h(Text, null, data.deliverTo.name),
          data.deliverTo.address ? h(Text, { style: styles.muted }, data.deliverTo.address) : null,
        ),
        h(
          View,
          { style: styles.titleBlock },
          h(Text, null, `Issue date: ${data.issueDate}`),
          h(Text, null, `Against invoice: ${data.againstInvoiceNumber}`),
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
        ),
        ...data.lines.map((line, i) =>
          h(
            View,
            { key: i, style: styles.tableRow },
            h(Text, { style: styles.colDescription }, line.description),
            h(Text, { style: styles.colQty }, line.qty),
          ),
        ),
      ),
      data.notes ? h(View, { style: styles.notes }, h(Text, null, data.notes)) : null,
      h(
        View,
        { style: styles.notes },
        h(Text, { style: styles.sectionLabel }, 'Received by'),
        h(Text, null, ' '),
        h(Text, { style: styles.muted }, 'Name / signature / date'),
      ),
      h(
        Text,
        { style: styles.footer, fixed: true },
        `${data.business.name} — delivery note, not a tax invoice`,
      ),
    ),
  )
}
