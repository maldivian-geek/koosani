import { describe, it, expect } from 'vitest'
import { wordsToTsv } from '../order-list-ocr.js'
import type { OcrWord } from '../ocr-engine.js'

// Pure clustering tests (Phase 36, ARCHITECTURE.md §4.16) — no I/O, no real
// OCR. Word boxes below are hand-picked so the row-clustering (y-center gap
// < 60% of median word height) and cell-clustering (x gap > 2× the row's
// median intra-word gap, floored at 1.5× median word height) thresholds land
// unambiguously on one side or the other — see order-list-ocr.ts's comments
// for why a row needs *more* small (intra-cell) gaps than large (inter-cell)
// ones for the median-based threshold to work as intended.

function word(text: string, x0: number, y0: number, x1: number, y1: number): OcrWord {
  return { text, x0, y0, x1, y1 }
}

describe('wordsToTsv', () => {
  it('returns an empty string for no words', () => {
    expect(wordsToTsv([])).toBe('')
  })

  it('clusters two clean rows into item/qty TSV cells', () => {
    const words: OcrWord[] = [
      // Row 1 — "RICE 25 KG" | "10" (y-center 10, height 20)
      word('RICE', 0, 0, 30, 20),
      word('25', 34, 0, 50, 20),
      word('KG', 54, 0, 80, 20),
      word('10', 300, 0, 320, 20),
      // Row 2 — "SUGAR 50 KG" | "5" (y-center 50, well past row 1's threshold)
      word('SUGAR', 0, 40, 40, 60),
      word('50', 44, 40, 60, 60),
      word('KG', 64, 40, 90, 60),
      word('5', 300, 40, 315, 60),
    ]

    expect(wordsToTsv(words)).toBe('RICE 25 KG\t10\nSUGAR 50 KG\t5')
  })

  it('drops noise words (empty/whitespace and single stray punctuation)', () => {
    const clean: OcrWord[] = [
      word('RICE', 0, 0, 30, 20),
      word('25', 34, 0, 50, 20),
      word('KG', 54, 0, 80, 20),
      word('10', 300, 0, 320, 20),
    ]
    const withNoise: OcrWord[] = [
      ...clean,
      word('', 10, 5, 10, 15),
      word('   ', 20, 5, 20, 15),
      word('-', 90, 0, 95, 20),
      word('.', 200, 0, 203, 20),
      word("'", 250, 0, 253, 20),
    ]

    expect(wordsToTsv(withNoise)).toBe(wordsToTsv(clean))
    expect(wordsToTsv(withNoise)).toBe('RICE 25 KG\t10')
  })

  it('repairs a row where an unwanted split pushed qty out of column 2', () => {
    // Simulates OCR splitting "TS BISCOLATA MOOD EXTRA 135 GM" into two cells
    // (an errant gap after "EXTRA") ahead of qty "24" and uom "Each" — cell[1]
    // ("135 GM") isn't numeric-ish, but cell[2] ("24") is, so the repair pass
    // merges cell[0]+cell[1] into the name and promotes "24" to column 2.
    const words: OcrWord[] = [
      word('TS', 0, 0, 20, 20),
      word('BISCOLATA', 24, 0, 140, 20),
      word('MOOD', 144, 0, 200, 20),
      word('EXTRA', 204, 0, 260, 20),
      word('135', 360, 0, 390, 20),
      word('GM', 394, 0, 420, 20),
      word('24', 520, 0, 540, 20),
      word('Each', 640, 0, 680, 20),
    ]

    expect(wordsToTsv(words)).toBe('TS BISCOLATA MOOD EXTRA 135 GM\t24\tEach')
  })

  it('leaves a row unchanged when column 2 is already numeric-ish', () => {
    const words: OcrWord[] = [
      word('RICE', 0, 0, 30, 20),
      word('25', 34, 0, 50, 20),
      word('KG', 54, 0, 80, 20),
      word('10', 300, 0, 320, 20),
    ]
    expect(wordsToTsv(words)).toBe('RICE 25 KG\t10')
  })
})
