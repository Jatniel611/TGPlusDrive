import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** SHA-256 de un archivo, en streaming (no carga el archivo en memoria). */
export function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
