import { existsSync, readdirSync, statSync, watch, type Dirent, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import type { BackupInfo, BackupSkipEntry, VfsNode } from '@shared/types'
import { fileSha256 } from './hash'
import { readJson, writeJsonAtomic } from './fsutil'
import type { DriveStore } from './store'

const SCAN_INTERVAL_MS = 10 * 60 * 1000
const DEBOUNCE_MS = 4000

interface BackupEntry {
  size: number
  mtimeMs: number
  sha256: string
  nodeId: string
  parentId: string | null
}

interface BackupFile {
  enabled: boolean
  sourceDir: string
  folderName: string
  rootFolderId: string | null
  /** Huella estable de sourceDir para reconocer la carpeta si se pierde este archivo. */
  token?: string
  /** Raíz ya adoptada tras recuperar la configuración. */
  adoptedRootId?: string
  folders: Record<string, string>
  entries: Record<string, BackupEntry>
  skipped?: Record<string, BackupSkipEntry>
  lastScanAt?: number
  lastError?: string
}

function normalizePath(input: string): string {
  if (!input) return ''
  return resolve(input).replace(/[\\/]+$/, '').toLowerCase()
}

function sourceToken(input: string): string | undefined {
  const normalized = normalizePath(input)
  if (!normalized) return undefined
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function emptyState(): BackupFile {
  return {
    enabled: false,
    sourceDir: '',
    folderName: '',
    rootFolderId: null,
    folders: {},
    entries: {}
  }
}

export interface BackupProgress {
  name: string
  progress: number
  status: 'uploading' | 'paused' | 'done' | 'error'
  detail?: string
  index?: number
  total?: number
  speed?: number
  eta?: number
  error?: string
}

export type BackupFileProgress = (
  progress: number,
  speed?: number,
  eta?: number
) => void

export interface BackupDeps {
  store: DriveStore
  uploadFile: (
    parentId: string | null,
    path: string,
    sha256: string,
    onProgress?: BackupFileProgress,
    shouldCancel?: () => boolean
  ) => Promise<string | null>
  deleteNodes: (ids: string[]) => Promise<void>
  refresh: () => void
  emit: (info: BackupInfo) => void
  progress: (info: BackupProgress) => void
}

export class BackupManager {
  private state: BackupFile
  private running = false
  private uploading = false
  private paused = false
  private queued = false
  private disposed = false
  private generation = 0
  private currentFile?: string
  private currentIndex = 0
  private currentTotal = 0
  private currentProgress = 0
  private currentSpeed = 0
  private currentEta = 0
  private cancelRequested = false
  private lastProgressAt = 0
  private watcher: FSWatcher | null = null
  private interval: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private lastSave = 0

  constructor(
    private readonly deps: BackupDeps,
    private readonly file: string
  ) {
    const saved = readJson<Partial<BackupFile>>(file, {})
    const vfs = deps.store.db.backup
    this.state = {
      ...emptyState(),
      ...(vfs ? { enabled: vfs.enabled, sourceDir: vfs.sourceDir, folderName: vfs.folderName } : {}),
      ...saved,
      folders: saved.folders ?? {},
      entries: saved.entries ?? {},
      skipped: { ...(vfs?.skipped ?? {}), ...(saved.skipped ?? {}) }
    }
    const vfsRootId = vfs?.rootFolderId ?? null
    const vfsRoot = vfsRootId ? deps.store.node(vfsRootId) : undefined
    if (vfsRootId && vfsRoot && vfsRoot.kind === 'folder' && !vfsRoot.trashed) {
      this.state.rootFolderId = vfsRootId
    } else if (!this.state.rootFolderId && vfsRootId) {
      this.state.rootFolderId = vfsRootId
    }
    this.state.token = this.state.sourceDir ? sourceToken(this.state.sourceDir) : this.state.token
  }

  /** Publica la configuración en la VFS para que viaje en el índice de Telegram. */
  private publishMeta(): void {
    try {
      const changed = this.deps.store.setBackupMeta(
        this.state.enabled || this.state.rootFolderId
          ? {
              enabled: this.state.enabled,
              sourceDir: this.state.sourceDir,
              folderName: this.state.folderName,
              rootFolderId: this.state.rootFolderId,
              token: this.state.token,
              skipped: this.state.skipped
            }
          : null
      )
      if (changed) this.deps.refresh()
    } catch {
      /* no bloquear el respaldo */
    }
  }

  info(): BackupInfo {
    return {
      enabled: this.state.enabled,
      sourceDir: this.state.sourceDir,
      folderName: this.state.folderName,
      rootFolderId: this.state.rootFolderId,
      running: this.running,
      paused: this.paused,
      uploading: this.uploading,
      sourceValid: !this.state.enabled || this.validSource(),
      files: Object.keys(this.state.entries).length,
      skipped: Object.keys(this.state.skipped ?? {}).length,
      currentFile: this.currentFile,
      currentIndex: this.currentIndex,
      currentTotal: this.currentTotal,
      currentProgress: this.currentProgress,
      currentSpeed: this.currentSpeed,
      currentEta: this.currentEta,
      lastScanAt: this.state.lastScanAt,
      lastError: this.state.lastError
    }
  }

  start(): void {
    if (this.disposed) return
    this.stopWatch()
    this.reconcile()
    if (!this.state.enabled) {
      this.emitInfo()
      return
    }
    if (!this.validSource()) {
      this.state.lastError = 'La carpeta de respaldo no existe o no es válida'
      this.save(true)
    }
    this.ensureWatcher()
    this.interval = setInterval(() => this.schedule(0), SCAN_INTERVAL_MS)
    this.emitInfo()
    if (this.validSource()) this.schedule(1200)
  }

  private ensureWatcher(): void {
    if (this.watcher || this.disposed || !this.validSource()) return
    try {
      const watcher = watch(this.state.sourceDir, { recursive: true }, () => this.schedule())
      watcher.on('error', () => {
        try {
          watcher.close()
        } catch {
          /* ignore */
        }
        if (this.watcher === watcher) this.watcher = null
      })
      this.watcher = watcher
    } catch {
      this.state.lastError = 'No se pudo vigilar la carpeta; se usará el escaneo periódico'
      this.save(true)
    }
  }

  configure(input: { enabled: boolean; sourceDir: string; folderName: string }): void {
    this.generation += 1
    const nextName = input.folderName || (input.sourceDir ? basename(input.sourceDir) : '')
    const previousSource = this.state.sourceDir
    const sourceChanged =
      Boolean(input.sourceDir) &&
      normalizePath(this.state.sourceDir) !== normalizePath(input.sourceDir)
    const previousName = this.state.folderName
    const wasEnabled = this.state.enabled

    this.state.enabled = input.enabled
    this.state.sourceDir = input.sourceDir
    this.state.folderName = nextName
    this.state.token = sourceToken(input.sourceDir)
    if (input.enabled && (!wasEnabled || sourceChanged)) this.paused = false

    if (sourceChanged) {
      // Si había otra fuente, la carpeta anterior deja de ser el respaldo.
      if (previousSource) this.deps.store.setBackupRoot(null)
      this.state.rootFolderId = null
      this.state.folders = {}
      this.state.entries = {}
      this.state.skipped = {}
      this.state.lastScanAt = undefined
    } else if (this.state.rootFolderId && nextName && nextName !== previousName) {
      const root = this.deps.store.node(this.state.rootFolderId)
      if (root && root.kind === 'folder' && !root.trashed) {
        try {
          const renamed = this.deps.store.rename(root.id, nextName)
          this.state.folderName = renamed.name
          this.requestRefresh(true)
        } catch {
          /* si no se puede renombrar, se conserva el nombre actual */
        }
      }
    }

    this.state.lastError = undefined
    this.save(true)
    this.start()
    this.requestRefresh(true)
  }

  /** Reaplica la marca de respaldo y publica la configuración en la VFS. */
  private reconcile(): void {
    if (this.state.rootFolderId) {
      const root = this.deps.store.node(this.state.rootFolderId)
      if (root && root.kind === 'folder' && !root.trashed) {
        if (!root.backup || root.backupToken !== this.state.token) {
          this.deps.store.setBackupRoot(root.id, this.state.token)
        }
      }
    }
    this.publishMeta()
  }

  runNow(): void {
    this.paused = false
    this.schedule(0)
  }

  pause(): void {
    if (!this.state.enabled) return
    this.paused = true
    if (this.debounce) {
      clearTimeout(this.debounce)
      this.debounce = null
    }
    // Si hay un archivo en curso se termina; el lote se detiene después.
    this.emitInfo()
  }

  resume(): void {
    if (!this.state.enabled) return
    this.paused = false
    this.emitInfo()
    // Si el lote aún está terminando el archivo actual, `sync` verá `running`
    // y encolará otro pase; si ya se detuvo, arranca de inmediato.
    this.schedule(0)
  }

  /** Cancela el lote actual: termina/aborta el archivo en curso y no sigue. */
  cancel(): void {
    if (!this.state.enabled) return
    this.cancelRequested = true
    this.paused = false
    if (this.debounce) {
      clearTimeout(this.debounce)
      this.debounce = null
    }
    this.emitInfo()
    if (!this.running) {
      this.cancelRequested = false
      this.emitProgress('error', true, 'Cancelado')
    }
  }

  isCancelled(): boolean {
    return this.cancelRequested || this.disposed
  }

  /** Vuelve a respaldar los archivos que se habían omitido por borrarlos a mano. */
  resetSkipped(): void {
    this.state.skipped = {}
    this.save(true)
    this.publishMeta()
    this.emitInfo()
    this.schedule(0)
  }

  /** Al restaurar desde la papelera, el respaldo vuelve a gestionar esos archivos. */
  noteRestored(ids: string[]): void {
    if (!this.state.rootFolderId || !this.state.skipped) return
    const affected: VfsNode[] = []
    for (const id of ids) {
      const node = this.deps.store.node(id)
      if (!node) continue
      affected.push(node, ...this.deps.store.descendants(node.id))
    }
    let changed = false
    for (const node of affected) {
      if (node.kind !== 'file') continue
      const rel = this.relPathOf(node)
      if (!rel) continue
      if (this.state.skipped[rel]) {
        delete this.state.skipped[rel]
        changed = true
      }
    }
    if (changed) {
      this.save(true)
      this.publishMeta()
      this.emitInfo()
    }
  }

  /**
   * Registra archivos del respaldo que el usuario borró desde la app para no
   * volver a subirlos (mientras sigan con el mismo contenido).
   */
  noteDeleted(ids: string[]): void {
    if (!this.state.rootFolderId) return
    const rootId = this.state.rootFolderId
    const affected: VfsNode[] = []
    for (const id of ids) {
      const node = this.deps.store.node(id)
      if (!node || node.id === rootId) continue
      if (!this.relPathOf(node)) continue
      affected.push(node, ...this.deps.store.descendants(node.id))
    }
    if (affected.length === 0) return

    let changed = false
    for (const node of affected) {
      if (node.kind !== 'file') continue
      const rel = this.relPathOf(node)
      if (!rel) continue
      const entry = this.state.entries[rel]
      const sha256 = node.storage?.sha256 ?? entry?.sha256
      if (!sha256) continue
      this.state.skipped = {
        ...(this.state.skipped ?? {}),
        [rel]: { size: node.size, mtimeMs: entry?.mtimeMs ?? 0, sha256 }
      }
      if (entry) {
        delete this.state.entries[rel]
        changed = true
      }
    }

    if (changed || affected.some((node) => node.kind === 'file')) {
      this.save(true)
      this.publishMeta()
      this.emitInfo()
    }
  }

  private relPathOf(node: VfsNode): string | null {
    const rootId = this.state.rootFolderId
    if (!rootId) return null
    const parts: string[] = []
    let cursor: VfsNode | undefined = node
    const guard = new Set<string>()
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id)
      if (cursor.id === rootId) return parts.length > 0 ? parts.join('/') : null
      parts.unshift(cursor.name)
      cursor = cursor.parentId ? this.deps.store.node(cursor.parentId) : undefined
    }
    return null
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.stopWatch()
  }

  private stopWatch(): void {
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {
        /* ignore */
      }
      this.watcher = null
    }
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.debounce) {
      clearTimeout(this.debounce)
      this.debounce = null
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private schedule(delay = DEBOUNCE_MS): void {
    if (!this.state.enabled || this.disposed || this.paused) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.sync()
    }, delay)
  }

  private async sync(): Promise<void> {
    if (this.disposed || !this.state.enabled || this.paused) return
    if (this.running) {
      this.queued = true
      return
    }
    if (!this.validSource()) {
      this.state.lastError = 'La carpeta de respaldo no existe o no es válida'
      this.save(true)
      this.emitInfo()
      return
    }

    this.running = true
    const generation = this.generation
    this.state.lastError = undefined
    this.currentIndex = 0
    this.currentTotal = this.countPendingFiles(this.state.sourceDir, '')
    this.currentProgress = 0
    this.currentSpeed = 0
    this.currentEta = 0
    this.currentFile = undefined
    this.uploading = false
    this.cancelRequested = false
    this.emitInfo()
    try {
      this.ensureWatcher()
      const root = this.ensureRoot()
      await this.syncFolder(this.state.sourceDir, '', root, generation)
      if (this.generation === generation && !this.paused) {
        this.state.lastScanAt = Date.now()
      }
    } catch (err) {
      if (this.generation === generation) {
        this.state.lastError = err instanceof Error ? err.message : String(err)
      }
    } finally {
      this.running = false
      this.currentSpeed = 0
      this.currentEta = 0
      if (!this.paused) {
        this.currentProgress = 1
        this.currentIndex = this.currentTotal
      }
      this.save(true)
      // Solo avisar al panel si este pase subió algo de verdad. Un escaneo sin
      // cambios no debe aparecer como "respaldo en curso" ni re-subir el índice.
      if (this.cancelRequested) {
        this.emitProgress('error', true, 'Cancelado')
      } else if (this.uploading) {
        if (this.paused) this.emitProgress('paused', true)
        else if (this.state.lastError) this.emitProgress('error', true)
        else this.emitProgress('done', true)
      }
      this.uploading = false
      this.cancelRequested = false
      this.emitInfo()
      if (this.queued) {
        this.queued = false
        this.schedule(1500)
      }
    }
  }

  private countPendingFiles(dir: string, relDir: string): number {
    let total = 0
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const dirent of entries) {
      const abs = join(dir, dirent.name)
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        total += this.countPendingFiles(abs, rel)
        continue
      }
      if (!dirent.isFile()) continue
      const entry = this.state.entries[rel]
      const node = entry ? this.deps.store.node(entry.nodeId) : undefined
      let size: number
      let mtimeMs: number
      try {
        const fileStat = statSync(abs)
        size = fileStat.size
        mtimeMs = fileStat.mtimeMs
      } catch {
        continue
      }
      if (entry && node && !node.trashed && entry.size === size && entry.mtimeMs === mtimeMs) {
        continue
      }
      if (!entry && this.state.skipped?.[rel]) continue
      total += 1
    }
    return total
  }

  private countFiles(dir: string): number {
    let total = 0
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const dirent of entries) {
      if (dirent.isDirectory()) {
        total += this.countFiles(join(dir, dirent.name))
      } else if (dirent.isFile()) {
        total += 1
      }
    }
    return total
  }

  private async syncFolder(
    absDir: string,
    relDir: string,
    folderId: string,
    generation: number
  ): Promise<void> {
    if (this.disposed || this.generation !== generation) return
    let entries: Dirent[] = []
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of entries) {
      if (this.disposed || this.generation !== generation || this.paused) return
      if (this.cancelRequested) return
      const abs = join(absDir, dirent.name)
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        const childId = this.ensureFolder(relDir, dirent.name, folderId)
        await this.syncFolder(abs, rel, childId, generation)
      } else if (dirent.isFile()) {
        await this.syncFile(abs, rel, folderId, generation)
        if (this.paused || this.cancelRequested) return
      }
    }
  }

  private async syncFile(
    abs: string,
    rel: string,
    parentId: string,
    generation: number
  ): Promise<void> {
    if (this.generation !== generation) return
    let fileStat: ReturnType<typeof statSync>
    try {
      fileStat = statSync(abs)
    } catch {
      return
    }
    const entry = this.state.entries[rel]
    const node = entry ? this.deps.store.node(entry.nodeId) : undefined
    if (
      entry &&
      node &&
      !node.trashed &&
      entry.size === fileStat.size &&
      entry.mtimeMs === fileStat.mtimeMs
    ) {
      return
    }

    // Archivo realmente pendiente: cuenta para el X/Y del lote.
    this.currentIndex += 1
    this.currentFile = rel

    let hash: string
    try {
      hash = await fileSha256(abs)
    } catch {
      return
    }
    if (this.disposed || this.generation !== generation) return

    if (entry && node && !node.trashed && entry.sha256 === hash) {
      entry.size = fileStat.size
      entry.mtimeMs = fileStat.mtimeMs
      this.save()
      return
    }

    const skip = this.state.skipped?.[rel]
    if (!entry && skip && skip.sha256 === hash) {
      return
    }

    if (!entry) {
      // Manifiesto perdido (p. ej. perfil eliminado): adoptar el archivo que ya
      // está en la carpeta de respaldo en vez de volver a subirlo.
      const adopted = this.findExistingFile(parentId, basename(abs), fileStat.size, hash)
      if (adopted) {
        if (this.state.skipped?.[rel]) delete this.state.skipped[rel]
        this.state.entries[rel] = {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          sha256: hash,
          nodeId: adopted.id,
          parentId
        }
        this.requestRefresh()
        this.save()
        return
      }

      const renamed = this.findMissingByHash(hash, rel)
      if (renamed) {
        const previous = this.state.entries[renamed]
        const previousNode = this.deps.store.node(previous.nodeId)
        if (previousNode && !previousNode.trashed) {
          try {
            this.deps.store.moveTo([previous.nodeId], parentId)
            this.deps.store.rename(previous.nodeId, basename(abs))
            if (this.disposed || this.generation !== generation) return
            delete this.state.entries[renamed]
            if (this.state.skipped?.[rel]) delete this.state.skipped[rel]
            this.state.entries[rel] = {
              size: fileStat.size,
              mtimeMs: fileStat.mtimeMs,
              sha256: hash,
              nodeId: previous.nodeId,
              parentId
            }
            this.requestRefresh()
            this.save()
            return
          } catch {
            /* si no se puede mover, se sube una copia */
          }
        }
      }
    }

    const oldId = entry?.nodeId ?? null
    if (oldId) this.deps.store.trash([oldId])

    let created: string | null = null
    this.currentProgress = 0
    if (!this.uploading) {
      this.uploading = true
      this.emitProgress('uploading', true)
      this.emitInfo()
    }
    try {
      created = await this.deps.uploadFile(
        parentId,
        abs,
        hash,
        (progress, speed, eta) => {
          if (this.paused || this.cancelRequested) return
          this.currentProgress = progress
          if (speed !== undefined) this.currentSpeed = speed
          if (eta !== undefined) this.currentEta = eta
          this.emitProgress('uploading')
        },
        () => this.cancelRequested || this.disposed
      )
    } catch (err) {
      if (oldId) this.deps.store.restore([oldId])
      if (this.cancelRequested) {
        this.emitInfo()
        return
      }
      this.state.lastError = `No se pudo subir ${rel}: ${
        err instanceof Error ? err.message : String(err)
      }`
      this.save()
      this.emitInfo()
      return
    }
    if (!created) {
      if (oldId) this.deps.store.restore([oldId])
      return
    }
    if (this.disposed || this.generation !== generation) {
      try {
        await this.deps.deleteNodes([created])
      } catch {
        /* ignore */
      }
      if (oldId) this.deps.store.restore([oldId])
      return
    }
    if (oldId) {
      try {
        await this.deps.deleteNodes([oldId])
      } catch {
        /* el nodo viejo queda en la papelera; no bloquea el respaldo */
      }
    }
    if (this.disposed || this.generation !== generation) return

    if (this.state.skipped?.[rel]) {
      delete this.state.skipped[rel]
    }
    this.state.entries[rel] = {
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      sha256: hash,
      nodeId: created,
      parentId
    }
    this.requestRefresh()
    this.save()
  }

  /** Busca un archivo ya existente en la carpeta destino (mismo nombre y contenido). */
  private findExistingFile(
    parentId: string,
    name: string,
    size: number,
    hash: string
  ): VfsNode | undefined {
    const target = name.toLowerCase()
    return this.deps.store.children(parentId).find(
      (node) =>
        node.kind === 'file' &&
        node.name.toLowerCase() === target &&
        node.size === size &&
        (!node.storage?.sha256 || node.storage.sha256 === hash)
    )
  }

  /** Busca una entrada del manifiesto que ya no existe en disco pero tiene el mismo contenido. */
  private findMissingByHash(hash: string, newRel: string): string | null {
    for (const [rel, entry] of Object.entries(this.state.entries)) {
      if (rel === newRel || entry.sha256 !== hash) continue
      if (existsSync(join(this.state.sourceDir, ...rel.split('/')))) continue
      const node = this.deps.store.node(entry.nodeId)
      if (node && !node.trashed) return rel
    }
    return null
  }

  private validSource(): boolean {
    try {
      return Boolean(this.state.sourceDir) && statSync(this.state.sourceDir).isDirectory()
    } catch {
      return false
    }
  }

  private ensureRoot(): string {
    const current = this.state.rootFolderId
      ? this.deps.store.node(this.state.rootFolderId)
      : undefined
    if (current && current.kind === 'folder' && !current.trashed) {
      if (!current.backup) this.deps.store.setBackupRoot(current.id)
      return current.id
    }

    // Si la configuración se perdió (p. ej. al quitar/volver a iniciar sesión)
    // pero la carpeta sigue marcada en la VFS, la reutilizamos en vez de crear otra.
    const recovered =
      this.deps.store.db.nodes.find(
        (node) => node.kind === 'folder' && node.backup && !node.trashed
      ) ?? this.findAdoptableRoot()

    const folder =
      recovered ??
      this.deps.store.createFolder(
        null,
        this.state.folderName || basename(this.state.sourceDir) || 'Respaldo'
      )
    this.deps.store.setBackupRoot(folder.id, this.state.token)
    this.state.rootFolderId = folder.id
    this.state.folderName = folder.name
    this.state.folders = { '': folder.id }
    this.publishMeta()
    this.requestRefresh(true)
    this.save(true)
    this.emitInfo()
    return folder.id
  }

  /**
   * Busca una carpeta raíz existente que sea el respaldo pero se creó antes de
   * que existiera la marca (p. ej. "Respaldo" o "Respaldo (1)"). Prefiere la
   * que tenga más contenido para no adoptar una carpeta vacía recién creada.
   */
  private findAdoptableRoot(): VfsNode | undefined {
    const name = this.state.folderName.trim()
    if (!name) return undefined
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^${escaped}(?: \\(\\d+\\))?$`, 'i')
    const candidates = this.deps.store.db.nodes.filter(
      (node) =>
        node.kind === 'folder' &&
        !node.trashed &&
        node.parentId === null &&
        pattern.test(node.name)
    )
    if (candidates.length === 0) return undefined
    const contentCount = (folder: VfsNode): number =>
      this.deps.store.descendants(folder.id).filter((node) => node.kind === 'file' && !node.trashed)
        .length
    candidates.sort((a, b) => contentCount(b) - contentCount(a) || a.createdAt - b.createdAt)
    return candidates[0]
  }

  private ensureFolder(relParent: string, name: string, parentId: string): string {
    const key = relParent ? `${relParent}/${name}` : name
    const saved = this.state.folders[key]
    if (saved) {
      const node = this.deps.store.node(saved)
      if (node && node.kind === 'folder' && !node.trashed) return saved
    }
    // Adoptar una subcarpeta existente con el mismo nombre (manifiesto perdido).
    const target = name.toLowerCase()
    const existing = this.deps.store
      .children(parentId)
      .find((node) => node.kind === 'folder' && node.name.toLowerCase() === target)
    if (existing) {
      this.state.folders[key] = existing.id
      this.save(true)
      return existing.id
    }
    const folder = this.deps.store.createFolder(parentId, name)
    this.state.folders[key] = folder.id
    this.requestRefresh()
    this.save(true)
    return folder.id
  }

  /** Agrupa los avisos a la UI para no re-renderizar por cada archivo. */
  private requestRefresh(immediate = false): void {
    if (this.disposed) return
    if (immediate) {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer)
        this.refreshTimer = null
      }
      this.deps.refresh()
      return
    }
    if (this.refreshTimer) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      if (!this.disposed) this.deps.refresh()
    }, 800)
  }

  /** Escribe el manifiesto como máximo cada 2 s (y siempre al terminar un escaneo). */
  private save(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastSave < 2000) return
    this.lastSave = now
    try {
      writeJsonAtomic(this.file, this.state)
    } catch {
      /* no bloquear el respaldo por un fallo de disco */
    }
  }

  private emitInfo(): void {
    try {
      this.deps.emit(this.info())
    } catch {
      /* ignore */
    }
  }

  private emitProgress(
    status: BackupProgress['status'],
    force = false,
    error?: string
  ): void {
    if (this.paused && status !== 'paused') return
    const now = Date.now()
    if (!force && now - this.lastProgressAt < 250) return
    this.lastProgressAt = now
    try {
      this.deps.progress({
        name: this.currentFile ?? '',
        progress: this.currentProgress,
        status,
        index: this.currentIndex,
        total: this.currentTotal,
        speed: this.currentSpeed,
        eta: this.currentEta,
        detail: this.currentFile,
        error
      })
      this.emitInfo()
    } catch {
      /* ignore */
    }
  }
}
