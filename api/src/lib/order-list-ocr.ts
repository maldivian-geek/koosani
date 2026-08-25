import type { OcrWord } from './ocr-engine.js'

// Pure, no I/O — clusters OCR word boxes (from lib/ocr-engine.ts) into a TSV
// string with one line per table row, so it can be fed straight through the
// EXISTING lib/order-list-import.ts#parseImportText — the same review/confirm
// contract the paste-import flow already uses (ARCHITECTURE.md §4.16,
// SECURITY.md §13.13). Heavily unit-tested since the thresholds below are
// tuned by hand, not derived from any OCR-reported confidence score (OcrWord
// carries no confidence field by contract — noise filtering is text-based
// only).

type PositionedWord = OcrWord & { yCenter: number; height: number }

// Row clustering: two words belong to the same row if their y-centers differ
// by less than this fraction of the median word height.
const ROW_Y_FACTOR = 0.6

// Cell clustering: a gap between consecutive (x-sorted) words in a row starts
// a new cell once it exceeds this multiple of the row's median intra-word gap.
const CELL_GAP_FACTOR = 2

// Floor on the cell-gap threshold, as a multiple of median word height — stops
// a row of very tightly-packed words (median gap ~0) from splitting on every
// normal inter-word space.
const CELL_GAP_FLOOR_FACTOR = 1.5

// A qty-ish cell: digits, commas, dots only (matches what
// order-list-import.ts's normalizeQty already expects, e.g. "1,200.00").
const NUMERIC_ISH = /^[\d.,]+$/

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

// Drops empty/whitespace words and single stray punctuation marks (OCR noise
// — a lone "-", ".", "'", etc. is never a real cell on its own).
function isNoiseWord(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length === 1 && !/[a-zA-Z0-9]/.test(trimmed)) return true
  return false
}

function groupRows(words: PositionedWord[], medianHeight: number): PositionedWord[][] {
  const sorted = [...words].sort((a, b) => a.yCenter - b.yCenter)
  const threshold = medianHeight * ROW_Y_FACTOR
  const rows: PositionedWord[][] = []
  for (const word of sorted) {
    const lastRow = rows[rows.length - 1]
    const lastWord = lastRow?.[lastRow.length - 1]
    if (lastRow && lastWord && Math.abs(word.yCenter - lastWord.yCenter) <= threshold) {
      lastRow.push(word)
    } else {
      rows.push([word])
    }
  }
  return rows
}

function groupCells(row: PositionedWord[], medianHeight: number): PositionedWord[][] {
  const sorted = [...row].sort((a, b) => a.x0 - b.x0)
  if (sorted.length <= 1) return [sorted]

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i] as PositionedWord).x0 - (sorted[i - 1] as PositionedWord).x1)
  }
  const medianGap = median(gaps)
  const threshold = Math.max(CELL_GAP_FACTOR * medianGap, CELL_GAP_FLOOR_FACTOR * medianHeight)

  const cells: PositionedWord[][] = [[sorted[0] as PositionedWord]]
  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i] as PositionedWord
    const gap = word.x0 - (sorted[i - 1] as PositionedWord).x1
    const lastCell = cells[cells.length - 1] as PositionedWord[]
    if (gap > threshold) {
      cells.push([word])
    } else {
      lastCell.push(word)
    }
  }
  return cells
}

// OCR sometimes glues the qty to the name or splits a row's cells wrong
// (e.g. the name cell swallows the qty, or a column boundary is missed). If
// the expected qty column (index 1) isn't numeric-ish but a later cell is
// purely numeric-ish, treat that later cell as qty: everything before it
// joins into the name, everything after keeps its relative order (uom, note,
// additional note).
function repairRow(cells: string[]): string[] {
  if (cells.length < 2) return cells
  if (NUMERIC_ISH.test((cells[1] as string).trim())) return cells

  let qtyIndex = -1
  for (let i = 2; i < cells.length; i++) {
    if (NUMERIC_ISH.test((cells[i] as string).trim())) {
      qtyIndex = i
      break
    }
  }
  if (qtyIndex === -1) return cells

  const name = cells.slice(0, qtyIndex).join(' ').trim()
  const qty = cells[qtyIndex] as string
  const rest = cells.slice(qtyIndex + 1)
  return [name, qty, ...rest]
}

export function wordsToTsv(words: OcrWord[]): string {
  const clean: PositionedWord[] = words
    .filter((w) => !isNoiseWord(w.text))
    .map((w) => ({ ...w, yCenter: (w.y0 + w.y1) / 2, height: Math.max(0, w.y1 - w.y0) }))

  if (clean.length === 0) return ''

  const medianHeight = median(clean.map((w) => w.height)) || 1

  const rows = groupRows(clean, medianHeight)

  const lines = rows.map((row) => {
    const cells = groupCells(row, medianHeight).map((cellWords) =>
      cellWords
        .map((w) => w.text.trim())
        .join(' ')
        .trim(),
    )
    return repairRow(cells).join('\t')
  })

  return lines.join('\n')
}
