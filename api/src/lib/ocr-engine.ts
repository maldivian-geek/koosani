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

export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number }

// Small screenshots OCR poorly — upscale so the shorter dimension the OCR
// engine actually reads (width) is at least this wide.
const MIN_WIDTH = 1500

// Node-side cache for the downloaded traineddata (~11MB, fetched on first
// use). Baking it into the Docker image is a follow-up (STACK.md) — not done
// in this phase (deploy stability freeze).
const CACHE_PATH = path.join(os.tmpdir(), 'koosani-tesseract-cache')

let workerPromise: Promise<Tesseract.Worker> | null = null

function createOcrWorker(): Promise<Tesseract.Worker> {
  return Tesseract.createWorker('eng', 1, { cachePath: CACHE_PATH })
}

async function getWorker(): Promise<Tesseract.Worker> {
  workerPromise ??= createOcrWorker()
  return workerPromise
}

// Grayscale + auto-rotate (EXIF) + normalize + upscale small images, mirroring
// the preprocessing rules `files/service.ts` already applies to uploaded
// images (EXIF strip) but tuned for OCR accuracy rather than storage.
async function preprocess(image: Buffer): Promise<Buffer> {
  const rotated = await sharp(image).rotate().toBuffer()
  const meta = await sharp(rotated).metadata()
  const width = meta.width ?? 0

  let pipeline = sharp(rotated).grayscale().normalize()
  if (width > 0 && width < MIN_WIDTH) {
    pipeline = pipeline.resize({ width: MIN_WIDTH })
  }
  return pipeline.toBuffer()
}

function flattenWords(data: Tesseract.Page): OcrWord[] {
  const words: OcrWord[] = []
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
          })
        }
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
  const prepped = await preprocess(image)
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
