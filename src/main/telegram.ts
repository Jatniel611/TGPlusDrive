import { app } from 'electron'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import bigInt from 'big-integer'
import QRCode from 'qrcode'
import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import type { AuthMethod, AuthState, Profile, ScanProgress, VfsDb } from '@shared/types'
import { loadSession, saveAppCredentials, saveSession, upsertProfile } from './profiles'
import type { DriveStore } from './store'

const INDEX_TOKEN = 'TGPlusDrive Index'
const INDEX_JSON = 'tgplusdrive-index.json'

type AuthField = 'phone' | 'code' | 'password'

let pendingAuth: Partial<Record<AuthField, (value: string) => void>> = {}
let loginClient: TelegramClient | null = null
let loginCancelled = false

const clientOptions = {
  connectionRetries: 8,
  useWSS: false,
  autoReconnect: true,
  maxConcurrentDownloads: 4,
  deviceModel: 'TGPlusDrive',
  systemVersion: 'Windows',
  appVersion: '0.1.0',
  langCode: 'es'
}

export function provideAuth(field: AuthField, value: string): boolean {
  const resolver = pendingAuth[field]
  if (!resolver) return false
  pendingAuth[field] = undefined
  resolver(value)
  return true
}

export async function cancelLogin(): Promise<void> {
  loginCancelled = true
  const pending = pendingAuth
  pendingAuth = {}
  pending.phone?.('')
  pending.code?.('')
  pending.password?.('')
  const client = loginClient
  loginClient = null
  try {
    await client?.disconnect()
  } catch {
    /* ignore */
  }
}

export interface LoginResult {
  client: TelegramClient
  profile: Profile
}

async function finishLogin(
  client: TelegramClient,
  session: StringSession,
  apiId: number,
  apiHash: string,
  emit: (state: AuthState) => void
): Promise<LoginResult | null> {
  pendingAuth = {}
  const me = await client.getMe()
  const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ').trim()
  const displayName = fullName || me.username || 'Mi cuenta de Telegram'
  const profile = upsertProfile({
    id: me.id.toString(),
    name: displayName,
    provider: 'telegram',
    apiId,
    apiHash
  })
  saveSession(profile.id, session.save())
  saveAppCredentials({ apiId, apiHash })
  loginClient = null
  emit({ step: 'ready', profile })
  return { client, profile }
}

function handleLoginError(
  client: TelegramClient,
  err: unknown,
  emit: (state: AuthState) => void
): null {
  pendingAuth = {}
  loginClient = null
  void client.disconnect().catch(() => undefined)
  const message = err instanceof Error ? err.message : String(err)
  if (loginCancelled) {
    emit({ step: 'idle' })
    return null
  }
  emit({ step: 'error', error: message })
  return null
}

export async function startTelegramLogin(
  creds: { apiId: string; apiHash: string },
  method: AuthMethod,
  emit: (state: AuthState) => void
): Promise<LoginResult | null> {
  const apiId = Number(creds.apiId)
  const apiHash = creds.apiHash.trim()
  if (!Number.isFinite(apiId) || apiId <= 0) throw new Error('api_id inválido')
  if (!/^[0-9a-f]{32}$/i.test(apiHash)) {
    throw new Error('api_hash inválido: debe tener 32 caracteres hexadecimales')
  }

  loginCancelled = false
  const session = new StringSession('')
  const client = new TelegramClient(session, apiId, apiHash, clientOptions)
  loginClient = client

  emit({ step: 'connecting', method })

  try {
    await client.connect()
  } catch (err) {
    return handleLoginError(client, err, emit)
  }

  if (method === 'qr' || method === 'desktop') {
    const isDesktop = method === 'desktop'
    try {
      await client.signInUserWithQrCode(
        { apiId, apiHash },
        {
          qrCode: async (qr) => {
            if (loginCancelled) return
            const token = `tg://login?token=${qr.token.toString('base64url')}`
            const dataUrl = await QRCode.toDataURL(token, {
              margin: 1,
              width: 320,
              errorCorrectionLevel: 'M'
            })
            if (isDesktop) {
              // IMPORTANTE: Telegram Desktop NO puede autorizar un inicio de sesión
              // por enlace. Su handler local solo acepta tg://login?code=<num>, no
              // el token del QR (comprobado en el código de tdesktop). Abrir el
              // enlace solo provoca el aviso de "versión no actualizada", así que
              // mostramos el QR para escanear desde el móvil, que es la vía válida.
              emit({ step: 'qr', qrDataUrl: dataUrl, method: 'desktop' })
              return
            }
            emit({ step: 'qr', qrDataUrl: dataUrl, method: 'qr' })
          },
          password: async (hint?: string) => {
            emit({ step: 'password', error: hint, method: isDesktop ? 'desktop' : 'qr' })
            return new Promise<string>((resolve) => {
              pendingAuth.password = resolve
            })
          },
          onError: async (err) => {
            if (loginCancelled) return true
            emit({ step: 'error', error: err.message, method: isDesktop ? 'desktop' : 'qr' })
            return false
          }
        }
      )
      return await finishLogin(client, session, apiId, apiHash, emit)
    } catch (err) {
      return handleLoginError(client, err, emit)
    }
  }

  try {
    await client.start({
      phoneNumber: async () => {
        emit({ step: 'phone', method: 'phone' })
        return new Promise<string>((resolve) => {
          pendingAuth.phone = resolve
        })
      },
      phoneCode: async () => {
        emit({ step: 'code', method: 'phone' })
        return new Promise<string>((resolve) => {
          pendingAuth.code = resolve
        })
      },
      password: async (hint?: string) => {
        emit({ step: 'password', error: hint, method: 'phone' })
        return new Promise<string>((resolve) => {
          pendingAuth.password = resolve
        })
      },
      onError: (err) => {
        if (!loginCancelled) emit({ step: 'error', error: err.message, method: 'phone' })
      }
    })
  } catch (err) {
    return handleLoginError(client, err, emit)
  }

  return finishLogin(client, session, apiId, apiHash, emit)
}

export async function connectTelegram(profile: Profile): Promise<TelegramClient> {
  if (!profile.apiId || !profile.apiHash) {
    throw new Error('Este perfil no tiene credenciales API guardadas')
  }
  const sessionString = loadSession(profile.id)
  if (!sessionString) throw new Error('No hay sesión guardada para este perfil')

  const client = new TelegramClient(
    new StringSession(sessionString),
    profile.apiId,
    profile.apiHash,
    clientOptions
  )
  await client.connect()
  if (!(await client.checkAuthorization())) {
    await client.disconnect()
    throw new Error('La sesión expiró. Vuelve a iniciar sesión con Telegram.')
  }
  return client
}

export async function disconnect(client: TelegramClient | null): Promise<void> {
  if (!client) return
  try {
    await client.disconnect()
  } catch {
    /* ignore */
  }
}

export type UploadProgressCallback = ((progress: number) => void) & {
  isCanceled?: boolean
}

export async function uploadToSaved(
  client: TelegramClient,
  filePath: string,
  caption: string,
  onProgress?: UploadProgressCallback
): Promise<Api.Message> {
  return client.sendFile('me', {
    file: filePath,
    caption,
    forceDocument: true,
    workers: 16,
    progressCallback: onProgress
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function floodWaitSeconds(err: unknown): number {
  const value = (err as { seconds?: unknown })?.seconds
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export async function uploadToSavedWithRetry(
  client: TelegramClient,
  filePath: string,
  caption: string,
  onProgress?: UploadProgressCallback,
  isCancelled?: () => boolean,
  attempts = 5
): Promise<Api.Message> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (isCancelled?.() || onProgress?.isCanceled) throw new Error('Cancelado')
    try {
      return await uploadToSaved(client, filePath, caption, onProgress)
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('USER_CANCELED') || isCancelled?.()) {
        throw new Error('Cancelado')
      }
      if (attempt >= attempts) break
      const flood = floodWaitSeconds(err)
      const waitMs =
        flood > 0 ? flood * 1000 + 1500 : Math.min(30000, 1000 * 2 ** (attempt - 1))
      await sleep(waitMs)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function recoverUploadParts(
  client: TelegramClient,
  nodeId: string
): Promise<Array<{ messageId: number; fileId?: string; size: number; offset: number; index: number }>> {
  const found = new Map<
    number,
    { messageId: number; fileId?: string; size: number; offset: number; index: number }
  >()
  try {
    const messages = await client.getMessages('me', { search: nodeId, limit: 500 })
    for (const message of messages) {
      const caption = message?.message ?? ''
      if (!caption.includes(nodeId) || !caption.includes('|PART|')) continue
      if ((message.message ?? '').startsWith('TGPLUSDRIVE-TOOL|')) continue
      const match =
        /^TGPLUSDRIVE\|([0-9a-fA-F-]{36})\|(.+?)\|PART\|(\d+)\|(\d+)\|(\d+)\|(\d+)$/.exec(
          caption
        )
      if (!match || match[1] !== nodeId) continue
      const index = Number(match[3])
      const part = {
        messageId: message.id,
        fileId: message.document?.id?.toString(),
        size: Number(match[6]),
        offset: Number(match[5]),
        index
      }
      const existing = found.get(index)
      if (!existing || message.id < existing.messageId) found.set(index, part)
    }
  } catch {
    /* ignore recovery errors */
  }
  return [...found.values()]
}

export async function getAccountLimits(
  client: TelegramClient
): Promise<{ premium: boolean; maxBytes: number }> {
  let premium = false
  try {
    const me = await client.getMe()
    premium = Boolean((me as { premium?: boolean }).premium)
  } catch {
    /* ignore */
  }
  return { premium, maxBytes: premium ? 4 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024 }
}

const UPLOAD_UNIT = 512 * 1024
const MAX_SAFE_PART_BYTES = 1536 * 1024 * 1024
const MIN_PART_BYTES = 64 * 1024 * 1024

export function partSafeBytes(maxBytes: number): number {
  const margin = 64 * 1024 * 1024
  const ceiling = Math.min(maxBytes - margin, MAX_SAFE_PART_BYTES)
  const aligned = Math.floor(ceiling / UPLOAD_UNIT) * UPLOAD_UNIT
  return Math.max(MIN_PART_BYTES, aligned)
}

const messageCache = new Map<number, Api.Message>()
const messageInFlight = new Map<number, Promise<Api.Message>>()

/** Resuelve y cachea el mensaje antes de que mpv pida el primer rango. */
export async function warmMessage(client: TelegramClient, messageId: number): Promise<void> {
  try {
    await getMessageMedia(client, messageId)
  } catch {
    /* ignore */
  }
}

async function getMessageMedia(
  client: TelegramClient,
  messageId: number
): Promise<Api.Message> {
  const cached = messageCache.get(messageId)
  if (cached?.media) return cached
  // Deduplicar: mpv lanza varios Range en paralelo y sin esto se piden varios
  // getMessages iguales, lo que dispara FLOOD_WAIT (causa del arranque lento).
  const inFlight = messageInFlight.get(messageId)
  if (inFlight) return inFlight
  const job = (async () => {
    const messages = await client.getMessages('me', { ids: [messageId] })
    const message = messages[0]
    if (!message || !message.media) {
      throw new Error('El archivo ya no existe en Mensajes guardados')
    }
    messageCache.set(messageId, message)
    return message
  })().finally(() => messageInFlight.delete(messageId))
  messageInFlight.set(messageId, job)
  return job
}

/** Descargas en paralelo: varios rangos a la vez aceleran mucho la velocidad. */
const DOWNLOAD_WORKERS = 4

function messageSizeOf(message: Api.Message): number {
  const doc = message.document
  if (doc?.size) return Number(doc.size)
  const photo = message.photo as { size?: number } | undefined
  return Number(photo?.size ?? 0)
}

/**
 * Descarga `length` bytes del mensaje `messageId` empezando en `mediaStart`
 * (offset DENTRO de ese mensaje) y los escribe en el archivo a partir de
 * `fileOffset`. Son distintos cuando el archivo está dividido en partes: cada
 * parte es un documento que empieza en 0, pero se escribe en su posición real
 * del archivo final.
 */
async function downloadToFile(
  client: TelegramClient,
  messageId: number,
  handle: import('node:fs/promises').FileHandle,
  fileOffset: number,
  length: number,
  onBytes: (bytes: number) => void,
  mediaStart = 0
): Promise<void> {
  if (length <= 0) return
  const ALIGN = 4096
  const workers = Math.max(1, Math.min(DOWNLOAD_WORKERS, Math.ceil(length / (4 * 1024 * 1024))))
  // Segmento alineado a 4096 y sin salir del tamaño real del mensaje.
  const rawSegment = Math.ceil(length / workers)
  const segment = Math.max(ALIGN, Math.ceil(rawSegment / ALIGN) * ALIGN)
  const tasks: Promise<void>[] = []
  for (let i = 0; i < workers; i += 1) {
    const localStart = mediaStart + i * segment
    if (localStart >= mediaStart + length) break
    const localEnd = Math.min(mediaStart + length - 1, localStart + segment - 1)
    if (localEnd < localStart) break
    const writeAt = fileOffset + (localStart - mediaStart)
    tasks.push(
      (async () => {
        let position = writeAt
        for await (const chunk of streamSavedMedia(client, messageId, localStart, localEnd)) {
          await handle.write(chunk, 0, chunk.length, position)
          position += chunk.length
          onBytes(chunk.length)
        }
      })()
    )
  }
  await Promise.all(tasks)
}

export async function downloadFromSaved(
  client: TelegramClient,
  messageId: number,
  dest: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const message = await getMessageMedia(client, messageId)
  const total = messageSizeOf(message)

  const fs = await import('node:fs/promises')
  const handle = await fs.open(dest, 'w')
  let written = 0
  try {
    if (total <= 0) {
      await client.downloadMedia(message, { outputFile: dest })
      return
    }
    await downloadToFile(client, messageId, handle, 0, total, (bytes) => {
      written += bytes
      onProgress?.(total > 0 ? Math.min(1, written / total) : 0)
    })
  } finally {
    await handle.close()
  }
}

export async function downloadParts(
  client: TelegramClient,
  parts: Array<{ messageId: number; size: number }>,
  dest: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const total = parts.reduce((sum, part) => sum + part.size, 0)
  const fs = await import('node:fs/promises')
  const handle = await fs.open(dest, 'w')
  let written = 0
  try {
    const onBytes = (bytes: number): void => {
      written += bytes
      onProgress?.(total > 0 ? Math.min(1, written / total) : 0)
    }
    // Las partes ya son independientes: descargarlas en paralelo multiplica la
    // velocidad. OJO: cada parte es un documento propio que empieza en offset 0;
    // el offset dentro del mensaje es 0, y el offset global es solo para escribir.
    const concurrency = Math.min(DOWNLOAD_WORKERS, parts.length)
    const offsets: number[] = []
    let running = 0
    for (const part of parts) {
      offsets.push(running)
      running += part.size
    }
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < parts.length) {
        const index = cursor
        cursor += 1
        const part = parts[index]
        if (!part || part.size <= 0) continue
        await downloadToFile(
          client,
          part.messageId,
          handle,
          offsets[index],
          part.size,
          onBytes,
          0
        )
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
  } finally {
    await handle.close()
  }
}

export async function* streamSavedMedia(
  client: TelegramClient,
  messageId: number,
  start: number,
  end: number
): AsyncGenerator<Buffer> {
  const message = await getMessageMedia(client, messageId)

  const remaining = end - start + 1
  if (remaining <= 0) return

  // Telegram exige que el offset de upload.getFile sea múltiplo de 4096;
  // si no, responde 400 OFFSET_INVALID. Alineamos hacia abajo y descartamos
  // los bytes sobrantes del principio.
  const ALIGN = 4096
  const alignedStart = Math.floor(start / ALIGN) * ALIGN
  const skip = start - alignedStart

  const requestSize = 512 * 1024
  let produced = -skip
  let sent = 0

  for await (const chunk of client.iterDownload({
    file: message.media,
    offset: bigInt(alignedStart),
    requestSize,
    chunkSize: requestSize
  })) {
    if (!chunk || chunk.length === 0) break
    let buffer = chunk as Buffer
    if (produced < 0) {
      const drop = Math.min(-produced, buffer.length)
      buffer = buffer.subarray(drop)
      produced += drop
      if (buffer.length === 0) continue
    }
    if (sent + buffer.length > remaining) {
      buffer = buffer.subarray(0, remaining - sent)
    }
    if (buffer.length > 0) {
      produced += buffer.length
      sent += buffer.length
      yield buffer
    }
    if (sent >= remaining) break
  }
}

export async function* streamParts(
  client: TelegramClient,
  parts: Array<{ messageId: number; size: number; offset: number }>,
  start: number,
  end: number
): AsyncGenerator<Buffer> {
  if (end < start) return
  for (const part of parts) {
    const partStart = part.offset
    const partEnd = part.offset + part.size - 1
    if (partEnd < start) continue
    if (partStart > end) break
    const sliceStart = Math.max(start, partStart) - partStart
    const sliceEnd = Math.min(end, partEnd) - partStart
    for await (const chunk of streamSavedMedia(client, part.messageId, sliceStart, sliceEnd)) {
      yield chunk
    }
  }
}

function thumbSizeOf(thumb: { size?: number; sizes?: number[] } | undefined): number {
  if (!thumb) return 0
  if (typeof thumb.size === 'number') return thumb.size
  if (Array.isArray(thumb.sizes) && thumb.sizes.length > 0) return Math.max(...thumb.sizes)
  return 0
}

function pickThumb(media: {
  document?: { thumbs?: unknown[] } | null
  photo?: { sizes?: unknown[] } | null
}): unknown | undefined {
  const list = (media.document?.thumbs ?? media.photo?.sizes ?? []) as Array<{
    className?: string
    size?: number
    sizes?: number[]
  }>
  const usable = list.filter((item) => item && item.className !== 'PhotoPathSize')
  if (usable.length === 0) return undefined
  const sized = usable
    .filter((item) => thumbSizeOf(item) > 0)
    .sort((a, b) => thumbSizeOf(a) - thumbSizeOf(b))
  const target =
    [...sized].reverse().find((item) => thumbSizeOf(item) <= 400 * 1024) ??
    sized[0] ??
    usable[0]
  return target
}

export async function downloadThumbnail(
  client: TelegramClient,
  messageId: number
): Promise<Buffer | null> {
  const messages = await client.getMessages('me', { ids: [messageId] })
  const message = messages[0]
  if (!message || !message.media) return null
  const thumb = pickThumb(message.media as never)
  if (!thumb) return null
  const buffer = await client.downloadMedia(message, { thumb: thumb as never })
  return Buffer.isBuffer(buffer) ? buffer : null
}

function extensionForMime(mime?: string): string {
  if (!mime) return ''
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'application/pdf': '.pdf'
  }
  if (map[mime]) return map[mime]
  const sub = mime.split('/')[1]
  return sub ? `.${sub}` : ''
}

function documentFileName(document: {
  id?: { toString(): string }
  mimeType?: string
  attributes?: Array<{ fileName?: string }>
}): string {
  const attributes = document.attributes ?? []
  const named = attributes.find((attribute) => Boolean(attribute?.fileName))
  if (named?.fileName) return named.fileName
  return `${document.id?.toString() ?? 'archivo'}${extensionForMime(document.mimeType)}`
}

function photoFileName(message: { id: number; date?: number }): string {
  const date = new Date(message.date ? message.date * 1000 : Date.now())
  const stamp = date.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `foto_${stamp}_${message.id}.jpg`
}

function photoSizeValue(photo: { sizes?: unknown[] }): number {
  let max = 0
  for (const size of (photo.sizes ?? []) as Array<{ size?: number; sizes?: number[] }>) {
    const value = thumbSizeOf(size)
    if (value > max) max = value
  }
  return max
}

export async function scanSavedMessages(
  client: TelegramClient,
  store: DriveStore,
  onProgress: (progress: ScanProgress) => void
): Promise<{ scanned: number; added: number }> {
  const known = new Set<number>()
  for (const node of store.db.nodes) {
    if (node.storage?.messageId) known.add(node.storage.messageId)
    for (const part of node.storage?.parts ?? []) known.add(part.messageId)
  }

  const filters: Array<[string, unknown]> = [
    ['documentos', new Api.InputMessagesFilterDocument()],
    ['fotos', new Api.InputMessagesFilterPhotos()],
    ['videos', new Api.InputMessagesFilterVideo()],
    ['audio', new Api.InputMessagesFilterMusic()]
  ]

  const seen = new Set<number>()
  const batch: Array<{
    id?: string
    name: string
    size: number
    mime: string
    createdAt?: number
    storage: {
      provider: 'telegram'
      messageId: number
      fileId?: string
      parts?: Array<{ messageId: number; fileId?: string; size: number; offset: number }>
      partsComplete?: boolean
    }
  }> = []
  const partGroups = new Map<
    string,
    {
      name: string
      mime: string
      totalParts: number
      totalSize: number
      createdAt?: number
      parts: Array<{ messageId: number; fileId?: string; size: number; offset: number; index: number }>
    }
  >()
  let scanned = 0

  for (const [label, filter] of filters) {
    try {
      for await (const message of client.iterMessages('me', {
        filter: filter as never,
        limit: 3000
      })) {
        if (!message || !message.media) continue
        if (seen.has(message.id)) continue
        seen.add(message.id)
        scanned += 1
        if (scanned % 20 === 0) {
          onProgress({ phase: 'scanning', scanned, added: batch.length, filter: label })
        }
        if (known.has(message.id)) continue

        const document = message.document
        const photo = message.photo
        if (!document && !photo) continue

        const caption = message.message ?? ''
        if (caption.startsWith(INDEX_TOKEN)) continue
        if (caption.startsWith('TGPLUSDRIVE-TOOL|')) continue

        const name = document ? documentFileName(document as never) : photoFileName(message)
        if (name === INDEX_JSON) continue
        if (name === 'Recuperar TGPlusDrive.html') continue

        const size = document ? Number(document.size ?? 0) : photoSizeValue(photo as never)
        const mime = document?.mimeType || 'image/jpeg'
        const idMatch = /^TGPLUSDRIVE\|([0-9a-fA-F-]{36})\|/.exec(caption)
        const partMatch =
          /^TGPLUSDRIVE\|([0-9a-fA-F-]{36})\|(.+?)\|PART\|(\d+)\|(\d+)\|(\d+)\|(\d+)$/.exec(
            caption
          )

        if (partMatch) {
          const groupKey = partMatch[1]
          const group = partGroups.get(groupKey) ?? {
            name: partMatch[2],
            mime,
            totalParts: Number(partMatch[4]),
            totalSize: 0,
            createdAt: message.date ? message.date * 1000 : undefined,
            parts: []
          }
          group.parts.push({
            messageId: message.id,
            fileId: document?.id?.toString(),
            size: Number(partMatch[6]),
            offset: Number(partMatch[5]),
            index: Number(partMatch[3])
          })
          partGroups.set(groupKey, group)
          known.add(message.id)
          continue
        }

        if (/\.part-\d{12}$/i.test(name)) continue

        batch.push({
          id: idMatch?.[1],
          name,
          size,
          mime,
          createdAt: message.date ? message.date * 1000 : undefined,
          storage: {
            provider: 'telegram',
            messageId: message.id,
            fileId: document?.id?.toString()
          }
        })
        known.add(message.id)
      }
    } catch (err) {
      onProgress({
        phase: 'scanning',
        scanned,
        added: batch.length,
        filter: label,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  for (const [groupKey, group] of partGroups) {
    const parts = [...group.parts].sort((a, b) => a.index - b.index)
    if (parts.length === 0) continue
    const totalSize = parts.reduce((sum, part) => sum + part.size, 0)
    batch.push({
      id: groupKey,
      name: group.name,
      size: totalSize,
      mime: group.mime,
      createdAt: group.createdAt,
      storage: {
        provider: 'telegram',
        messageId: parts[0].messageId,
        fileId: parts[0].fileId,
        parts: parts.map((part) => ({
          messageId: part.messageId,
          fileId: part.fileId,
          size: part.size,
          offset: part.offset
        })),
        partsComplete: parts.length >= group.totalParts
      }
    })
  }

  const added = batch.length > 0 ? store.addManyFiles(batch) : 0
  onProgress({ phase: 'done', scanned, added })
  return { scanned, added }
}

export async function backfillNodeDates(
  client: TelegramClient,
  store: DriveStore
): Promise<number> {
  // Solo hace falta si hay nodos con fecha "sospechosa" (todos iguales por un
  // escaneo antiguo). Si las fechas ya son variadas, no gastamos peticiones.
  const fileNodes = store.db.nodes.filter((node) => node.kind === 'file' && node.storage?.messageId)
  if (fileNodes.length === 0) return 0
  const distinctDates = new Set(fileNodes.slice(0, 60).map((node) => node.createdAt))
  const needsBackfill = fileNodes.length > 3 && distinctDates.size <= 1
  if (!needsBackfill) return 0

  const messageIds = new Set<number>()
  for (const node of store.db.nodes) {
    if (node.storage?.messageId) messageIds.add(node.storage.messageId)
  }
  if (messageIds.size === 0) return 0

  const dates = new Map<number, number>()
  const ids = [...messageIds]
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100)
    try {
      const messages = await client.getMessages('me', { ids: slice })
      for (const message of messages) {
        if (message && message.date) dates.set(message.id, message.date * 1000)
      }
    } catch {
      /* ignore batch errors */
    }
  }
  return store.applyMessageDates(dates)
}

/**
 * Sincroniza el nombre en el caption de Telegram. La API no permite renombrar
 * el documento, pero sí editar el caption; como el escaneo lee el nombre del
 * caption, el renombrado se conserva aunque se reconstruya el índice.
 */
export async function renameInSaved(
  client: TelegramClient,
  messageId: number,
  newName: string
): Promise<boolean> {
  try {
    const messages = await client.getMessages('me', { ids: [messageId] })
    const message = messages[0]
    if (!message) return false
    const caption = message.message ?? ''
    // Formatos: TGPLUSDRIVE|<id>|<nombre>   y   TGPLUSDRIVE|<id>|<nombre>|PART|...
    const simple = /^(TGPLUSDRIVE\|[0-9a-fA-F-]{36}\|)(.+)$/.exec(caption)
    if (!simple) return false
    const rest = simple[2]
    const partIndex = rest.indexOf('|PART|')
    const updated =
      partIndex >= 0
        ? `${simple[1]}${newName}${rest.slice(partIndex)}`
        : `${simple[1]}${newName}`
    if (updated === caption) return false
    await client.editMessage('me', { message: messageId, text: updated })
    return true
  } catch {
    return false
  }
}

export async function deleteFromSaved(client: TelegramClient, messageId: number): Promise<void> {
  messageCache.delete(messageId)
  try {
    await client.deleteMessages('me', [messageId], { revoke: true })
  } catch {
    /* already gone */
  }
}

function indexPayload(db: VfsDb): string {
  return JSON.stringify(
    {
      _aviso:
        'NO BORRAR ESTE ARCHIVO. Es el índice de TGPlusDrive: guarda la organización de tu unidad (nombres, carpetas y posiciones de cada archivo). Si lo borras, tendrás que volver a escanear Mensajes guardados para reconstruirla.',
      _aviso_en:
        'DO NOT DELETE THIS FILE. It is the TGPlusDrive index that stores your drive layout. Deleting it forces a rescan of Saved Messages.',
      version: db.version,
      revision: db.revision,
      generatedAt: new Date().toISOString(),
      nodes: db.nodes,
      settings: db.settings,
      backup: db.backup
    },
    null,
    2
  )
}

export async function pushIndex(client: TelegramClient, store: DriveStore): Promise<number> {
  const dir = join(app.getPath('temp'), 'tgplusdrive-index')
  const file = join(dir, INDEX_JSON)
  try {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, indexPayload(store.db), 'utf8')
    const message = await uploadToSaved(
      client,
      file,
      `${INDEX_TOKEN} v1 — NO BORRAR / DO NOT DELETE`
    )
    const previous = store.db.index?.messageId
    if (previous && previous !== message.id) {
      await deleteFromSaved(client, previous)
    }
    store.setIndex(message.id)
    return message.id
  } finally {
    if (existsSync(file)) rmSync(file, { force: true })
  }
}

export async function pullIndex(client: TelegramClient, store: DriveStore): Promise<boolean> {
  const messages = await client.getMessages('me', { search: INDEX_TOKEN, limit: 20 })
  const candidates = messages.filter((m) => Boolean(m.document))
  if (candidates.length === 0) return false

  const latest = candidates.reduce((best, current) => (current.id > best.id ? current : best))
  const buffer = (await client.downloadMedia(latest, {})) as Buffer | undefined
  if (!buffer) return false

  let remote: Partial<VfsDb>
  try {
    remote = JSON.parse(buffer.toString('utf8')) as Partial<VfsDb>
  } catch {
    return false
  }
  if (!Array.isArray(remote.nodes)) return false

  const localEmpty = store.db.nodes.length === 0
  const remoteNewer = (remote.revision ?? 0) > store.db.revision
  if (!localEmpty && !remoteNewer) return false

  if (localEmpty) {
    store.replaceFromRemote(remote)
  } else {
    const merged = new Map<string, VfsDb['nodes'][number]>()
    for (const node of remote.nodes ?? []) merged.set(node.id, node)
    for (const node of store.db.nodes) merged.set(node.id, node)
    store.replaceFromRemote({ ...remote, nodes: [...merged.values()] })
  }
  store.setIndex(latest.id)
  return true
}
