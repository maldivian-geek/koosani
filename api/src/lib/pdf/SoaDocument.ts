import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { styles, formatMoney } from './styles.js'
import type { BusinessInfo, PartyInfo } from './types.js'

const h = React.createElement

export type SoaEntryData = {
  date: string
  type: string
  ref: string
  debit: string | null
  credit: string | null
  balance: string
}

export type SoaPdfData = {
  business: BusinessInfo
  party: PartyInfo
  partyLabel: 'Customer' | 'Supplier'
  from: string
  to: string
  openingBalance: string | null
  entries: SoaEntryData[]
  closingBalance: string
}

export function SoaDocument(data: SoaPdfData): React.ReactElement {
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
          h(Text, { style: styles.title }, 'STATEMENT OF ACCOUNT'),
          h(Text, null, `${data.from} to ${data.to}`),
        ),
      ),
      h(
        View,
        { style: styles.billToRow },
        h(
          View,
          null,
          h(Text, { style: styles.sectionLabel }, data.partyLabel),
          h(Text, null, data.party.name),
          data.party.address ? h(Text, { style: styles.muted }, data.party.address) : null,
        ),
        data.openingBalance != null
          ? h(
              View,
              { style: styles.titleBlock },
              h(Text, null, `Opening balance: ${formatMoney(data.openingBalance)}`),
            )
          : null,
      ),
      h(
        View,
        { style: styles.table },
        h(
          View,
          { style: styles.tableHeaderRow },
          h(Text, { style: { flex: 1.2 } }, 'Date'),
          h(Text, { style: styles.colDescription }, 'Type'),
          h(Text, { style: { flex: 1.5 } }, 'Reference'),
          h(Text, { style: styles.colRate }, 'Debit'),
          h(Text, { style: styles.colGst }, 'Credit'),
          h(Text, { style: styles.colTotal }, 'Balance'),
        ),
        ...data.entries.map((entry, i) =>
          h(
            View,
            { key: i, style: styles.tableRow },
            h(Text, { style: { flex: 1.2 } }, entry.date),
            h(Text, { style: styles.colDescription }, entry.type),
            h(Text, { style: { flex: 1.5 } }, entry.ref),
            h(Text, { style: styles.colRate }, entry.debit ? formatMoney(entry.debit) : '—'),
            h(Text, { style: styles.colGst }, entry.credit ? formatMoney(entry.credit) : '—'),
            h(Text, { style: styles.colTotal }, formatMoney(entry.balance)),
          ),
        ),
      ),
      h(
        View,
        { style: styles.totalsBlock },
        h(
          View,
          { style: styles.totalsRowFinal },
          h(Text, null, 'Closing balance'),
          h(Text, null, formatMoney(data.closingBalance)),
        ),
      ),
      h(
        Text,
        { style: styles.footer, fixed: true },
        `${data.business.name} — Statement of account for ${data.party.name}`,
      ),
    ),
  )
}
