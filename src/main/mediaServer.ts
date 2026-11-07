import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export interface SourceHandle {
  size: number
  mime: string
  stream: (start: number, end: number) => Readable
}

export type SourceResolver = (id: string) => SourceHandle | null

let server: Server | null = null
let baseUrl = ''
let resolver: SourceResolver | null = null

export function setSourceResolver(fn: SourceResolver): void {
  resolver = fn
}

export function getMediaBaseUrl(): string {
  return baseUrl
}

function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number; partial: boolean } | null {
  if (!header) return { start: 0, end: Math.max(0, size - 1), partial: false }
  const match = /bytes=(\d*)-(\d*)/.exec(header)
  if (!match) return { start: 0, end: Math.max(0, size - 1), partial: false }
  const hasStart = match[1] !== ''
  const hasEnd = match[2] !== ''
  if (!hasStart && hasEnd) {
    const suffix = parseInt(match[2], 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1, partial: true }
  }
  const start = hasStart ? parseInt(match[1], 10) : 0
  const end = hasEnd ? parseInt(match[2], 10) : size - 1
  if (!Number.isFinite(start) || start < 0) return null
  if (start > end) return null
  return { start, end: Math.min(end, size - 1), partial: true }
}

function handleSource(req: IncomingMessage, res: ServerResponse, id: string): void {
  const source = resolver?.(id)
  if (!source) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
    return
  }
  const range = parseRange(req.headers.range, source.size)
  if (!range) {
    res.writeHead(416, { 'content-range': `bytes */${source.size}` }).end()
    return
  }
  const { start, end } = range
  const headers: Record<string, string> = {
    'content-type': source.mime,
    'accept-ranges': 'bytes',
    'content-length': String(end - start + 1),
    'cache-control': 'no-store'
  }
  if (range.partial) headers['content-range'] = `bytes ${start}-${end}/${source.size}`
  res.writeHead(range.partial ? 206 : 200, headers)

  let stream: Readable
  try {
    stream = source.stream(start, end)
  } catch {
    res.destroy()
    return
  }
  let closed = false
  const done = (): void => {
    if (closed) return
    closed = true
    try {
      stream.destroy()
    } catch {
      /* ignore */
    }
  }
  req.on('close', done)
  res.on('close', done)
  stream.on('error', () => {
    if (!res.writableEnded) res.destroy()
    done()
  })
  stream.pipe(res)
}

export function startMediaServer(): Promise<string> {
  if (server && baseUrl) return Promise.resolve(baseUrl)
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts[0] !== 'src' || !parts[1]) {
          res.writeHead(404).end('Not found')
          return
        }
        handleSource(req, res, decodeURIComponent(parts[1]))
      } catch {
        if (!res.writableEnded) res.writeHead(500).end('Error')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address()
      if (address && typeof address === 'object') {
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve(baseUrl)
      } else {
        reject(new Error('No se pudo iniciar el servidor de medios'))
      }
    })
  })
}

export function stopMediaServer(): void {
  server?.close()
  server = null
  baseUrl = ''
}

export function sourceUrl(id: string, fileName?: string): string {
  const suffix = fileName ? `/${encodeURIComponent(fileName)}` : ''
  return `${baseUrl}/src/${encodeURIComponent(id)}${suffix}`
}
