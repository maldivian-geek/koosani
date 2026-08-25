import { describe, it, expect } from 'vitest'
import { wordsToTsv } from '../order-list-ocr.js'
import type { OcrWord } from '../ocr-engine.js'

// Pure clustering tests (Phase 36, tuned against a gridded-spreadsheet
// fixture in the Phase 36 follow-up) — no I/O, no real OCR. Rows come from
// tesseract's line segmentation (lineId); cells cluster on x-gaps; repairRow
// resolves the quantity by signal priority (see order-list-ocr.ts).

function word(
  text: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lineId: number,
): OcrWord {
  return { text, x0, y0, x1, y1, lineId }
}

describe('wordsToTsv', () => {
  it('returns an empty string for no words', () => {
    expect(wordsToTsv([])).toBe('')
  })

  it('clusters two tesseract lines into item/qty TSV rows', () => {
    const words: OcrWord[] = [
      word('RICE', 0, 0, 30, 20, 0),
      word('25', 34, 0, 50, 20, 0),
      word('KG', 54, 0, 80, 20, 0),
      word('10', 300, 0, 320, 20, 0),
      word('SUGAR', 0, 40, 40, 60, 1),
      word('50', 44, 40, 60, 60, 1),
      word('KG', 64, 40, 90, 60, 1),
      word('5', 300, 40, 315, 60, 1),
    ]

    expect(wordsToTsv(words)).toBe('RICE 25 KG\t10\nSUGAR 50 KG\t5')
  })

  it('merges two tesseract lines that share a visual row (split columns)', () => {
    // Same y-band but tesseract emitted the qty column as a separate "line";
    // pitch to the genuinely next row is 40px, the split is 2px.
    const words: OcrWord[] = [
      word('RICE', 0, 0, 30, 20, 0),
      word('10', 300, 2, 320, 22, 1),
      word('SUGAR', 0, 40, 40, 60, 2),
      word('5', 300, 40, 315, 60, 3),
      word('FLOUR', 0, 80, 40, 100, 4),
      word('7', 300, 80, 315, 100, 5),
    ]

    expect(wordsToTsv(words)).toBe('RICE\t10\nSUGAR\t5\nFLOUR\t7')
  })

  it('drops noise words but keeps "&" (real in product names)', () => {
    const words: OcrWord[] = [
      word('HEAD', 0, 0, 40, 20, 0),
      word('&', 44, 0, 52, 20, 0),
      word('SHOULDER', 56, 0, 140, 20, 0),
      word('.', 200, 0, 203, 20, 0),
      word('', 210, 5, 210, 15, 0),
      word('24', 300, 0, 320, 20, 0),
      word('Each', 380, 0, 420, 20, 0),
    ]

    expect(wordsToTsv(words)).toBe('HEAD & SHOULDER\t24\tEach')
  })

  it('strips border-artifact characters glued to words by table rulings', () => {
    const words: OcrWord[] = [
      word('RICE', 0, 0, 30, 20, 0),
      word('BROWN|', 34, 0, 100, 20, 0),
      word('24]', 400, 0, 430, 20, 0),
      word('|Each', 500, 0, 550, 20, 0),
    ]

    expect(wordsToTsv(words)).toBe('RICE BROWN\t24\tEach')
  })

  it('prefers a standalone qty followed by a unit cell over an earlier fused size', () => {
    // "135 GM" is part of the product name (split off by an errant gap);
    // "24" | "Each" is the real quantity.
    const words: OcrWord[] = [
      word('TS', 0, 0, 20, 20, 0),
      word('BISCOLATA', 24, 0, 140, 20, 0),
      word('135', 360, 0, 390, 20, 0),
      word('GM', 394, 0, 420, 20, 0),
      word('24', 640, 0, 660, 20, 0),
      word('Each', 800, 0, 840, 20, 0),
    ]

    expect(wordsToTsv(words)).toBe('TS BISCOLATA 135 GM\t24\tEach')
  })

  it('splits a fused "qty uom" cell and prefers it over a bare trailing number', () => {
    // "54 Each" clusters as its own fused cell, "20" is a stray note far right.
    const words: OcrWord[] = [
      word('TS', 0, 0, 20, 20, 0),
      word('CHICKEN', 24, 0, 100, 20, 0),
      word('900G', 104, 0, 150, 20, 0),
      word('54', 300, 0, 320, 20, 0),
      word('Each', 324, 0, 360, 20, 0),
      word('20', 700, 0, 720, 20, 0),
    ]

    const [row] = wordsToTsv(words).split('\n')
    const cells = (row as string).split('\t')
    expect(cells[0]).toBe('TS CHICKEN 900G')
    expect(cells[1]).toBe('54')
    expect(cells[2]).toBe('Each')
    expect(cells).toContain('20')
  })

  it('splits a fused "uom note" cell after the quantity', () => {
    const words: OcrWord[] = [
      word('SUPARI', 0, 0, 60, 20, 0),
      word('720', 300, 0, 330, 20, 0),
      word('Each', 334, 0, 370, 20, 0),
      word('TEZZ', 374, 0, 415, 20, 0),
    ]

    expect(wordsToTsv(words)).toBe('SUPARI\t720\tEach\tTEZZ')
  })

  it('peels "qty uom" off the name when the whole row fused into one cell', () => {
    const words: OcrWord[] = [
      word('PRINGLES', 0, 0, 90, 20, 0),
      word('48', 94, 0, 110, 20, 0),
      word('Each', 114, 0, 150, 20, 0),
    ]

    expect(wordsToTsv(words)).toBe('PRINGLES\t48\tEach')
  })
})
