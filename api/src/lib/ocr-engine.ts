import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import * as Tesseract from 'tesseract.js'

// Thin wrapper around tesseract.js — the ONLY file in this codebase that
// imports it (Phase 36). Everything downstream (lib/order-list-ocr.ts,
// worker/extract.ts) depends only on the OcrWord[] contract below, so tests
// can mock this module instead of running real OCR.
//
// tesseract.js@7.0.0 API used here (verified against the installed
// package's README/src/index.d.ts, not guessed):
//   - `Tesseract.createWorker(langs, oem, options)` — a lazily-created
//     singleton worker. `cachePath` (WorkerOptions) controls where the ~11MB
//     `eng.traineddata` is cached on disk after first download (STACK.md).
//   - `worker.recognize(image, options, output)` — v6+ only returns `text`
//     by default; per-word bounding boxes require `output: { blocks: true }`,
//     which nests `data.blocks[].paragraphs[].lines[].words[]` (each word
//     carrying `text`/`confidence`/`bbox: {x0,y0,x1,y1}`) rather than a flat
//     `data.words` array — flattened below.

// `lineId` is the index of the tesseract-detected text line the word belongs
// to — downstream clustering trusts tesseract's line segmentation for ROWS
// (it is far more reliable than re-clustering y-centers on tight table rows)
// and only clusters cells within a line.
export type OcrWord = {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  lineId: number
}

// Small screenshots OCR poorly — real-world order sheets are ~700px wide with
// ~12px text, far below tesseract's sweet spot (~30-50px glyphs). Upscale so
// the width is at least this wide (≈4× for a typical sheet screenshot).
const MIN_WIDTH = 2800

// Node-side cache for the downloaded traineddata (~11MB, fetched on first
// use). Baking it into the Docker image is a follow-up (STACK.md) — not done
// in this phase (deploy stability freeze).
const CACHE_PATH = path.join(os.tmpdir(), 'koosani-tesseract-cache')

let workerPromise: Promise<Tesseract.Worker> | null = null

async function createOcrWorker(): Promise<Tesseract.Worker> {
  const worker = await Tesseract.createWorker('eng', 1, { cachePath: CACHE_PATH })
  // PSM 6 ("assume a single uniform block of text") reads a gridded table
  // row-by-row; the default auto segmentation (PSM 3) tends to carve bordered
  // tables into per-column blocks, which scrambles row order entirely.
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
    // The preprocessed PNG carries no DPI metadata; tesseract then assumes
    // 70dpi ("Invalid resolution 0 dpi") and its internal scaling merges
    // adjacent table rows and butchers glyphs. The upscaled input is
    // effectively scan-resolution, so declare it as such.
    user_defined_dpi: '300',
  })
  return worker
}

async function getWorker(): Promise<Tesseract.Worker> {
  workerPromise ??= createOcrWorker()
  return workerPromise
}

// Spreadsheet screenshots carry ruled grid lines, and they are what breaks
// tesseract on this input class: baselines of adjacent rows merge across the
// horizontal rules, and text on either side of a vertical rule fuses into one
// garbage word ("24|Each" → "24[ean"). Ruled lines are trivially detectable —
// a column/row whose dark-pixel run spans most of the image is a line, never
// text — so erase them from the raw grayscale before recognition.
// "Non-white" rather than "dark": thin rulings anti-alias to light gray
// (~170, Excel's borders are lighter still), far above any darkness cutoff —
// but they are CONTINUOUS. A column/row that is non-white across most of the
// image is a ruled line; text never covers more than ~25% of a full span.
const LINE_NONWHITE_THRESHOLD = 240
const LINE_COVERAGE = 0.7

function eraseGridLines(pixels: Buffer, width: number, height: number): void {
  const colHits = new Uint32Array(width)
  const rowHits = new Uint32Array(height)
  for (let y = 0; y < height; y++) {
    const base = y * width
    for (let x = 0; x < width; x++) {
      if ((pixels[base + x] as number) < LINE_NONWHITE_THRESHOLD) {
        colHits[x] = (colHits[x] as number) + 1
        rowHits[y] = (rowHits[y] as number) + 1
      }
    }
  }
  for (let x = 0; x < width; x++) {
    if ((colHits[x] as number) > height * LINE_COVERAGE) {
      for (let y = 0; y < height; y++) pixels[y * width + x] = 255
    }
  }
  for (let y = 0; y < height; y++) {
    if ((rowHits[y] as number) > width * LINE_COVERAGE) {
      pixels.fill(255, y * width, y * width + width)
    }
  }
}

// Grayscale + auto-rotate (EXIF) + normalize + grid erase + upscale, tuned
// for OCR accuracy on spreadsheet screenshots / table photos. Grid erasure
// runs at the ORIGINAL resolution, where ruled lines are still crisp 1-2px
// runs — erasing after interpolated upscaling leaves soft gray ghosts that
// keep corrupting tesseract's baseline detection. Exported for the OCR
// tuning harness/tests.
export async function preprocessForOcr(image: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(image)
    .rotate()
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true })

  eraseGridLines(data, info.width, info.height)

  let pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } })
  if (info.width < MIN_WIDTH) {
    pipeline = pipeline.resize({ width: MIN_WIDTH })
  }
  return pipeline.png().toBuffer()
}

function flattenWords(data: Tesseract.Page): OcrWord[] {
  const words: OcrWord[] = []
  let lineId = 0
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({
            text: word.text,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
            lineId,
          })
        }
        lineId++
      }
    }
  }
  return words
}

async function recognizeWords(worker: Tesseract.Worker, image: Buffer): Promise<OcrWord[]> {
  const result = await worker.recognize(image, {}, { blocks: true })
  return flattenWords(result.data)
}

export async function ocrImage(image: Buffer): Promise<OcrWord[]> {
  const prepped = await preprocessForOcr(image)
  const worker = await getWorker()
  try {
    return await recognizeWords(worker, prepped)
  } catch (err) {
    // Worker crash — recreate the singleton once and retry before giving up.
    workerPromise = null
    const freshWorker = await getWorker()
    try {
      return await recognizeWords(freshWorker, prepped)
    } catch {
      throw err
    }
  }
}
