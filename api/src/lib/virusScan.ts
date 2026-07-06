import { Socket } from 'node:net'
import { config } from './config.js'
import { logger } from './logger.js'

export type ScanResult = 'clean' | 'infected' | 'scanner_unreachable'

// clamd chunk size — well under clamd's default StreamMaxLength (25 MB).
const CHUNK_SIZE = 1024 * 1024
const SCAN_TIMEOUT_MS = 10_000

// Speaks clamd's INSTREAM protocol directly over TCP (no client library needed):
// send "zINSTREAM\0", then length-prefixed chunks, then a zero-length chunk to
// terminate, then read "stream: OK" / "stream: <name> FOUND" from the reply.
export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const host = config.CLAMAV_HOST
  if (!host) return 'scanner_unreachable'

  return new Promise((resolve) => {
    const socket = new Socket()
    let response = ''
    let settled = false

    const finish = (result: ScanResult): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(SCAN_TIMEOUT_MS)
    socket.on('timeout', () => finish('scanner_unreachable'))
    socket.on('error', (err: Error) => {
      logger.error({ err }, 'ClamAV scan connection error')
      finish('scanner_unreachable')
    })

    socket.connect(config.CLAMAV_PORT, host, () => {
      socket.write('zINSTREAM\0')
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE)
        const lenPrefix = Buffer.alloc(4)
        lenPrefix.writeUInt32BE(chunk.length, 0)
        socket.write(lenPrefix)
        socket.write(chunk)
      }
      socket.write(Buffer.alloc(4)) // zero-length chunk terminates the stream
    })

    socket.on('data', (data: Buffer) => {
      response += data.toString('utf8')
    })

    socket.on('end', () => {
      if (response.includes('FOUND')) finish('infected')
      else if (response.includes('OK')) finish('clean')
      else finish('scanner_unreachable')
    })
  })
}
