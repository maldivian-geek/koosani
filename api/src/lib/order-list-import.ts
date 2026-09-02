import Papa from 'papaparse'
import { OrderLineCreate } from '@koosani/shared'

// Parses text pasted from a spreadsheet (Excel clipboard = TSV) or a CSV into
// draft order-list lines. Purely a text transform — nothing is persisted; the
// caller shows the result in a review-and-confirm screen before any write
// (SECURITY.md §13.13). Columns are positional, matching the owner's sheet:
//   Item | Qty | UOM | Note | Additional note
// Extra columns are ignored; a header row is detected and skipped; a missing
// or non-numeric qty defaults to 1 rather than dropping the row.
//
// A leading row-number column (sheets exported with their own 1..N numbering,
// as a separate cell or glued onto the name by OCR) is detected block-wide
// and stripped — the app always applies its own numbering. Detection requires
// most rows to carry a strictly increasing integer prefix, so item names that
// merely start with a digit ("3 PLY MASK") survive in un-numbered lists.

const QTY_RE = /^\d+(\.\d{1,4})?$/
const HEADER_RE = /^(item|name|description|product)s?\b/i
// A bare 1–5 digit integer, optionally "1." / "1)" style, never a decimal —
// what a row-number cell looks like.
const SEQ_CELL_RE = /^\d{1,5}[.)]?$/
const SEQ_PREFIX_RE = /^(\d{1,5})[.)]?\s+(\S.*)$/

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

type SeqHit = { value: number; kind: 'cell' } | { value: number; kind: 'prefix'; rest: string }

// Per-row leading-row-number candidate: either the first cell is a bare
// integer and the second cell is non-empty text (separate-column paste), or
// the name cell starts with an integer followed by text (OCR glue / single
// cell). A numeric second cell disqualifies the first shape — that's a
// name-less "N qty uom" row, not a numbered one.
function seqCandidate(cells: string[]): SeqHit | undefined {
  const [c0 = '', c1 = ''] = cells
  if (!c0) return undefined
  if (SEQ_CELL_RE.test(c0) && cells.length > 1 && c1 && !QTY_RE.test(c1.replace(/[,\s]/g, ''))) {
    return { value: parseInt(c0, 10), kind: 'cell' }
  }
  const m = SEQ_PREFIX_RE.exec(c0)
  if (m?.[1] && m[2] && !QTY_RE.test(m[2].replace(/[,\s]/g, ''))) {
    return { value: parseInt(m[1], 10), kind: 'prefix', rest: m[2] }
  }
  return undefined
}

export function parseImportText(text: string): ParsedImport {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  const result = Papa.parse<string[]>(text.trim(), { delimiter, skipEmptyLines: true })
  const rows = result.data.map((cells) => cells.map((c) => c?.trim() ?? ''))

  // Block-wide numbered-list detection: at least 2 hits covering most rows,
  // and the numbers strictly increase down the sheet.
  const hits = new Map<number, SeqHit>()
  rows.forEach((cells, i) => {
    const hit = seqCandidate(cells)
    if (hit) hits.set(i, hit)
  })
  const values = [...hits.values()].map((h) => h.value)
  const isNumbered =
    hits.size >= 2 &&
    hits.size >= Math.ceil(rows.length * 0.6) &&
    values.every((v, i) => i === 0 || v > (values[i - 1] as number))

  const lines: OrderLineCreate[] = []
  let skipped = 0

  rows.forEach((row, index) => {
    let cells = row
    const hit = isNumbered ? hits.get(index) : undefined
    if (hit) {
      cells = hit.kind === 'cell' ? cells.slice(1) : [hit.rest, ...cells.slice(1)]
    }
    const [rawName, rawQty, rawUom, rawNote, rawAdditional] = cells

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
