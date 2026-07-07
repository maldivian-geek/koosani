import React from 'react'
import { View, Text } from '@react-pdf/renderer'
import { styles } from './styles.js'

const h = React.createElement

// Shared by every document template that supports custom fields (Phase 33c,
// UPGRADE.md G-13/F-24 — see ARCHITECTURE.md §4.15). Renders nothing if the
// business hasn't defined any fields for this doc type, or none are set —
// avoids an empty "Custom Fields" heading on every PDF.
export type CustomFieldPdfData = { label: string; value: string }

export function customFieldsSection(fields: CustomFieldPdfData[]): React.ReactElement | null {
  if (fields.length === 0) return null
  return h(
    View,
    { style: styles.notes },
    h(Text, { style: styles.sectionLabel }, 'Additional Details'),
    ...fields.map((f, i) =>
      h(View, { key: i, style: styles.metaRow }, h(Text, null, f.label), h(Text, null, f.value)),
    ),
  )
}
