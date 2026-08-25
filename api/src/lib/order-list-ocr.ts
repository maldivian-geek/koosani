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

// Rows come from tesseract's own line segmentation (OcrWord.lineId) — far more
// reliable than re-clustering y-centers on tight table rows. Two tesseract
// lines are merged into one row only when their y-centers sit closer than this
// fraction of the median inter-line pitch (a visual row occasionally splits
// into two "lines" when a column lands in a separate block). Pitch, not line
// height: tesseract's line bboxes on tight tables overlap their neighbors, so
// height-based thresholds glue adjacent rows.
const ROW_MERGE_PITCH_FACTOR = 0.35

// Cell clustering: a gap between consecutive (x-sorted) words in a row starts
// a new cell once it exceeds this multiple of the row's median intra-word gap.
const CELL_GAP_FACTOR = 2

// Floor on the cell-gap threshold, as a multiple of median word height — stops
// a row of very tightly-packed words (median gap ~0) from splitting on every
// normal inter-word space.
const CELL_GAP_FLOOR_FACTOR = 1.5

// A gap this many times the median word height ALWAYS starts a new cell,
// regardless of the median-gap statistic — a two-word row ("PRINGLES"…"48")
// has a single gap, making 2×median-gap unreachable by construction.
const CELL_HARD_SPLIT_FACTOR = 4

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

// Table borders OCR as stray strokes glued to real text ("[BACK", "24|",
// "]Each") — strip leading/trailing border-artifact characters, keeping
// interior punctuation (a "-" inside a product name is real).
function stripBorderArtifacts(text: string): string {
  return text.replace(/^[|\[\]{}~_]+/, '').replace(/[|\[\]{}~_]+$/, '')
}

// Drops empty/whitespace words and single stray punctuation marks (OCR noise
// — a lone "-", ".", "'", etc. is never a real cell on its own). "&" is real:
// product names use it ("HEAD & SHOULDER"), and dropping it leaves a gap wide
// enough to falsely split the name into two cells.
function isNoiseWord(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length === 1 && trimmed !== '&' && !/[a-zA-Z0-9]/.test(trimmed)) return true
  return false
}

function groupRows(words: PositionedWord[]): PositionedWord[][] {
  // Group by tesseract line, ordered by each line's mean y-center.
  const byLine = new Map<number, PositionedWord[]>()
  for (const word of words) {
    const group = byLine.get(word.lineId)
    if (group) group.push(word)
    else byLine.set(word.lineId, [word])
  }
  const groups = [...byLine.values()]
    .map((g) => ({
      words: g,
      yCenter: g.reduce((s, w) => s + w.yCenter, 0) / g.length,
    }))
    .sort((a, b) => a.yCenter - b.yCenter)

  const pitches: number[] = []
  for (let i = 1; i < groups.length; i++) {
    pitches.push(
      (groups[i] as { yCenter: number }).yCenter - (groups[i - 1] as { yCenter: number }).yCenter,
    )
  }
  const medianPitch = median(pitches.filter((p) => p > 0))
  const threshold = medianPitch > 0 ? medianPitch * ROW_MERGE_PITCH_FACTOR : 0

  const rows: PositionedWord[][] = []
  let lastCenter = Number.NEGATIVE_INFINITY
  for (const group of groups) {
    const lastRow = rows[rows.length - 1]
    if (lastRow && group.yCenter - lastCenter <= threshold) {
      lastRow.push(...group.words)
    } else {
      rows.push([...group.words])
      lastCenter = group.yCenter
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

  const hardSplit = CELL_HARD_SPLIT_FACTOR * medianHeight
  const cells: PositionedWord[][] = [[sorted[0] as PositionedWord]]
  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i] as PositionedWord
    const gap = word.x0 - (sorted[i - 1] as PositionedWord).x1
    const lastCell = cells[cells.length - 1] as PositionedWord[]
    if (gap > threshold || gap > hardSplit) {
      cells.push([word])
    } else {
      lastCell.push(word)
    }
  }
  return cells
}

// Common unit words — used only to split OCR-fused cells ("54 Each" glued
// into the name, "Each TEZZ" fusing uom + note), never to reject a row.
const UOM_WORD = /^(each|ea|pcs?|pkt|box|ctn|dozen|doz|kg|gm?|ml|ltr?|bag|tin|btl)\.?$/i

// A qty-with-trailing-uom fused into one cell: "24 Each", "1,200.00 Each".
const QTY_THEN_TEXT = /^(\d[\d.,]*)\s+(.+)$/

// A qty (+ optional uom) fused onto the END of the name cell:
// "TS CHICKEN 900G 54 Each" / "PRINGLES 48 Each". Requires the trailing unit
// word so a number that is genuinely part of the name ("SPRAY 120 ML" — the
// unit there belongs to the product size, followed by nothing) is not split.
const NAME_QTY_UOM_TAIL = /^(.*\S)\s+(\d[\d.,]*)\s+([A-Za-z]+\.?)$/

// Repairs a clustered row so the quantity lands in column 2. OCR on real
// sheets produces three qty shapes, resolved in strict priority order — the
// stronger the "this is the quantity" signal, the higher the priority:
//   (a) a standalone numeric cell immediately followed by a unit-word cell
//       ("24" | "Each") — the canonical shape;
//   (b) a fused "qty uom…" cell ("54 Each", "720 Each TEZZ", "1,200.00 Each")
//       — split it;
//   (c) a bare standalone numeric cell — weakest (could be a stray note like
//       "20", which is why (a)/(b) win over it);
//   (d) nothing qty-like after the name — try peeling "qty uom" off the END
//       of the name cell ("PRINGLES 48 Each" fused into one cell).
// Everything before the chosen quantity folds into the name; everything after
// keeps its order (uom, note, additional note).
function repairRow(cells: string[]): string[] {
  let out = [...cells]
  const startsWithUom = (s: string): boolean => UOM_WORD.test(s.trim().split(/\s+/)[0] ?? '')
  const fusedQty = (s: string): RegExpExecArray | null => {
    const m = QTY_THEN_TEXT.exec(s.trim())
    return m && NUMERIC_ISH.test(m[1] as string) && startsWithUom(m[2] as string) ? m : null
  }

  let aIndex = -1
  let bIndex = -1
  let cIndex = -1
  for (let i = 1; i < out.length; i++) {
    const text = (out[i] as string).trim()
    const next = out[i + 1]
    if (aIndex === -1 && NUMERIC_ISH.test(text) && next !== undefined && startsWithUom(next)) {
      aIndex = i
    }
    if (bIndex === -1 && fusedQty(text)) bIndex = i
    if (cIndex === -1 && NUMERIC_ISH.test(text)) cIndex = i
  }

  if (aIndex !== -1) {
    out = [out.slice(0, aIndex).join(' ').trim(), ...out.slice(aIndex)]
  } else if (bIndex !== -1) {
    const m = fusedQty(out[bIndex] as string) as RegExpExecArray
    out = [
      out.slice(0, bIndex).join(' ').trim(),
      m[1] as string,
      (m[2] as string).trim(),
      ...out.slice(bIndex + 1),
    ]
  } else if (cIndex !== -1) {
    out = [out.slice(0, cIndex).join(' ').trim(), ...out.slice(cIndex)]
  } else {
    const m = NAME_QTY_UOM_TAIL.exec((out[0] as string).trim())
    if (m && NUMERIC_ISH.test(m[2] as string) && UOM_WORD.test(m[3] as string)) {
      out = [(m[1] as string).trim(), m[2] as string, m[3] as string, ...out.slice(1)]
    }
  }

  // 4. Split a fused "uom note" cell in the uom position ("Each TEZZ").
  if (out.length >= 3) {
    const uomCell = (out[2] as string).trim()
    const parts = uomCell.split(/\s+/)
    if (parts.length > 1 && UOM_WORD.test(parts[0] as string)) {
      out = [
        out[0] as string,
        out[1] as string,
        parts[0] as string,
        parts.slice(1).join(' '),
        ...out.slice(3),
      ]
    }
  }

  return out
}

export function wordsToTsv(words: OcrWord[]): string {
  const clean: PositionedWord[] = words
    .map((w) => ({ ...w, text: stripBorderArtifacts(w.text.trim()) }))
    .filter((w) => !isNoiseWord(w.text))
    .map((w) => ({ ...w, yCenter: (w.y0 + w.y1) / 2, height: Math.max(0, w.y1 - w.y0) }))

  if (clean.length === 0) return ''

  const medianHeight = median(clean.map((w) => w.height)) || 1

  const rows = groupRows(clean)

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
