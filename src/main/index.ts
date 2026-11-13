import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  shell,
  Tray
} from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AuthMethod,
  AuthState,
  BackupConfigInput,
  BackupInfo,
  Bootstrap,
  DriveState,
  DuplicateAction,
  DuplicateMatch,
  Profile,
  RestoreRequest,
  RestoreResult,
  ScanProgress,
  StoragePart,
  UploadAnalysisFile,
  UpdateInfo,
  UploadProgress,
  VfsNode
} from '@shared/types'
import { DriveStore } from './store'
import {
  clearAppCredentials,
  clearSession,
  getProfile,
  listProfiles,
  MAX_PROFILES,
  loadAppCredentials,
  profileDir,
  removeProfile,
  unlistProfile,
  saveAppCredentials,
  touchProfile
} from './profiles'
import { demoAddFile, demoCopyOut, demoDelete, demoPath } from './demo'
import { ensureDir } from './fsutil'
import { BackupManager } from './backup'
import { guessMime, isImageName, isRawExt } from './mime'
import { fileSha256 } from './hash'
import recoveryToolHtml from './recovery-tool.html?raw'
import {
  getMediaBaseUrl,
  setSourceResolver,
  sourceUrl,
  startMediaServer
} from './mediaServer'
import { playWithMpv, resolveMpv } from './mpvPlayer'
import {
  backfillNodeCaptions,
  backfillNodeDates,
  cancelLogin,
  connectTelegram,
  deleteFromSaved,
  disconnect,
  downloadFromSaved,
  downloadParts,
  downloadThumbnail,
  provideAuth,
  pullIndex,
  pushIndex,
  renameInSaved,
  scanSavedMessages,
  startTelegramLogin,
  warmMessage,
  getAccountLimits,
  partSafeBytes,
  recoverUploadParts,
  streamParts,
  streamSavedMedia,
  uploadToSavedWithRetry
} from './telegram'
import type { TelegramClient } from 'telegram'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tgfile',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

let mainWindow: BrowserWindow | null = null

/** Página oficial de donaciones (PayPal). Solo se abre en el navegador externo. */
const DONATION_URL = 'https://www.paypal.com/donate/?hosted_button_id=JRW79EKXDN5MW'
/** Repositorio del proyecto para comprobar actualizaciones. */
const REPO_SLUG = 'Jatniel611/TGPlusDrive'
const RELEASES_URL = `https://github.com/${REPO_SLUG}/releases`
const UPDATE_CACHE_MS = 10 * 60 * 1000
let updateCache: { at: number; info: UpdateInfo } | null = null

function versionParts(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
}

/** true si `candidate` es estrictamente más nueva que `current`. */
function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate)
  const b = versionParts(current)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return false
}
let active: { profile: Profile; store: DriveStore; client?: TelegramClient } | null = null
let indexTimer: NodeJS.Timeout | null = null
let backupManager: BackupManager | null = null

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function driveState(): DriveState | null {
  if (!active) return null
  return { profile: active.profile, db: active.store.db }
}

function emitChanged(): void {
  send('drive:changed', driveState())
}

interface ProgressMeter {
  lastBytes: number
  lastAt: number
  speed: number
}

function makeMeter(): ProgressMeter {
  return { lastBytes: 0, lastAt: Date.now(), speed: 0 }
}

function meterUpdate(meter: ProgressMeter, bytes: number, total: number): { speed: number; eta: number } {
  const now = Date.now()
  const elapsed = (now - meter.lastAt) / 1000
  if (elapsed >= 0.4) {
    const delta = bytes - meter.lastBytes
    if (delta >= 0) {
      const instant = delta / elapsed
      meter.speed = meter.speed > 0 ? meter.speed * 0.6 + instant * 0.4 : instant
    }
    meter.lastBytes = bytes
    meter.lastAt = now
  }
  const remaining = Math.max(0, total - bytes)
  const eta = meter.speed > 0 ? remaining / meter.speed : 0
  return { speed: meter.speed, eta }
}

function sendProgress(progress: UploadProgress): void {
  send('drive:progress', progress)
}

interface MediaFile {
  path: string
  mime: string
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isImageNode(node: VfsNode): boolean {
  return node.mime.startsWith('image/') || isImageName(node.name)
}

function isPreviewable(node: VfsNode): boolean {
  if (node.kind !== 'file') return false
  return isImageNode(node) || node.mime.startsWith('video/') || node.mime === 'application/pdf'
}

function extractEmbeddedJpeg(buffer: Buffer): Buffer | null {
  const maxScan = Math.min(buffer.length - 3, 32 * 1024 * 1024)
  let best: { offset: number; end: number } | null = null
  for (let i = 0; i < maxScan; i += 1) {
    if (buffer[i] !== 0xff || buffer[i + 1] !== 0xd8 || buffer[i + 2] !== 0xff) continue
    const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), i + 3)
    if (end < 0) continue
    const size = end + 2 - i
    if (size < 4096) continue
    if (!best || size > best.end - best.offset) best = { offset: i, end: end + 2 }
  }
  if (!best) return null
  return buffer.subarray(best.offset, best.end)
}

function normalizeImageBuffer(name: string, buffer: Buffer): Buffer | null {
  const ext = extOf(name)
  if (isRawExt(ext) || ext === 'heic' || ext === 'heif' || ext === 'avif' || ext === 'tif' || ext === 'tiff') {
    return extractEmbeddedJpeg(buffer)
  }
  return buffer
}

async function buildThumbnail(id: string): Promise<MediaFile | null> {
  const session = active
  if (!session) return null
  const node = session.store.node(id)
  if (!node || !isPreviewable(node)) return null

  const dir = join(profileDir(session.profile.id), 'thumbs')
  ensureDir(dir)
  const cached = join(dir, `${id}.jpg`)
  if (existsSync(cached)) return { path: cached, mime: 'image/jpeg' }

  const sourcePath =
    node.storage?.provider === 'demo' && node.storage.localName
      ? demoPath(session.profile, node.storage.localName)
      : null

  if (sourcePath && existsSync(sourcePath) && isImageNode(node)) {
    let image = nativeImage.createFromPath(sourcePath)
    if (image.isEmpty()) {
      try {
        const embedded = normalizeImageBuffer(node.name, await readFile(sourcePath))
        if (embedded) image = nativeImage.createFromBuffer(embedded)
      } catch {
        /* ignore */
      }
    }
    if (!image.isEmpty()) {
      const resized = image.resize({ width: 512, quality: 'good' })
      writeFileSync(cached, resized.toJPEG(82))
      return { path: cached, mime: 'image/jpeg' }
    }
  }

  if (node.storage?.provider === 'telegram' && session.client) {
    const thumbMessageId = node.storage.parts?.[0]?.messageId ?? node.storage.messageId
    if (!thumbMessageId) return null
    try {
      const buffer = await downloadThumbnail(session.client, thumbMessageId)
      if (buffer && buffer.length > 0) {
        const thumb = nativeImage.createFromBuffer(buffer)
        if (!thumb.isEmpty()) {
          writeFileSync(cached, thumb.resize({ width: 512, quality: 'good' }).toJPEG(82))
        } else {
          writeFileSync(cached, buffer)
        }
        return { path: cached, mime: 'image/jpeg' }
      }
    } catch {
      /* fall through to embedded extraction */
    }
    if (node.mime.startsWith('video/')) {
      // Telegram no generó thumbnail (típico en MKV): extraer un fotograma con mpv.
      const ok = await extractVideoThumbnail(id, cached)
      if (ok) return { path: cached, mime: 'image/jpeg' }
    }
    if (isImageNode(node)) {
      try {
        const tmp = join(app.getPath('temp'), `tgplusdrive-raw-${id}`)
        await downloadFromSaved(session.client, thumbMessageId, tmp)
        const embedded = normalizeImageBuffer(node.name, await readFile(tmp))
        try {
          rmSync(tmp, { force: true })
        } catch {
          /* ignore */
        }
        if (embedded) {
          const image = nativeImage.createFromBuffer(embedded)
          if (!image.isEmpty()) {
            const resized = image.resize({ width: 512, quality: 'good' })
            writeFileSync(cached, resized.toJPEG(82))
            return { path: cached, mime: 'image/jpeg' }
          }
          writeFileSync(cached, embedded)
          return { path: cached, mime: 'image/jpeg' }
        }
      } catch {
        /* ignore */
      }
    }
  }

  return null
}

const videoThumbJobs = new Map<string, Promise<boolean>>()

/**
 * Extrae un fotograma del video con mpv (--vo=image) y lo guarda como miniatura.
 * Se usa cuando Telegram no tiene thumbnail para ese video (p. ej. MKV).
 */
async function extractVideoThumbnail(id: string, dest: string): Promise<boolean> {
  const inFlight = videoThumbJobs.get(id)
  if (inFlight) return inFlight
  const session = active
  const node = session?.store.node(id)
  const mpv = resolveMpv()
  if (!session?.client || !node || !mpv) return false

  const job = (async () => {
    if (!getMediaBaseUrl()) {
      try {
        await startMediaServer()
      } catch {
        return false
      }
    }

    const url = sourceUrl(id, node.name)
    const outDir = join(app.getPath('temp'), `tgplusdrive-vthumb-${id}`)
    try {
      rmSync(outDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    mkdirSync(outDir, { recursive: true })
    const script = [
      '--no-config',
      '--really-quiet',
      '--no-audio',
      '--vo=image',
      '--vo-image-format=jpg',
      '--vo-image-jpeg-quality=85',
      '--vo-image-outdir=' + outDir,
      '--frames=1',
      '--start=10',
      url
    ]
    // Asíncrono OBLIGATORIO: el servidor HTTP vive en este mismo proceso; con
    // spawnSync mpv no podría leer el video (deadlock).
    const exited = await new Promise<boolean>((resolve) => {
      const child = spawn(mpv, script, { windowsHide: true, stdio: 'ignore' })
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        resolve(false)
      }, 60000)
      child.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    if (!exited) {
      try {
        rmSync(outDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      return false
    }
    // mpv guarda 00000001.jpg (o 00000001.jpg dentro del outdir).
    let produced: string | null = null
    try {
      for (const entry of readdirSync(outDir)) {
        if (/\.jpe?g$/i.test(entry)) {
          produced = join(outDir, entry)
          break
        }
      }
    } catch {
      /* ignore */
    }
    if (!produced || !existsSync(produced) || statSync(produced).size === 0) {
      try {
        rmSync(outDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      return false
    }
    try {
      const image = nativeImage.createFromPath(produced)
      if (!image.isEmpty()) {
        writeFileSync(dest, image.resize({ width: 512, quality: 'good' }).toJPEG(82))
      } else {
        copyFileSync(produced, dest)
      }
    } catch {
      return false
    } finally {
      try {
        rmSync(outDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    return existsSync(dest) && statSync(dest).size > 0
  })().finally(() => videoThumbJobs.delete(id))

  videoThumbJobs.set(id, job)
  return job
}

const thumbJobs = new Map<string, Promise<MediaFile | null>>()
const cancelledDownloads = new Set<string>()
const cancelledUploads = new Set<string>()
const uploadControls = new Map<string, { isCanceled?: boolean }>()
/** Lote al que pertenece cada fila de progreso (para cancelar la cola entera). */
const uploadBatchOf = new Map<string, string>()
const cancelledUploadBatches = new Set<string>()

function cancelUploadBatch(batchId: string): void {
  cancelledUploadBatches.add(batchId)
  for (const [progressId, batch] of uploadBatchOf) {
    if (batch !== batchId) continue
    cancelledUploads.add(progressId)
    const control = uploadControls.get(progressId)
    if (control) control.isCanceled = true
  }
}

function getThumbnailFile(id: string): Promise<MediaFile | null> {
  const inFlight = thumbJobs.get(id)
  if (inFlight) return inFlight
  const job = buildThumbnail(id).finally(() => thumbJobs.delete(id))
  thumbJobs.set(id, job)
  return job
}

async function getFullImage(id: string): Promise<MediaFile | null> {
  const session = active
  if (!session) return null
  const node = session.store.node(id)
  if (!node || (!isImageNode(node) && !node.mime.startsWith('video/'))) return null

  const ext = extOf(node.name)

  if (node.storage?.provider === 'demo' && node.storage.localName) {
    const source = demoPath(session.profile, node.storage.localName)
    if (!existsSync(source)) return null
    if (isRawExt(ext) || ['heic', 'heif', 'avif', 'tif', 'tiff'].includes(ext)) {
      const dir = join(profileDir(session.profile.id), 'preview')
      ensureDir(dir)
      const cached = join(dir, `${id}.jpg`)
      if (existsSync(cached)) return { path: cached, mime: 'image/jpeg' }
      try {
        const embedded = extractEmbeddedJpeg(await readFile(source))
        if (embedded) {
          writeFileSync(cached, embedded)
          return { path: cached, mime: 'image/jpeg' }
        }
      } catch {
        /* ignore */
      }
    }
    return { path: source, mime: node.mime || guessMime(node.name) }
  }

  if (node.storage?.provider === 'telegram' && node.storage.messageId && session.client) {
    const dir = join(profileDir(session.profile.id), 'preview')
    ensureDir(dir)
    const raw = isRawExt(ext) || ['heic', 'heif', 'avif', 'tif', 'tiff'].includes(ext)
    const dest = raw
      ? join(dir, `${id}.jpg`)
      : join(dir, `${id}${extname(node.name) || extensionFromMime(node.mime)}`)
    if (existsSync(dest)) {
      return { path: dest, mime: raw ? 'image/jpeg' : node.mime || guessMime(node.name) }
    }
    try {
      if (raw) {
        const tmp = join(dir, `${id}.src`)
        await downloadFromSaved(session.client, node.storage.messageId, tmp)
        const embedded = extractEmbeddedJpeg(await readFile(tmp))
        try {
          rmSync(tmp, { force: true })
        } catch {
          /* ignore */
        }
        if (!embedded) return null
        writeFileSync(dest, embedded)
        return { path: dest, mime: 'image/jpeg' }
      }
      await downloadFromSaved(session.client, node.storage.messageId, dest)
      return { path: dest, mime: node.mime || guessMime(node.name) }
    } catch {
      return null
    }
  }

  return null
}

function extensionFromMime(mime: string): string {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/gif') return '.gif'
  return '.jpg'
}

function registerMediaProtocol(): void {
  protocol.handle('tgfile', async (request) => {
    try {
      const url = new URL(request.url)
      const kind = url.hostname
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!id) {
        return new Response('Not found', { status: 404 })
      }
      if (kind === 'full') {
        const session = active
        const node = session?.store.node(id)
        if (
          session?.client &&
          node &&
          node.kind === 'file' &&
          node.storage?.provider === 'telegram' &&
          (node.storage.messageId || node.storage.parts?.length) &&
          node.size > 0 &&
          (node.mime.startsWith('video/') || node.mime.startsWith('audio/'))
        ) {
          const fileSize = node.size
          const range = request.headers.get('range')
          let start = 0
          let end = fileSize - 1
          let status = 200
          if (range) {
            const match = /bytes=(\d*)-(\d*)/.exec(range)
            if (match) {
              const hasStart = match[1] !== ''
              const hasEnd = match[2] !== ''
              if (!hasStart && hasEnd) {
                const suffix = parseInt(match[2], 10)
                if (Number.isFinite(suffix) && suffix > 0) {
                  start = Math.max(0, fileSize - suffix)
                  end = fileSize - 1
                }
              } else {
                if (hasStart) start = parseInt(match[1], 10)
                end = hasEnd ? parseInt(match[2], 10) : fileSize - 1
              }
              if (!Number.isFinite(start) || start < 0) start = 0
              if (!Number.isFinite(end) || end >= fileSize) end = fileSize - 1
              if (start > end) {
                return new Response('Range Not Satisfiable', {
                  status: 416,
                  headers: { 'content-range': `bytes */${fileSize}` }
                })
              }
              status = 206
            }
          }
          const parts = node.storage.parts?.filter((part) => part.size > 0)
          const nodeStream =
            parts && parts.length > 1
              ? Readable.from(streamParts(session.client, parts, start, end))
              : Readable.from(
                  streamSavedMedia(session.client, node.storage.messageId as number, start, end)
                )
          const webStream = Readable.toWeb(nodeStream) as ReadableStream
          const headers: Record<string, string> = {
            'content-type': node.mime || guessMime(node.name),
            'accept-ranges': 'bytes',
            'content-length': String(end - start + 1),
            'cache-control': 'no-store'
          }
          if (status === 206) {
            headers['content-range'] = `bytes ${start}-${end}/${fileSize}`
          }
          return new Response(webStream, { status, headers })
        }
      }
      const file = kind === 'thumb' ? await getThumbnailFile(id) : await getFullImage(id)
      if (!file) return new Response('Not found', { status: 404 })
      return serveFileWithRange(request, file.path, file.mime)
    } catch {
      return new Response('Error', { status: 500 })
    }
  })
}

async function serveFileWithRange(
  request: Request,
  filePath: string,
  mime: string
): Promise<Response> {
  const stats = await stat(filePath)
  const fileSize = stats.size
  const range = request.headers.get('range')
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    if (!Number.isFinite(start) || start < 0 || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'content-range': `bytes */${fileSize}` }
      })
    }
    const safeEnd = Math.min(end, fileSize - 1)
    const chunkSize = safeEnd - start + 1
    const stream = createReadStream(filePath, { start, end: safeEnd })
    const webStream = Readable.toWeb(stream) as ReadableStream
    return new Response(webStream, {
      status: 206,
      headers: {
        'content-type': mime,
        'content-range': `bytes ${start}-${safeEnd}/${fileSize}`,
        'accept-ranges': 'bytes',
        'content-length': String(chunkSize),
        'cache-control': 'public, max-age=86400'
      }
    })
  }
  const stream = createReadStream(filePath)
  const webStream = Readable.toWeb(stream) as ReadableStream
  return new Response(webStream, {
    headers: {
      'content-type': mime,
      'accept-ranges': 'bytes',
      'content-length': String(fileSize),
      'cache-control': 'public, max-age=86400'
    }
  })
}

function scheduleIndexSync(): void {
  if (!active?.client) return
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = setTimeout(() => {
    const target = active
    if (!target?.client) return
    pushIndex(target.client, target.store).catch((err) => {
      console.error('[TGPlusDrive] No se pudo sincronizar el índice:', err)
    })
  }, 4000)
}

function requireActive(): { profile: Profile; store: DriveStore; client?: TelegramClient } {
  if (!active) throw new Error('No hay un perfil activo')
  return active
}

function backupRootIdOf(store: DriveStore): string | null {
  const metaRoot = store.db.backup?.rootFolderId
  if (metaRoot) {
    const node = store.node(metaRoot)
    if (node && node.kind === 'folder' && !node.trashed) return metaRoot
  }
  const marked = store.db.nodes.find(
    (node) => node.kind === 'folder' && node.backup && !node.trashed
  )
  return marked?.id ?? null
}

function isBackupRoot(store: DriveStore, id: string): boolean {
  const node = store.node(id)
  if (node?.kind !== 'folder') return false
  return Boolean(node.backup) || backupRootIdOf(store) === id
}

function backupAncestorOf(store: DriveStore, id: string): VfsNode | undefined {
  const guard = new Set<string>()
  let node = store.node(id)
  while (node && !guard.has(node.id)) {
    guard.add(node.id)
    if (node.kind === 'folder' && node.backup) return node
    node = node.parentId ? store.node(node.parentId) : undefined
  }
  return undefined
}

function backupEnabled(): boolean {
  if (backupManager?.info().enabled) return true
  return Boolean(active?.store.db.backup?.enabled)
}

function folderPathOf(store: DriveStore, node: VfsNode): string {
  const parts: string[] = []
  const guard = new Set<string>()
  let current = node.parentId ? store.node(node.parentId) : undefined
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? store.node(current.parentId) : undefined
  }
  return parts.length > 0 ? parts.join(' / ') : 'Mi unidad'
}

function findDuplicates(
  store: DriveStore,
  sha256: string | undefined,
  size: number,
  exclude?: Set<string>
): VfsNode[] {
  if (!sha256) return []
  return store.db.nodes.filter(
    (node) =>
      node.kind === 'file' &&
      !node.trashed &&
      node.size === size &&
      node.storage?.sha256 === sha256 &&
      !exclude?.has(node.id)
  )
}

function toDuplicateMatches(store: DriveStore, nodes: VfsNode[]): DuplicateMatch[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    path: folderPathOf(store, node),
    createdAt: node.createdAt
  }))
}

/** Borra los mensajes de Telegram (o el archivo demo) de los nodos indicados. */
async function deleteNodeStorage(
  session: { profile: Profile; store: DriveStore; client?: TelegramClient },
  nodes: VfsNode[]
): Promise<void> {
  for (const node of nodes) {
    if (node.kind !== 'file' || !node.storage) continue
    if (node.storage.provider === 'demo' && node.storage.localName) {
      demoDelete(session.profile, node.storage.localName)
    } else if (node.storage.provider === 'telegram' && session.client) {
      const messageIds = node.storage.parts?.length
        ? node.storage.parts.map((part) => part.messageId)
        : node.storage.messageId
          ? [node.storage.messageId]
          : []
      for (const messageId of messageIds) {
        await deleteFromSaved(session.client, messageId)
      }
      const toolId = node.storage.toolMessageId ?? loadUploadManifest(node.id).toolMessageId
      if (toolId) await deleteFromSaved(session.client, toolId)
    }
    removeUploadManifest(node.id)
  }
}

function emptyBackupInfo(): BackupInfo {
  return {
    enabled: false,
    sourceDir: '',
    folderName: '',
    rootFolderId: null,
    running: false,
    paused: false,
    uploading: false,
    sourceValid: true,
    files: 0,
    skipped: 0
  }
}

function stopBackup(): void {
  backupManager?.dispose()
  backupManager = null
}

/** El manifiesto vive FUERA de la carpeta del perfil para sobrevivir a quitarlo. */
function backupManifestPath(profileId: string): string {
  return join(app.getPath('userData'), 'backups', `${profileId}.json`)
}

function startBackupForActive(): void {
  stopBackup()
  const session = active
  if (!session) return
  const file = backupManifestPath(session.profile.id)
  const legacy = join(profileDir(session.profile.id), 'backup.json')
  // Migración: antes vivía dentro del perfil y se perdía al quitarlo.
  if (!existsSync(file) && existsSync(legacy)) {
    try {
      ensureDir(dirname(file))
      copyFileSync(legacy, file)
    } catch {
      /* si falla, se reconfigura */
    }
  }
  if (existsSync(file) && existsSync(legacy)) {
    try {
      rmSync(legacy, { force: true })
    } catch {
      /* ignore */
    }
  }
  backupManager = new BackupManager(
    {
      store: session.store,
      uploadFile: async (parentId, filePath, sha256, onProgress, shouldCancel) => {
        if (active !== session) throw new Error('El perfil activo cambió durante el respaldo')
        let created: string | null = null
        let failure: string | undefined
        await uploadPaths(parentId, [filePath], undefined, {
          actions: { [filePath]: 'copy' },
          hashes: { [filePath]: sha256 },
          silent: true,
          silentProgress: true,
          onProgress,
          shouldCancel,
          onError: (message) => {
            failure = message
          },
          onUploaded: (info) => {
            if (info.path === filePath) created = info.nodeId
          }
        })
        if (failure) throw new Error(failure)
        return created
      },
      deleteNodes: async (ids) => {
        if (active !== session) return
        const nodes = ids
          .map((id) => session.store.node(id))
          .filter((node): node is VfsNode => Boolean(node))
        await deleteNodeStorage(session, nodes)
        session.store.deleteForever(ids)
        emitChanged()
        scheduleIndexSync()
      },
      refresh: () => {
        if (active !== session) return
        emitChanged()
        scheduleIndexSync()
      },
      emit: (info) => {
        if (active !== session) return
        send('backup:state', info)
      },
      progress: (info) => {
        if (active !== session) return
        const detailed: UploadProgress = {
          id: `backup:${session.profile.id}`,
          name: info.name || 'Respaldo automático',
          progress: info.progress,
          status: info.status,
          kind: 'upload',
          detail: info.detail,
          index: info.index,
          total: info.total,
          speed: info.speed,
          eta: info.eta,
          error: info.error
        }
        sendProgress(detailed)
      }
    },
    file
  )
  backupManager.start()
}

const CACHE_MAX_AGE_DAYS = 30

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      try {
        total += entry.isDirectory() ? dirSize(full) : statSync(full).size
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return total
}

/** Firma de archivo: borra los de thumbs/preview que superen la antigüedad. */
function pruneCacheDir(dir: string, maxAgeDays: number): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let removed = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      try {
        const info = statSync(full)
        if (entry.isDirectory()) {
          removed += pruneCacheDir(full, maxAgeDays)
          try {
            if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true })
          } catch {
            /* ignore */
          }
        } else if (info.mtimeMs < cutoff) {
          rmSync(full, { force: true })
          removed += 1
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return removed
}

function cacheStats(profile: Profile): { thumbs: number; preview: number; stream: number; playable: number } {
  const base = profileDir(profile.id)
  return {
    thumbs: dirSize(join(base, 'thumbs')),
    preview: dirSize(join(base, 'preview')),
    stream: dirSize(join(base, 'stream-cache')),
    playable: dirSize(join(base, 'playable'))
  }
}

function clearProfileCache(profile: Profile): number {
  const base = profileDir(profile.id)
  let freed = 0
  for (const name of ['thumbs', 'preview', 'stream-cache', 'playable', 'media-src']) {
    const dir = join(base, name)
    freed += dirSize(dir)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  return freed
}

async function activateProfile(id: string): Promise<DriveState> {
  const profile = getProfile(id)
  if (!profile) throw new Error('Perfil no encontrado')
  stopBackup()
  if (active) {
    if (indexTimer) clearTimeout(indexTimer)
    await disconnect(active.client ?? null)
  }

  const store = new DriveStore(profile)
  store.fixImageMimes(guessMime)
  // Poda de caché en segundo plano (no bloquea el arranque).
  setTimeout(() => {
    pruneCacheDir(join(profileDir(profile.id), 'thumbs'), CACHE_MAX_AGE_DAYS)
    pruneCacheDir(join(profileDir(profile.id), 'preview'), CACHE_MAX_AGE_DAYS)
  }, 4000)

  if (profile.provider === 'demo') {
    active = { profile, store }
    touchProfile(profile.id)
    emitChanged()
    startBackupForActive()
    return { profile, db: store.db }
  }

  const client = await connectTelegram(profile)
  active = { profile, store, client }
  touchProfile(profile.id)
  if (profile.apiId && profile.apiHash) {
    saveAppCredentials({ apiId: profile.apiId, apiHash: profile.apiHash })
  }
  emitChanged()

  pullIndex(client, store)
    .then(async (changed) => {
      if (changed) {
        emitChanged()
      } else if (store.db.nodes.length > 0) {
        await pushIndex(client, store)
      }
    })
    .catch((err) => console.error('[TGPlusDrive] Error restaurando índice:', err))
    .finally(() => {
      if (active?.profile.id === profile.id) startBackupForActive()

      backfillNodeDates(client, store)
        .then((changed) => {
          if (changed > 0) {
            emitChanged()
            scheduleIndexSync()
          }
        })
        .catch((err) => console.error('[TGPlusDrive] Error actualizando fechas:', err))

      // Descripciones de Telegram para buscar por el título editado aunque el
      // nombre del archivo sea un hash. Va DESPUÉS de pullIndex: si corriera en
      // paralelo, la restauración del índice reemplazaría los nodos y se
      // perderían los captions recién guardados.
      backfillNodeCaptions(client, store)
        .then((changed) => {
          if (changed > 0) {
            emitChanged()
            scheduleIndexSync()
          }
        })
        .catch((err) => console.error('[TGPlusDrive] Error actualizando descripciones:', err))
    })

  return { profile, db: store.db }
}

interface UploadEntry {
  path: string
  parentId: string | null
}

/** Expande carpetas recursivamente y crea la estructura de carpetas en la VFS. */
function expandUploadPaths(
  store: DriveStore,
  parentId: string | null,
  inputPaths: string[]
): UploadEntry[] {
  const entries: UploadEntry[] = []
  const walk = (dir: string, targetParent: string | null): void => {
    let children: string[] = []
    try {
      children = readdirSync(dir)
    } catch {
      return
    }
    for (const child of children) {
      const full = join(dir, child)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        let folderId = targetParent
        try {
          const folder = store.createFolder(targetParent, child)
          folderId = folder.id
        } catch {
          folderId = targetParent
        }
        walk(full, folderId)
      } else {
        entries.push({ path: full, parentId: targetParent })
      }
    }
  }

  for (const item of inputPaths) {
    let isDir = false
    try {
      isDir = statSync(item).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      const folder = basename(item)
      let folderId = parentId
      try {
        folderId = store.createFolder(parentId, folder).id
      } catch {
        folderId = parentId
      }
      walk(item, folderId)
    } else {
      entries.push({ path: item, parentId })
    }
  }
  return entries
}

interface UploadOptions {
  actions?: Record<string, DuplicateAction>
  hashes?: Record<string, string>
  onUploaded?: (info: { path: string; nodeId: string }) => void
  onProgress?: (progress: number, speed?: number, eta?: number) => void
  onError?: (message: string) => void
  /** El respaldo lo usa para abortar el archivo en curso al cancelar. */
  shouldCancel?: () => boolean
  /** No emite drive:changed/index por cada archivo (lo usa el respaldo). */
  silent?: boolean
  /** No emite una fila drive:progress por archivo (el respaldo agrega). */
  silentProgress?: boolean
}

async function uploadPaths(
  parentId: string | null,
  paths: string[],
  resumeNodeId?: string,
  options: UploadOptions = {}
): Promise<DriveState | null> {
  const session = requireActive()
  let resume = resumeNodeId
  const entries = expandUploadPaths(session.store, parentId, paths)
  // Identificador del lote: todas las filas de esta subida comparten batchId
  // para que "Detener" cancele la cola completa de una vez.
  const batchId = options.silentProgress ? undefined : randomUUID()
  const showQueue = !options.silentProgress
  const progressIds: string[] = []

  if (showQueue && entries.length > 1) {
    // Mostrar la cola completa desde el inicio: el usuario ve cuántos archivos
    // faltan, aunque la subida sea secuencial.
    entries.forEach((entry, index) => {
      const queueId = `queue:${batchId}:${index}`
      progressIds.push(queueId)
      if (batchId) uploadBatchOf.set(queueId, batchId)
      sendProgress({
        id: queueId,
        name: basename(entry.path),
        progress: 0,
        status: 'queued',
        kind: 'upload',
        index: index + 1,
        total: entries.length,
        ...(batchId ? { batchId } : {})
      })
    })
  }

  const concurrency = Math.max(
    1,
    Math.min(
      Number(process.env['TGPLUSDRIVE_UPLOAD_CONCURRENCY']) || 2,
      Math.max(1, entries.length)
    )
  )
  let cursor = 0

  const uploadOne = async (position: number): Promise<void> => {
    const entry = entries[position]
    const filePath = entry.path
    const targetParentId = entry.parentId
    const name = basename(filePath)
    const progressId = progressIds[position] ?? randomUUID()
    let nodeIdForCleanup: string | null = null
    const emit = (payload: UploadProgress): void => {
      if (options.silentProgress) return
      sendProgress({
        ...payload,
        ...(payload.index === undefined && entries.length > 1 ? { index: position + 1 } : {}),
        ...(payload.total === undefined && entries.length > 1 ? { total: entries.length } : {}),
        ...(batchId ? { batchId } : {})
      })
    }
    if (!options.silentProgress) {
      emit({ id: progressId, name, progress: 0, status: 'uploading', kind: 'upload' })
    }
    try {
      if (
        cancelledUploads.has(progressId) ||
        (batchId ? cancelledUploadBatches.has(batchId) : false)
      ) {
        cancelledUploads.delete(progressId)
        if (!options.silentProgress) {
          emit({
            id: progressId,
            name,
            progress: 0,
            status: 'error',
            kind: 'upload',
            error: 'Cancelado'
          })
        }
        return
      }
      const size = statSync(filePath).size
      const mime = guessMime(name)
      if (session.profile.provider === 'demo') {
        const { localName } = demoAddFile(session.profile, filePath)
        const added = session.store.addFile(targetParentId, {
          name,
          size,
          mime,
          storage: { provider: 'demo', localName }
        })
        options.onUploaded?.({ path: filePath, nodeId: added.id })
      } else {
        if (!session.client) throw new Error('Cliente de Telegram no conectado')
        const nodeId = resume ?? randomUUID()
        let sha256: string | undefined = options.hashes?.[filePath]
        if (!sha256) {
          try {
            sha256 = await fileSha256(filePath)
          } catch {
            sha256 = undefined
          }
        }
        const action = options.actions?.[filePath] ?? 'copy'
        const duplicates =
          action === 'replace'
            ? findDuplicates(session.store, sha256, size, new Set([nodeId]))
            : []
        nodeIdForCleanup = nodeId
        resume = undefined
        const limits = await getAccountLimits(session.client)
        const override = Number(process.env['TGPLUSDRIVE_PART_BYTES'])
        const hasOverride = Number.isFinite(override) && override > 0
        const partSize = hasOverride
          ? Math.max(1024, override)
          : partSafeBytes(limits.maxBytes)
        const split = size > (hasOverride ? override : limits.maxBytes)

        const uploadMeter = makeMeter()
        const progressFn = ((progress: number) => {
          if (
            cancelledUploads.has(progressId) ||
            (batchId ? cancelledUploadBatches.has(batchId) : false) ||
            options.shouldCancel?.()
          ) {
            progressFn.isCanceled = true
            return
          }
          const bytes = progress * size
          const meter = meterUpdate(uploadMeter, bytes, size)
          if (options.onProgress) options.onProgress(progress, meter.speed, meter.eta)
          if (!options.silentProgress) {
            emit({
              id: progressId,
              name,
              progress,
              status: 'uploading',
              kind: 'upload',
              size,
              speed: meter.speed,
              eta: meter.eta
            })
          }
        }) as ((progress: number) => void) & { isCanceled?: boolean }
        uploadControls.set(progressId, progressFn)
        activeUploads.set(nodeId, progressId)

        if (!split) {
          const message = await uploadToSavedWithRetry(
            session.client,
            filePath,
            `TGPLUSDRIVE|${nodeId}|${name}`,
            progressFn,
            () =>
              cancelledUploads.has(progressId) ||
              (batchId ? cancelledUploadBatches.has(batchId) : false) ||
              Boolean(options.shouldCancel?.())
          )
          uploadControls.delete(progressId)
          activeUploads.delete(nodeId)
          if (duplicates.length > 0) {
            try {
              await deleteNodeStorage(session, duplicates)
              session.store.deleteForever(duplicates.map((node) => node.id))
            } catch (dupErr) {
              console.error('[TGPlusDrive] No se pudieron borrar los duplicados:', dupErr)
            }
          }
          session.store.upsertFile(targetParentId, {
            id: nodeId,
            name,
            size,
            mime,
            storage: {
              provider: 'telegram',
              messageId: message.id,
              fileId: message.document?.id?.toString(),
              sha256
            }
          })
          options.onUploaded?.({ path: filePath, nodeId })
        } else {
          const dir = join(app.getPath('temp'), 'tgplusdrive-parts')
          mkdirSync(dir, { recursive: true })
          const existingManifest = loadUploadManifest(nodeId)
          const manifest = existingManifest
          const totalParts = Math.ceil(size / partSize)
          manifest.name = name
          manifest.size = size
          manifest.partSize = partSize
          manifest.totalParts = totalParts
          manifest.source = filePath
          manifest.createdAt = manifest.createdAt || Date.now()

          const recovered = await recoverUploadParts(session.client, nodeId)
          for (const part of recovered) {
            if (!manifest.parts.some((existing) => existing.offset === part.offset)) {
              manifest.parts.push(part)
            }
          }
          saveUploadManifest(manifest)

          const control: { isCanceled?: boolean } = {}
          uploadControls.set(progressId, control)
          const isCancelled = (): boolean =>
            Boolean(control.isCanceled) ||
            cancelledUploads.has(progressId) ||
            (batchId ? cancelledUploadBatches.has(batchId) : false) ||
            Boolean(options.shouldCancel?.())

          let completedBytes = manifest.parts.reduce((sum, part) => sum + part.size, 0)
          let nextIndex = manifest.parts.reduce((max, part) => Math.max(max, part.index), -1) + 1

          // Planificar los huecos pendientes (soporta reanudación).
          const planned: Array<{ offset: number; length: number; index: number }> = []
          {
            const simulated = manifest.parts.map((part) => ({
              offset: part.offset,
              size: part.size
            }))
            for (;;) {
              let cursor = 0
              for (const part of [...simulated].sort((a, b) => a.offset - b.offset)) {
                if (part.offset > cursor) break
                const end = part.offset + part.size
                if (end > cursor) cursor = end
              }
              const offset = Math.min(cursor, size)
              if (offset >= size) break
              const nextCovered = simulated
                .filter((part) => part.offset > offset)
                .sort((a, b) => a.offset - b.offset)[0]?.offset
              const limit = Math.min(size, nextCovered ?? size)
              const length = Math.min(partSize, limit - offset)
              planned.push({ offset, length, index: nextIndex })
              simulated.push({ offset, size: length })
              nextIndex += 1
            }
          }

          // Subir varias partes a la vez acelera los archivos grandes. Cada parte
          // ya usa 16 conexiones internas, así que 2 en paralelo es el equilibrio.
          const partConcurrency = Math.max(
            1,
            Math.min(
              Number(process.env['TGPLUSDRIVE_PART_CONCURRENCY']) || 2,
              Math.max(1, planned.length)
            )
          )
          const bytesByPart = new Map<number, number>()
          const reportProgress = (): void => {
            if (isCancelled()) return
            let done = completedBytes
            for (const task of planned) done += bytesByPart.get(task.index) ?? 0
            progressFn(Math.min(1, done / size))
          }

          const uploadPart = async (task: {
            offset: number
            length: number
            index: number
          }): Promise<void> => {
            if (isCancelled()) throw new Error('Cancelado')
            // Carpeta por parte: así una parte puede borrar la suya sin afectar
            // a otra que se esté subiendo en paralelo.
            const partDir = join(dir, nodeId, `p${task.index}`)
            mkdirSync(partDir, { recursive: true })
            const chunkPath = join(partDir, partFileName(name, task.offset))
            await writePart(filePath, chunkPath, task.offset, task.length)
            const caption = `TGPLUSDRIVE|${nodeId}|${name}|PART|${task.index}|${totalParts}|${task.offset}|${task.length}`
            const partProgress = ((progress: number) => {
              if (isCancelled()) {
                partProgress.isCanceled = true
                return
              }
              bytesByPart.set(task.index, progress * task.length)
              reportProgress()
            }) as ((progress: number) => void) & { isCanceled?: boolean }
            const message = await uploadToSavedWithRetry(
              session.client!,
              chunkPath,
              caption,
              partProgress,
              isCancelled
            )
            if (isCancelled()) throw new Error('Cancelado')
            try {
              rmSync(chunkPath, { force: true })
              rmSync(partDir, { recursive: true, force: true })
            } catch {
              /* ignore */
            }
            bytesByPart.delete(task.index)
            completedBytes += task.length
            manifest.parts.push({
              messageId: message.id,
              fileId: message.document?.id?.toString(),
              size: task.length,
              offset: task.offset,
              index: task.index
            })
            manifest.parts.sort((a, b) => a.offset - b.offset)
            saveUploadManifest(manifest)
            reportProgress()
          }

          let partCursor = 0
          const partWorker = async (): Promise<void> => {
            while (partCursor < planned.length) {
              if (isCancelled()) throw new Error('Cancelado')
              const task = planned[partCursor]
              partCursor += 1
              await uploadPart(task)
            }
          }
          try {
            await Promise.all(Array.from({ length: partConcurrency }, partWorker))

            if (!manifest.toolMessageId) {
              try {
                const toolPath = writeRecoveryTool()
                const toolMessage = await uploadToSavedWithRetry(
                  session.client,
                  toolPath,
                  `TGPLUSDRIVE-TOOL|${nodeId}`,
                  undefined,
                  isCancelled
                )
                manifest.toolMessageId = toolMessage.id
                saveUploadManifest(manifest)
              } catch {
                /* la herramienta es opcional */
              }
            }
          } catch (err) {
            try {
              const partialParts = manifest.parts
              if (partialParts.length > 0) {
                session.store.upsertFile(targetParentId, {
                  id: nodeId,
                  name,
                  size,
                  mime,
                  storage: {
                    provider: 'telegram',
                    messageId: partialParts[0]?.messageId,
                    fileId: partialParts[0]?.fileId,
                    parts: partialParts.map(({ index: _index, ...part }) => part),
                    partsComplete: false
                  }
                })
                if (!options.silent) {
                  emitChanged()
                  scheduleIndexSync()
                }
              }
            } catch {
              /* ignore */
            }
            throw err
          } finally {
            uploadControls.delete(progressId)
            activeUploads.delete(nodeId)
          }

          const orderedParts: StoragePart[] = manifest.parts
            .sort((a, b) => a.index - b.index)
            .map(({ index: _index, ...part }) => part)
          if (duplicates.length > 0) {
            try {
              await deleteNodeStorage(session, duplicates)
              session.store.deleteForever(duplicates.map((node) => node.id))
            } catch (dupErr) {
              console.error('[TGPlusDrive] No se pudieron borrar los duplicados:', dupErr)
            }
          }
          session.store.upsertFile(targetParentId, {
            id: nodeId,
            name,
            size,
            mime,
            storage: {
              provider: 'telegram',
              messageId: orderedParts[0]?.messageId,
              fileId: orderedParts[0]?.fileId,
              parts: orderedParts,
              partsComplete: true,
              toolMessageId: manifest.toolMessageId,
              sha256
            }
          })
          removeUploadManifest(nodeId)
          options.onUploaded?.({ path: filePath, nodeId })
        }
      }
      if (!options.silentProgress) {
        emit({ id: progressId, name, progress: 1, status: 'done', kind: 'upload' })
      }
    } catch (err) {
      uploadControls.delete(progressId)
      if (nodeIdForCleanup) activeUploads.delete(nodeIdForCleanup)
      const raw = err instanceof Error ? err.message : String(err)
      console.error('[TGPlusDrive] Error de subida:', raw, err)
      const cancelled = raw === 'Cancelado' || raw.includes('USER_CANCELED')
      if (cancelled) cancelledUploads.delete(progressId)
      options.onError?.(cancelled ? 'Cancelado' : raw)
      if (!options.silentProgress) {
        emit({
          id: progressId,
          name,
          progress: 0,
          status: 'error',
          kind: 'upload',
          error: cancelled ? 'Cancelado' : raw
        })
      }
    }
  }

  // Subida con concurrencia limitada: en lotes grandes (o carpetas) se aceleran
  // los tiempos sin saturar la conexión de Telegram.
  const worker = async (): Promise<void> => {
    while (cursor < entries.length) {
      const index = cursor
      cursor += 1
      if (batchId && cancelledUploadBatches.has(batchId)) continue
      await uploadOne(index)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  if (batchId) {
    for (const id of progressIds) uploadBatchOf.delete(id)
    cancelledUploadBatches.delete(batchId)
  }
  if (!options.silent) {
    emitChanged()
    scheduleIndexSync()
  }
  return driveState()
}

interface UploadManifestPart {
  messageId: number
  fileId?: string
  size: number
  offset: number
  index: number
}

interface UploadManifest {
  nodeId: string
  name: string
  size: number
  partSize: number
  totalParts: number
  source: string
  createdAt: number
  parts: UploadManifestPart[]
  toolMessageId?: number
}

function uploadManifestDir(): string {
  const dir = join(app.getPath('userData'), 'uploads')
  ensureDir(dir)
  return dir
}

function uploadManifestPath(nodeId: string): string {
  return join(uploadManifestDir(), `${nodeId}.json`)
}

function loadUploadManifest(nodeId: string): UploadManifest {
  try {
    const file = uploadManifestPath(nodeId)
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as UploadManifest
      if (parsed && Array.isArray(parsed.parts)) return parsed
    }
  } catch {
    /* ignore */
  }
  return {
    nodeId,
    name: '',
    size: 0,
    partSize: 0,
    totalParts: 0,
    source: '',
    createdAt: Date.now(),
    parts: []
  }
}

function saveUploadManifest(manifest: UploadManifest): void {
  try {
    writeFileSync(uploadManifestPath(manifest.nodeId), JSON.stringify(manifest), 'utf8')
  } catch {
    /* ignore */
  }
}

interface PendingUpload {
  nodeId: string
  name: string
  size: number
  uploadedBytes: number
  uploadedParts: number
  totalParts: number
  source: string
  resumable: boolean
}

function pendingUploads(): PendingUpload[] {
  const dir = uploadManifestDir()
  const result: PendingUpload[] = []
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue
      try {
        const manifest = JSON.parse(readFileSync(join(dir, entry), 'utf8')) as UploadManifest
        if (!manifest?.nodeId || !Array.isArray(manifest.parts)) continue
        if (!manifest.totalParts || manifest.parts.length >= manifest.totalParts) continue
        if (!manifest.source || !existsSync(manifest.source)) continue
        if (activeUploads.has(manifest.nodeId)) continue
        result.push({
          nodeId: manifest.nodeId,
          name: manifest.name,
          size: manifest.size,
          uploadedBytes: manifest.parts.reduce((sum, part) => sum + part.size, 0),
          uploadedParts: manifest.parts.length,
          totalParts: manifest.totalParts,
          source: manifest.source,
          resumable: true
        })
      } catch {
        /* ignore malformed manifest */
      }
    }
  } catch {
    /* ignore */
  }
  return result
}

function removeUploadManifest(nodeId: string): void {
  try {
    rmSync(uploadManifestPath(nodeId), { force: true })
  } catch {
    /* ignore */
  }
}

const activeUploads = new Map<string, string>()

async function discardPendingUpload(nodeId: string): Promise<void> {
  const progressId = activeUploads.get(nodeId)
  if (progressId) {
    cancelledUploads.add(progressId)
    const control = uploadControls.get(progressId)
    if (control) control.isCanceled = true
    for (let i = 0; i < 30 && activeUploads.has(nodeId); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    activeUploads.delete(nodeId)
  }

  const manifest = loadUploadManifest(nodeId)
  const session = active
  const messageIds = new Set<number>()
  for (const part of manifest.parts) messageIds.add(part.messageId)
  const node = session?.store.node(nodeId)
  for (const part of node?.storage?.parts ?? []) messageIds.add(part.messageId)

  if (session?.client) {
    for (const messageId of messageIds) {
      await deleteFromSaved(session.client, messageId)
    }
  }

  if (node) {
    session?.store.deleteForever([nodeId])
    emitChanged()
    scheduleIndexSync()
  }

  removeUploadManifest(nodeId)
  for (const entry of readdirSync(uploadManifestDir())) {
    if (entry.startsWith(`${nodeId}.part`)) {
      try {
        rmSync(join(uploadManifestDir(), entry), { force: true })
      } catch {
        /* ignore */
      }
    }
  }
  const partsDir = join(app.getPath('temp'), 'tgplusdrive-parts')
  if (existsSync(partsDir)) {
    for (const entry of readdirSync(partsDir)) {
      if (entry.startsWith(`${nodeId}.part`)) {
        try {
          rmSync(join(partsDir, entry), { force: true })
        } catch {
          /* ignore */
        }
      }
    }
  }
}

const PART_OFFSET_DIGITS = 12

function partFileName(originalName: string, offset: number): string {
  const padded = String(Math.max(0, offset)).padStart(PART_OFFSET_DIGITS, '0')
  return `${originalName}.part-${padded}`
}

function recoveryToolPath(): string {
  return join(app.getPath('userData'), 'Recuperar TGPlusDrive.html')
}

function writeRecoveryTool(): string {
  const dest = recoveryToolPath()
  try {
    writeFileSync(dest, recoveryToolHtml, 'utf8')
  } catch {
    /* ignore */
  }
  return dest
}

async function writePart(
  source: string,
  dest: string,
  offset: number,
  length: number
): Promise<void> {
  const { open, stat } = await import('node:fs/promises')
  const handle = await open(source, 'r')
  const out = await open(dest, 'w')
  try {
    const buffer = Buffer.alloc(8 * 1024 * 1024)
    let position = offset
    let remaining = length
    while (remaining > 0) {
      const toRead = Math.min(buffer.length, remaining)
      const { bytesRead } = await handle.read(buffer, 0, toRead, position)
      if (bytesRead <= 0) break
      await out.write(buffer.subarray(0, bytesRead))
      position += bytesRead
      remaining -= bytesRead
    }
    await stat(dest)
  } finally {
    await handle.close()
    await out.close()
  }
}

function uniqueDest(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return join(dir, name)
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let i = 1
  while (existsSync(join(dir, `${stem} (${i})${ext}`))) i += 1
  return join(dir, `${stem} (${i})${ext}`)
}

async function downloadNodeToPath(
  session: ReturnType<typeof requireActive>,
  node: VfsNode,
  dest: string,
  onProgress?: (progress: number) => void,
  isCancelled?: () => boolean
): Promise<void> {
  const report = (progress: number): void => {
    if (isCancelled?.()) throw new Error('Cancelado')
    onProgress?.(progress)
  }

  if (node.storage?.provider === 'demo' && node.storage.localName) {
    demoCopyOut(session.profile, node.storage.localName, dest)
    report(1)
    return
  }
  if (
    node.storage?.provider !== 'telegram' ||
    (!node.storage.messageId && !node.storage.parts?.length)
  ) {
    throw new Error('El archivo no tiene datos para descargar')
  }
  if (!session.client) throw new Error('Cliente de Telegram no conectado')

  const parts = node.storage.parts?.filter((part) => part.size > 0)
  if (parts && parts.length > 1) {
    await downloadParts(session.client, parts, dest, report)
  } else if (node.storage.messageId) {
    await downloadFromSaved(session.client, node.storage.messageId, dest, report)
  }
  report(1)
}

async function downloadOneToPath(
  session: ReturnType<typeof requireActive>,
  node: VfsNode,
  dest: string
): Promise<void> {
  const progressId = randomUUID()
  const name = basename(dest)
  const totalSize = node.size
  const meter = makeMeter()
  sendProgress({
    id: progressId,
    name,
    kind: 'download',
    progress: 0,
    status: 'uploading',
    size: totalSize
  })
  const onProgress = (progress: number): void => {
    if (cancelledDownloads.has(progressId)) throw new Error('Cancelado')
    const stats = meterUpdate(meter, progress * totalSize, totalSize)
    sendProgress({
      id: progressId,
      name,
      kind: 'download',
      progress,
      status: 'uploading',
      size: totalSize,
      speed: stats.speed,
      eta: stats.eta
    })
  }
  try {
    await downloadNodeToPath(session, node, dest, onProgress, () =>
      cancelledDownloads.has(progressId)
    )
    if (cancelledDownloads.has(progressId)) {
      cancelledDownloads.delete(progressId)
      try {
        rmSync(dest, { force: true })
      } catch {
        /* ignore */
      }
      sendProgress({
        id: progressId,
        name,
        kind: 'download',
        progress: 0,
        status: 'error',
        error: 'Cancelado'
      })
      return
    }
    sendProgress({ id: progressId, name, kind: 'download', progress: 1, status: 'done' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'Cancelado') {
      cancelledDownloads.delete(progressId)
      try {
        rmSync(dest, { force: true })
      } catch {
        /* ignore */
      }
      sendProgress({
        id: progressId,
        name,
        kind: 'download',
        progress: 0,
        status: 'error',
        error: 'Cancelado'
      })
    } else {
      sendProgress({
        id: progressId,
        name,
        kind: 'download',
        progress: 0,
        status: 'error',
        error: message
      })
    }
  }
}

async function downloadNodes(ids: string[]): Promise<void> {
  const session = requireActive()

  // Si hay carpetas, descargar el árbol completo conservando la estructura.
  const selectedNodes = ids
    .map((id) => session.store.node(id))
    .filter((node): node is VfsNode => Boolean(node))
  if (selectedNodes.some((node) => node.kind === 'folder')) {
    const autoDir = process.env['TGPLUSDRIVE_DOWNLOAD_DIR']
    await restoreToDisk({
      ids,
      mode: 'download',
      destination: autoDir || undefined
    })
    return
  }

  const firstNode = ids.length === 1 ? session.store.node(ids[0]) : null
  if (ids.length === 1 && firstNode && firstNode.kind === 'file') {
    // Ruta directa para pruebas/automatización (sin diálogo).
    const autoDir = process.env['TGPLUSDRIVE_DOWNLOAD_DIR']
    if (autoDir) {
      mkdirSync(autoDir, { recursive: true })
      await downloadOneToPath(session, firstNode, join(autoDir, firstNode.name))
      return
    }
    const pick = await dialog.showSaveDialog(mainWindow!, {
      title: 'Guardar archivo',
      defaultPath: join(app.getPath('downloads'), firstNode.name),
      buttonLabel: 'Guardar'
    })
    if (pick.canceled || !pick.filePath) return
    await downloadOneToPath(session, firstNode, pick.filePath)
    return
  }

  const pick = await dialog.showOpenDialog(mainWindow!, {
    title: 'Elegir carpeta de destino',
    properties: ['openDirectory', 'createDirectory']
  })
  if (pick.canceled || pick.filePaths.length === 0) return
  const dir = pick.filePaths[0]

  // Descargar varios archivos en paralelo acelera mucho los lotes. Cada archivo
  // sigue usando 4 conexiones internas; limitamos cuántos archivos a la vez para
  // no saturar la cuenta.
  const files = ids
    .map((id) => session.store.node(id))
    .filter((node): node is VfsNode => Boolean(node && node.kind === 'file' && node.storage))
  const fileConcurrency = Math.max(
    1,
    Math.min(
      Number(process.env['TGPLUSDRIVE_DOWNLOAD_CONCURRENCY']) || 2,
      Math.max(1, files.length)
    )
  )
  let fileCursor = 0

  const downloadOne = async (node: VfsNode): Promise<void> => {
    const dest = uniqueDest(dir, node.name)
    const progressId = randomUUID()
    sendProgress({ id: progressId, name: node.name, kind: 'download', progress: 0, status: 'uploading' })
    try {
      if (cancelledDownloads.has(progressId)) {
        cancelledDownloads.delete(progressId)
        sendProgress({ id: progressId, name: node.name, kind: 'download', progress: 0, status: 'error', error: 'Cancelado' })
        return
      }
      if (node.storage!.provider === 'demo' && node.storage!.localName) {
        demoCopyOut(session.profile, node.storage!.localName, dest)
      } else if (
        node.storage!.provider === 'telegram' &&
        (node.storage!.messageId || node.storage!.parts?.length)
      ) {
        if (!session.client) throw new Error('Cliente de Telegram no conectado')
        const parts = node.storage!.parts?.filter((part) => part.size > 0)
        const dlMeter = makeMeter()
        const dlTotal = node.size
        const onProgress = (progress: number): void => {
          if (cancelledDownloads.has(progressId)) throw new Error('Cancelado')
          const meter = meterUpdate(dlMeter, progress * dlTotal, dlTotal)
          sendProgress({
            id: progressId,
            name: node.name,
            kind: 'download',
            progress,
            status: 'uploading',
            size: dlTotal,
            speed: meter.speed,
            eta: meter.eta
          })
        }
        if (parts && parts.length > 1) {
          await downloadParts(session.client, parts, dest, onProgress)
        } else {
          await downloadFromSaved(
            session.client,
            node.storage!.messageId as number,
            dest,
            onProgress
          )
        }
      }
      if (cancelledDownloads.has(progressId)) {
        cancelledDownloads.delete(progressId)
        try { rmSync(dest, { force: true }) } catch {}
        sendProgress({ id: progressId, name: node.name, kind: 'download', progress: 0, status: 'error', error: 'Cancelado' })
        return
      }
      sendProgress({ id: progressId, name: node.name, kind: 'download', progress: 1, status: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'Cancelado') {
        cancelledDownloads.delete(progressId)
        try { rmSync(dest, { force: true }) } catch {}
        sendProgress({ id: progressId, name: node.name, kind: 'download', progress: 0, status: 'error', error: 'Cancelado' })
      } else {
        sendProgress({ id: progressId, name: node.name, kind: 'download', progress: 0, status: 'error', error: message })
      }
    }
  }

  const downloadWorker = async (): Promise<void> => {
    while (fileCursor < files.length) {
      const index = fileCursor
      fileCursor += 1
      await downloadOne(files[index])
    }
  }
  await Promise.all(Array.from({ length: fileConcurrency }, downloadWorker))
}

function safeRestoreName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  if (!clean || clean === '.' || clean === '..') return '_'
  return clean
}

function isPathInside(child: string, parent: string): boolean {
  const a = resolve(child).toLowerCase()
  const b = resolve(parent).toLowerCase()
  return a === b || a.startsWith(`${b}${sep}`)
}

function collectRestoreItems(
  store: DriveStore,
  ids: string[]
): Array<{ node: VfsNode; rel: string }> {
  const items: Array<{ node: VfsNode; rel: string }> = []
  const walk = (node: VfsNode, prefix: string): void => {
    const name = safeRestoreName(node.name)
    if (node.kind === 'file') {
      items.push({ node, rel: prefix ? join(prefix, name) : name })
      return
    }
    const children = store.children(node.id)
    const base = prefix ? join(prefix, name) : name
    if (children.length === 0) {
      items.push({ node, rel: base })
      return
    }
    for (const child of children) walk(child, base)
  }
  for (const id of ids) {
    const node = store.node(id)
    if (node && !node.trashed) walk(node, '')
  }
  return items
}

async function restoreToDisk(request: RestoreRequest): Promise<RestoreResult | null> {
  const session = requireActive()
  const restoring = request.mode !== 'download'
  let destination = request.destination?.trim() ?? ''
  if (!destination) {
    const pick = await dialog.showOpenDialog(mainWindow!, {
      title: restoring ? 'Elegir carpeta donde restaurar' : 'Elegir carpeta de destino',
      properties: ['openDirectory', 'createDirectory']
    })
    if (pick.canceled || pick.filePaths.length === 0) return null
    destination = pick.filePaths[0]
  }
  mkdirSync(destination, { recursive: true })

  // Conservar siempre la estructura elegida: si restauras la carpeta de
  // respaldo, se crea "Respaldo/..." con todas sus subcarpetas y archivos.
  const items = collectRestoreItems(session.store, request.ids).filter((item) =>
    isPathInside(join(destination, item.rel), destination)
  )
  const files = items.filter((item) => item.node.kind === 'file')
  const total = files.length
  const progressId = `${restoring ? 'restore' : 'download'}:${randomUUID()}`
  let restored = 0
  let failed = 0
  let index = 0

    for (const item of items) {
    if (cancelledDownloads.has(progressId)) break
    if (item.node.kind === 'folder') {
      mkdirSync(join(destination, item.rel), { recursive: true })
      continue
    }
    index += 1
    const parentDir = dirname(join(destination, item.rel))
    mkdirSync(parentDir, { recursive: true })
    const dest = uniqueDest(parentDir, item.node.name)
    const meter = makeMeter()
    const totalSize = item.node.size
    sendProgress({
      id: progressId,
      name: item.node.name,
      kind: 'download',
      progress: 0,
      status: 'uploading',
      size: totalSize,
      index,
      total,
      detail: item.rel
    })
    try {
      await downloadNodeToPath(
        session,
        item.node,
        dest,
        (progress) => {
          const stats = meterUpdate(meter, progress * totalSize, totalSize)
          sendProgress({
            id: progressId,
            name: item.node.name,
            kind: 'download',
            progress,
            status: 'uploading',
            size: totalSize,
            speed: stats.speed,
            eta: stats.eta,
            index,
            total,
            detail: item.rel
          })
        },
        () => cancelledDownloads.has(progressId)
      )
      restored += 1
      sendProgress({
        id: progressId,
        name: item.node.name,
        kind: 'download',
        progress: 1,
        status: 'uploading',
        index,
        total,
        detail: item.rel
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'Cancelado') {
        failed += 1
        try {
          rmSync(dest, { force: true })
        } catch {
          /* ignore */
        }
        sendProgress({
          id: progressId,
          name: item.node.name,
          kind: 'download',
          progress: 0,
          status: 'error',
          error: 'Cancelado',
          index,
          total,
          detail: item.rel
        })
        cancelledDownloads.delete(progressId)
        break
      }
      failed += 1
      sendProgress({
        id: progressId,
        name: item.node.name,
        kind: 'download',
        progress: 1,
        status: 'uploading',
        index,
        total,
        detail: item.rel
      })
    }
  }

  cancelledDownloads.delete(progressId)
  const finished: RestoreResult = { destination, restored, failed }
  const summary =
    failed > 0
      ? `${restored} restaurado(s), ${failed} con error`
      : `${restored} archivo(s) restaurado(s)`
  sendProgress({
    id: progressId,
    name: restoring ? 'Restauración' : 'Descarga',
    kind: 'download',
    progress: 1,
    status: failed > 0 ? 'error' : 'done',
    index: restored + failed,
    total,
    detail: destination,
    error: failed > 0 ? summary : undefined
  })
  return finished
}

async function openNode(id: string): Promise<void> {
  const session = requireActive()
  const node = session.store.node(id)
  if (!node || node.kind !== 'file' || !node.storage) return
  if (node.storage.provider === 'demo' && node.storage.localName) {
    await shell.openPath(demoPath(session.profile, node.storage.localName))
    return
  }
  if (
    node.storage.provider === 'telegram' &&
    (node.storage.messageId || node.storage.parts?.length)
  ) {
    if (!session.client) throw new Error('Cliente de Telegram no conectado')
    const dir = join(app.getPath('temp'), 'tgplusdrive-open')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, node.name)
    const parts = node.storage.parts?.filter((part) => part.size > 0)
    if (parts && parts.length > 1) {
      await downloadParts(session.client, parts, dest)
    } else {
      await downloadFromSaved(session.client, node.storage.messageId as number, dest)
    }
    await shell.openPath(dest)
  }
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async (): Promise<Bootstrap> => {
    return { profiles: listProfiles(), active: driveState() }
  })

  ipcMain.handle('profiles:list', () => listProfiles())

  ipcMain.handle('app:clearCredentials', () => {
    clearAppCredentials()
    return { cleared: true }
  })

  // URL fija en el proceso principal: el renderer no puede abrir enlaces
  // arbitrarios con shell.openExternal.
  ipcMain.handle('app:openDonation', async () => {
    try {
      await shell.openExternal(DONATION_URL)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('app:version', () => app.getVersion())

  /**
   * Ruta del ejecutable que debe registrarse para el inicio automático.
   * En la versión portable, `process.execPath` apunta a la copia temporal que
   * se descomprime al abrir; hay que registrar el .exe original.
   */
  const loginItemPath = (): string => {
    const portable = process.env['PORTABLE_EXECUTABLE_FILE']
    if (portable && existsSync(portable)) return portable
    return process.execPath
  }

  ipcMain.handle('app:autoStart', () => {
    if (process.platform !== 'win32') return { supported: false, enabled: false }
    if (!app.isPackaged) return { supported: false, enabled: false }
    try {
      const settings = app.getLoginItemSettings({ path: loginItemPath() })
      return { supported: true, enabled: settings.openAtLogin }
    } catch {
      return { supported: false, enabled: false }
    }
  })

  ipcMain.handle('app:setAutoStart', (_event, enabled: boolean) => {
    if (process.platform !== 'win32') {
      return { supported: false, enabled: false, error: 'Solo disponible en Windows' }
    }
    if (!app.isPackaged) {
      return { supported: false, enabled: false, error: 'No disponible en modo desarrollo' }
    }
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        path: loginItemPath(),
        args: []
      })
      const settings = app.getLoginItemSettings({ path: loginItemPath() })
      return { supported: true, enabled: settings.openAtLogin }
    } catch (err) {
      return {
        supported: true,
        enabled: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('app:checkForUpdates', async (): Promise<UpdateInfo> => {
    const current = app.getVersion()
    if (updateCache && Date.now() - updateCache.at < UPDATE_CACHE_MS) {
      return updateCache.info
    }
    const info: UpdateInfo = { current, latest: null, hasUpdate: false }
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases?per_page=10`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `TGPlusDrive/${current}`
        }
      })
      if (!response.ok) {
        info.error =
          response.status === 403 || response.status === 429
            ? 'GitHub limitó las comprobaciones. Inténtalo más tarde.'
            : `GitHub respondió ${response.status}.`
        return info
      }
      const releases = (await response.json()) as Array<{
        tag_name?: string
        name?: string
        html_url?: string
        body?: string
        published_at?: string
        draft?: boolean
        prerelease?: boolean
        assets?: Array<{ name?: string; browser_download_url?: string }>
      }>
      const usable = releases.filter((release) => !release.draft && release.tag_name)
      if (usable.length === 0) {
        info.error = 'No hay versiones publicadas todavía.'
        return info
      }
      // Elegir la versión MÁS ALTA, no la última "estable": en beta todas las
      // releases son pre-release, y preferir una estable antigua ocultaba las
      // versiones nuevas a los usuarios.
      const newest = usable.reduce((best, candidate) =>
        isNewerVersion(candidate.tag_name!.replace(/^v/i, ''), best.tag_name!.replace(/^v/i, ''))
          ? candidate
          : best
      )
      const latest = newest.tag_name!.replace(/^v/i, '')
      info.latest = latest
      info.releaseUrl = newest.html_url ?? RELEASES_URL
      info.publishedAt = newest.published_at
      info.notes = newest.body?.slice(0, 1200)
      const setupAsset =
        newest.assets?.find((asset) => /setup.*\.exe$/i.test(asset.name ?? '')) ??
        newest.assets?.find((asset) => /\.exe$/i.test(asset.name ?? ''))
      info.downloadUrl = setupAsset?.browser_download_url ?? info.releaseUrl
      info.hasUpdate = isNewerVersion(latest, current)
    } catch (err) {
      info.error = err instanceof Error ? err.message : String(err)
    }
    updateCache = { at: Date.now(), info }
    return info
  })

  ipcMain.handle('app:openUrl', async (_event, kind: 'release' | 'download') => {
    const url = kind === 'download' ? updateCache?.info.downloadUrl : updateCache?.info.releaseUrl
    try {
      await shell.openExternal(url || RELEASES_URL)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('app:credentials', () => {
    const saved = loadAppCredentials()
    if (saved) return { apiId: String(saved.apiId), apiHash: saved.apiHash }
    const profile = listProfiles().find((p) => p.apiId && p.apiHash)
    if (profile) return { apiId: String(profile.apiId), apiHash: String(profile.apiHash) }
    return null
  })

  ipcMain.handle('profiles:activate', async (_event, id: string) => {
    const state = await activateProfile(id)
    return state
  })

  ipcMain.handle('profiles:remove', async (_event, id: string) => {
    if (active?.profile.id === id) {
      stopBackup()
      await disconnect(active.client ?? null)
      active = null
      emitChanged()
    }
    removeProfile(id)
    return listProfiles()
  })

  ipcMain.handle('profiles:logout', async (_event, id: string) => {
    if (active?.profile.id === id) {
      stopBackup()
      await disconnect(active.client ?? null)
      active = null
      emitChanged()
    }
    clearSession(id)
    // Cerrar sesión = quitar el perfil de la lista, pero conservar su carpeta
    // (vfs.json, miniaturas) para cuando vuelva a iniciar sesión.
    unlistProfile(id)
    return listProfiles()
  })

  ipcMain.handle(
    'auth:saveCredentials',
    async (_event, payload: { apiId: string; apiHash: string }) => {
      const apiId = Number(String(payload.apiId).trim())
      const apiHash = String(payload.apiHash).trim().toLowerCase()
      if (!Number.isFinite(apiId) || apiId <= 0) {
        return { ok: false, error: 'El api_id no es válido' }
      }
      if (!/^[0-9a-f]{32}$/.test(apiHash)) {
        return { ok: false, error: 'El api_hash no es válido' }
      }
      saveAppCredentials({ apiId, apiHash })
      return { ok: true }
    }
  )

  ipcMain.handle('profiles:limit', () => ({ max: MAX_PROFILES, count: listProfiles().length }))

  ipcMain.handle('auth:start', async (_event, payload: { apiId: string; apiHash: string; method?: AuthMethod }) => {
    const creds = { apiId: payload.apiId, apiHash: payload.apiHash }
    // Un login nuevo crea otro perfil: bloquear antes de conectar si ya hay MAX.
    if (listProfiles().length >= MAX_PROFILES) {
      send('auth:state', {
        step: 'error',
        error: `Límite de ${MAX_PROFILES} cuentas alcanzado. Cierra sesión en una cuenta para añadir otra.`
      })
      return { started: false, error: 'limite' }
    }
    const method: AuthMethod =
      payload.method === 'qr' ? 'qr' : payload.method === 'desktop' ? 'desktop' : 'phone'
    void startTelegramLogin(creds, method, (state: AuthState) => send('auth:state', state))
      .then(async (result) => {
        if (!result) return
        stopBackup()
        if (active) {
          if (indexTimer) clearTimeout(indexTimer)
          await disconnect(active.client ?? null)
        }
        const store = new DriveStore(result.profile)
        active = { profile: result.profile, store, client: result.client }
        touchProfile(result.profile.id)
        emitChanged()
        pullIndex(result.client, store)
          .then(async (changed) => {
            if (changed) emitChanged()
            else if (store.db.nodes.length > 0) await pushIndex(result.client, store)
          })
          .catch(() => undefined)
          .finally(() => {
            if (active?.profile.id === result.profile.id) startBackupForActive()
          })
      })
      .catch(() => undefined)
    return { started: true }
  })

  ipcMain.handle('auth:provide', (_event, payload: { field: 'phone' | 'code' | 'password'; value: string }) => {
    return provideAuth(payload.field, payload.value)
  })

  ipcMain.handle('auth:cancel', async () => {
    await cancelLogin()
    return true
  })

  ipcMain.handle('drive:state', () => driveState())

  ipcMain.handle('drive:refreshCaptions', async () => {
    const session = requireActive()
    if (!session.client) throw new Error('Cliente de Telegram no conectado')
    const before = session.store.db.nodes.filter((node) => node.caption).length
    const changed = await backfillNodeCaptions(session.client, session.store)
    emitChanged()
    if (changed > 0) scheduleIndexSync()
    const after = session.store.db.nodes.filter((node) => node.caption).length
    return { before, changed, after }
  })

  ipcMain.handle('drive:cacheStats', () => {
    const session = requireActive()
    const stats = cacheStats(session.profile)
    const total = stats.thumbs + stats.preview + stats.stream + stats.playable
    return { ...stats, total }
  })

  ipcMain.handle('drive:clearCache', () => {
    const session = requireActive()
    const freed = clearProfileCache(session.profile)
    return { freed }
  })

  ipcMain.handle('drive:createFolder', async (_event, payload: { parentId: string | null; name: string }) => {
    const session = requireActive()
    session.store.createFolder(payload.parentId, payload.name)
    emitChanged()
    scheduleIndexSync()
    return driveState()
  })

  ipcMain.handle('drive:pickUpload', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Seleccionar archivos para subir',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return []
    return result.filePaths
  })

  ipcMain.handle('drive:analyzeUpload', async (_event, paths: string[]) => {
    const session = requireActive()
    let premium = false
    if (session.client) {
      try {
        const limits = await getAccountLimits(session.client)
        premium = limits.premium
      } catch {
        /* ignore */
      }
    }
    const override = Number(process.env['TGPLUSDRIVE_PART_BYTES'])
    const hasOverride = Number.isFinite(override) && override > 0
    const maxBytes = hasOverride
      ? override
      : premium
        ? 4 * 1024 * 1024 * 1024
        : 2 * 1024 * 1024 * 1024
    const partSize = hasOverride ? Math.max(1024, override) : partSafeBytes(maxBytes)
    const knownSizes = new Set(
      session.store.db.nodes
        .filter((node) => node.kind === 'file' && !node.trashed && node.storage?.sha256)
        .map((node) => node.size)
    )
    const analysis: UploadAnalysisFile[] = []
    for (const path of paths) {
      let size = 0
      let isDirectory = false
      try {
        const stat = statSync(path)
        size = stat.size
        isDirectory = stat.isDirectory()
      } catch {
        size = 0
      }
      let sha256: string | undefined
      let duplicates: DuplicateMatch[] = []
      if (!isDirectory && knownSizes.has(size)) {
        try {
          sha256 = await fileSha256(path)
          duplicates = toDuplicateMatches(
            session.store,
            findDuplicates(session.store, sha256, size)
          )
        } catch {
          sha256 = undefined
        }
      }
      analysis.push({
        path,
        name: basename(path),
        size,
        split: size > maxBytes,
        parts: size > maxBytes ? Math.ceil(size / partSize) : 1,
        sha256,
        duplicates
      })
    }
    return {
      premium,
      maxBytes,
      partSize,
      files: analysis,
      needsSplit: analysis.some((entry) => entry.split)
    }
  })

  ipcMain.handle(
    'drive:uploadPaths',
    async (
      _event,
      payload: {
        parentId: string | null
        paths: string[]
        options?: { actions?: Record<string, DuplicateAction>; hashes?: Record<string, string> }
      }
    ) => {
      return uploadPaths(payload.parentId, payload.paths, undefined, payload.options)
    }
  )

  ipcMain.handle('drive:pendingUploads', () => pendingUploads())

  ipcMain.handle('drive:resumeUpload', async (_event, nodeId: string) => {
    const pending = pendingUploads().find((entry) => entry.nodeId === nodeId)
    if (!pending) throw new Error('No hay una subida pendiente para este archivo')
    return uploadPaths(null, [pending.source], nodeId)
  })

  ipcMain.handle('drive:discardUpload', async (_event, nodeId: string) => {
    await discardPendingUpload(nodeId)
    return { discarded: true }
  })

  ipcMain.handle('backup:info', () => backupManager?.info() ?? emptyBackupInfo())

  ipcMain.handle('backup:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Seleccionar carpeta para respaldar',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('backup:configure', async (_event, input: BackupConfigInput) => {
    requireActive()
    if (!backupManager) startBackupForActive()
    if (!backupManager) throw new Error('No se pudo iniciar el respaldo automático')
    const sourceDir = input.sourceDir.trim()
    if (input.enabled) {
      if (!sourceDir || !existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
        throw new Error('Selecciona una carpeta válida para respaldar')
      }
    }
    backupManager.configure({
      enabled: input.enabled,
      sourceDir,
      folderName: input.folderName.trim() || (sourceDir ? basename(sourceDir) : '')
    })
    return backupManager.info()
  })

  ipcMain.handle('backup:runNow', async () => {
    requireActive()
    if (!backupManager) startBackupForActive()
    if (!backupManager) throw new Error('No se pudo iniciar el respaldo automático')
    const info = backupManager.info()
    if (!info.enabled) throw new Error('Activa el respaldo automático primero')
    backupManager.runNow()
    return backupManager.info()
  })

  ipcMain.handle('backup:pause', async () => {
    requireActive()
    if (!backupManager) throw new Error('El respaldo automático no está activo')
    backupManager.pause()
    return backupManager.info()
  })

  ipcMain.handle('backup:resume', async () => {
    requireActive()
    if (!backupManager) startBackupForActive()
    if (!backupManager) throw new Error('No se pudo iniciar el respaldo automático')
    backupManager.resume()
    return backupManager.info()
  })

  ipcMain.handle('backup:cancel', async () => {
    requireActive()
    if (!backupManager) throw new Error('El respaldo automático no está activo')
    backupManager.cancel()
    return backupManager.info()
  })

  ipcMain.handle('backup:resetSkipped', async () => {
    requireActive()
    if (!backupManager) startBackupForActive()
    if (!backupManager) throw new Error('No se pudo iniciar el respaldo automático')
    backupManager.resetSkipped()
    return backupManager.info()
  })

  ipcMain.handle(
    'drive:playNative',
    async (_event, payload: { id: string; start?: number; audioOnly?: boolean }) => {
      const session = requireActive()
      const node = session.store.node(payload.id)
      if (!node || node.kind !== 'file') {
        return { played: false, error: 'Archivo no encontrado' }
      }
      if (!getMediaBaseUrl()) await startMediaServer()
      // Precargar el mensaje en paralelo no bloquea: mpv abre al instante y
      // el primer Range encuentra la caché ya caliente.
      const firstMessageId = node.storage?.parts?.[0]?.messageId ?? node.storage?.messageId
      if (session.client && firstMessageId) {
        void warmMessage(session.client, firstMessageId)
      }
      let geometry: { x: number; y: number; width: number; height: number } | undefined
      try {
        const bounds = mainWindow?.getContentBounds()
        if (bounds) {
          geometry = {
            x: bounds.x,
            y: bounds.y,
            width: Math.max(640, Math.round(bounds.width * 0.86)),
            height: Math.max(400, Math.round(bounds.height * 0.86))
          }
        }
      } catch {
        /* ignore */
      }
      const ok = playWithMpv({
        url: sourceUrl(payload.id, node.name),
        title: node.name,
        start: payload.start,
        audioOnly: payload.audioOnly,
        geometry
      })
      return ok
        ? { played: true }
        : { played: false, error: 'No se encontró el reproductor mpv' }
    }
  )

  ipcMain.handle('drive:saveRecoveryTool', async () => {
    const source = writeRecoveryTool()
    const pick = await dialog.showSaveDialog(mainWindow!, {
      title: 'Guardar herramienta de recuperación',
      defaultPath: 'Recuperar TGPlusDrive.html',
      filters: [{ name: 'Página web', extensions: ['html'] }]
    })
    if (pick.canceled || !pick.filePath) return { saved: false }
    try {
      copyFileSync(source, pick.filePath)
      return { saved: true, path: pick.filePath }
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('drive:download', async (_event, ids: string[]) => {
    await downloadNodes(ids)
    return true
  })

  ipcMain.handle('drive:restoreToDisk', async (_event, request: RestoreRequest) => {
    return restoreToDisk(request)
  })

  ipcMain.handle('drive:cancelDownload', async (_event, id: string) => {
    cancelledDownloads.add(id)
    return true
  })

  ipcMain.handle(
    'drive:cancelUpload',
    async (_event, id: string, wholeBatch = false) => {
      // Con wholeBatch se cancela la cola completa del lote; sin él, solo esa fila.
      const batchId = uploadBatchOf.get(id)
      if (wholeBatch && batchId) {
        cancelUploadBatch(batchId)
        return true
      }
      cancelledUploads.add(id)
      const control = uploadControls.get(id)
      if (control) control.isCanceled = true
      return true
    }
  )

  ipcMain.handle('drive:open', async (_event, id: string) => {
    await openNode(id)
    return true
  })

  ipcMain.handle('drive:rename', async (_event, payload: { id: string; name: string }) => {
    const session = requireActive()
    if (backupEnabled() && isBackupRoot(session.store, payload.id)) {
      throw new Error(
        'La carpeta de respaldo está protegida: no se puede renombrar. Desactiva el respaldo automático para modificarla.'
      )
    }
    const node = session.store.node(payload.id)
    const updated = session.store.rename(payload.id, payload.name)

    // Sincronizar el nombre en el caption de Telegram (no bloquea la UI).
    if (node && session.client && node.storage?.provider === 'telegram') {
      const messageIds = node.storage.parts?.length
        ? node.storage.parts.map((part) => part.messageId)
        : node.storage.messageId
          ? [node.storage.messageId]
          : []
      for (const messageId of messageIds) {
        void renameInSaved(session.client, messageId, updated.name)
      }
    }

    emitChanged()
    scheduleIndexSync()
    return driveState()
  })

  ipcMain.handle('drive:trash', async (_event, ids: string[]) => {
    const session = requireActive()
    const protectedRoot = backupEnabled()
      ? ids.find((id) => isBackupRoot(session.store, id))
      : undefined
    if (protectedRoot) {
      throw new Error(
        'La carpeta de respaldo está protegida. Desactiva el respaldo automático antes de moverla a la papelera.'
      )
    }
    if (backupEnabled()) backupManager?.noteDeleted(ids)
    session.store.trash(ids)
    emitChanged()
    scheduleIndexSync()
    return driveState()
  })

  ipcMain.handle('drive:restore', async (_event, ids: string[]) => {
    const session = requireActive()
    session.store.restore(ids)
    if (backupEnabled()) backupManager?.noteRestored(ids)
    emitChanged()
    scheduleIndexSync()
    return driveState()
  })

  ipcMain.handle('drive:deleteForever', async (_event, ids: string[]) => {
    const session = requireActive()
    const protectedRoot = backupEnabled()
      ? ids.find((id) => isBackupRoot(session.store, id))
      : undefined
    if (protectedRoot) {
      throw new Error(
        'La carpeta de respaldo está protegida. Desactiva el respaldo automático antes de eliminarla definitivamente.'
      )
    }
    if (backupEnabled()) backupManager?.noteDeleted(ids)
    const removed = session.store.deleteForever(ids)
    await deleteNodeStorage(session, removed)
    emitChanged()
    scheduleIndexSync()
    return driveState()
  })

  ipcMain.handle('drive:star', async (_event, id: string) => {
    const session = requireActive()
    const node = session.store.node(id)
    if (node) session.store.setStarred(id, !node.starred)
    emitChanged()
    scheduleIndexSync()
    return driveState()
  })

  ipcMain.handle('drive:setView', async (_event, view: 'grid' | 'list') => {
    const session = requireActive()
    session.store.setView(view)
    emitChanged()
    return driveState()
  })

  ipcMain.handle('drive:setTheme', async (_event, theme: 'light' | 'dark') => {
    const session = requireActive()
    session.store.setTheme(theme)
    emitChanged()
    return driveState()
  })

  ipcMain.handle('drive:syncIndex', async () => {
    const session = requireActive()
    if (!session.client) throw new Error('La sincronización del índice requiere modo Telegram')
    await pushIndex(session.client, session.store)
    emitChanged()
    return driveState()
  })

  ipcMain.handle('drive:move', async (_event, payload: { ids: string[]; targetId: string | null }) => {
    const session = requireActive()
    if (backupEnabled() && payload.ids.some((id) => Boolean(backupAncestorOf(session.store, id)))) {
      throw new Error(
        'La carpeta de respaldo está protegida: no se puede mover. Desactiva el respaldo automático para modificarla.'
      )
    }
    session.store.moveTo(payload.ids, payload.targetId)
    emitChanged()
    scheduleIndexSync()
    return driveState()
  })

  ipcMain.handle('drive:scan', async () => {
    const session = requireActive()
    if (!session.client) throw new Error('El escaneo requiere una cuenta de Telegram conectada')
    const result = await scanSavedMessages(
      session.client,
      session.store,
      (progress: ScanProgress) => send('scan:progress', progress)
    )
    emitChanged()
    if (result.added > 0) {
      try {
        await pushIndex(session.client, session.store)
      } catch (err) {
        console.error('[TGPlusDrive] No se pudo sincronizar el índice tras el escaneo:', err)
      }
    }
    return result
  })
}

let tray: Tray | null = null
let quitting = false
let trayHintShown = false

function trayIconPath(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.ico'), join(process.resourcesPath, 'mpv', 'mpv.ico')]
    : [join(app.getAppPath(), 'build', 'icon.ico')]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return ''
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function loginItemEnabled(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin
  } catch {
    return false
  }
}

function setLoginItem(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      args: ['--hidden']
    })
  } catch {
    /* ignore */
  }
}

function createTray(): void {
  if (tray) return
  const iconPath = trayIconPath()
  let icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  if (icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR42mNkYPhfz0AEYBxVSF+FjP9RDIgYVUgfhYz/UQyIGFVIX4WM/1EMiBhVSF+FjP9RDIgYVYg/AAAyJQr9k1k3WQAAAABJRU5ErkJggg==',
        'base64'
      )
    )
  }
  tray = new Tray(icon)
  tray.setToolTip('TGPlusDrive ‐ clic para abrir')
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir TGPlusDrive', click: () => showWindow() },
    {
      label: 'Cerrar ventana (seguir en segundo plano)',
      click: () => mainWindow?.hide()
    },
    { type: 'separator' },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: loginItemEnabled(),
      click: (item) => setLoginItem(item.checked)
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showWindow())
  tray.on('click', () => showWindow())
}

function setupTrayBehaviour(): void {
  if (!mainWindow) return
  mainWindow.on('close', (event) => {
    if (quitting) return
    // Si la bandeja no existe, cerrar de verdad (evita quedar sin ventana).
    if (!tray) return
    event.preventDefault()
    mainWindow?.hide()
    try {
      if (Notification.isSupported() && !trayHintShown) {
        trayHintShown = true
        new Notification({
          title: 'TGPlusDrive sigue abierto',
          body: 'Esta en la bandeja del sistema, junto al reloj. Tus transferencias continuan. Clic derecho en el icono y Salir para cerrar.'
        }).show()
      }
    } catch {
      /* ignore */
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: '#f8fafd',
    title: 'TGPlusDrive',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (process.argv.includes('--hidden')) return
    mainWindow?.show()
  })
  setupTrayBehaviour()

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerSourceResolver(): void {
  setSourceResolver((id) => {
    const session = active
    const node = session?.store.node(id)
    if (!session?.client || !node || node.kind !== 'file' || node.size <= 0) return null
    const parts = node.storage?.parts?.filter((part) => part.size > 0)
    return {
      size: node.size,
      mime: node.mime || guessMime(node.name),
      stream: (start, end) => {
        if (parts && parts.length > 1) {
          return Readable.from(streamParts(session.client!, parts, start, end))
        }
        if (!node.storage?.messageId) return Readable.from([])
        return Readable.from(
          streamSavedMedia(session.client!, node.storage.messageId as number, start, end)
        )
      }
    }
  })
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  // Ya hay una instancia abierta: esta se cierra sin crear ventana ni bandeja.
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  app.setAppUserModelId('com.tgplusdrive.app')
  registerMediaProtocol()
  registerSourceResolver()
  void startMediaServer().catch((err) =>
    console.error('[TGPlusDrive] Servidor de medios:', err)
  )
  registerIpc()
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // No cerrar: la app sigue en la bandeja con las transferencias activas.
  if (process.platform === 'darwin') return
})

app.on('before-quit', () => {
  quitting = true
  if (indexTimer) clearTimeout(indexTimer)
  stopBackup()
  void disconnect(active?.client ?? null)
})
