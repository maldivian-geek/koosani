import Papa from 'papaparse'
import { OrderLineCreate } from '@koosani/shared'

// Parses text pasted from a spreadsheet (Excel clipboard = TSV) or a CSV into
// draft order-list lines. Purely a text transform — nothing is persisted; the
// caller shows the result in a review-and-confirm screen before any write
// (SECURITY.md §13.13). Columns are positional, matching the owner's sheet:
//   Item | Qty | UOM | Note | Additional note
// Extra columns are ignored; a header row is detected and skipped; a missing
// or non-numeric qty defaults to 1 rather than dropping the row.

const QTY_RE = /^\d+(\.\d{1,4})?$/
const HEADER_RE = /^(item|name|description|product)s?\b/i

export type ParsedImport = {
  lines: OrderLineCreate[]
  skipped: number
}

function normalizeQty(raw: string | undefined): string {
  if (!raw) return '1'
  const cleaned = raw.replace(/[,\s]/g, '')
  if (!QTY_RE.test(cleaned)) return '1'
  // "1200.00" → keep as-is (Qty allows up to 4 decimals); strip a lone trailing dot
  return cleaned
}

function clamp(raw: string | undefined, max: number): string | undefined {
  const v = raw?.trim()
  if (!v) return undefined
  return v.length > max ? v.slice(0, max) : v
}

export function parseImportText(text: string): ParsedImport {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  const result = Papa.parse<string[]>(text.trim(), { delimiter, skipEmptyLines: true })

  const lines: OrderLineCreate[] = []
  let skipped = 0

  result.data.forEach((cells, index) => {
    const [rawName, rawQty, rawUom, rawNote, rawAdditional] = cells.map((c) => c?.trim() ?? '')

    if (!rawName) {
      skipped++
      return
    }
    // Header row: first row whose name cell is a column label and whose qty
    // cell is not a number.
    if (index === 0 && HEADER_RE.test(rawName) && !QTY_RE.test((rawQty ?? '').replace(/,/g, ''))) {
      skipped++
      return
    }

    const candidate = {
      itemName: rawName.length > 300 ? rawName.slice(0, 300) : rawName,
      qty: normalizeQty(rawQty),
      uom: clamp(rawUom, 50) ?? 'Each',
      note: clamp(rawNote, 1000),
      additionalNote: clamp(rawAdditional, 1000),
    }

    const parsed = OrderLineCreate.safeParse(candidate)
    if (parsed.success) lines.push(parsed.data)
    else skipped++
  })

  return { lines, skipped }
}
