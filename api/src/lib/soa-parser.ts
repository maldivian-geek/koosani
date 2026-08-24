import Papa from 'papaparse'
import { PDFParse } from 'pdf-parse'
import { SoaExtractLine } from '@koosani/shared'

// ─── Text line pattern ────────────────────────────────────────────────────────
// Matches: YYYY-MM-DD  REF  [description words]  AMOUNT
// Amount must be the last token and match decimal format.

const LINE_RE = /^(\d{4}-\d{2}-\d{2})\s+(\S+)(?:\s+(.+?))?\s+(\d+(?:\.\d{1,2})?)$/

export function parseTextLines(text: string): SoaExtractLine[] {
  const lines: SoaExtractLine[] = []
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(LINE_RE)
    if (!m) continue
    const [, date, ref, description, amount] = m
    const parsed = SoaExtractLine.safeParse({ date, ref, description, amount })
    if (parsed.success) lines.push(parsed.data)
  }
  return lines
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
// Expected columns (case-insensitive): date, ref, description (optional), amount

export function parseCsv(text: string): SoaExtractLine[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    transform: (v) => v.trim(),
  })

  const lines: SoaExtractLine[] = []
  for (const row of result.data) {
    const parsed = SoaExtractLine.safeParse({
      date: row['date'] ?? '',
      ref: row['ref'] ?? row['reference'] ?? '',
      description: row['description'] ?? undefined,
      amount: row['amount'] ?? '',
    })
    if (parsed.success) lines.push(parsed.data)
  }
  return lines
}

// ─── PDF parser ───────────────────────────────────────────────────────────────

export async function parsePdf(buffer: Buffer): Promise<SoaExtractLine[]> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const { text } = await parser.getText()
    return parseTextLines(text)
  } finally {
    await parser.destroy()
  }
}
