import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  Profile,
  StorageRef,
  VfsBackupMeta,
  VfsDb,
  VfsNode,
  VfsSettings
} from '@shared/types'
import { profileDir } from './profiles'
import { readJson, writeJsonAtomic } from './fsutil'

export function defaultDb(): VfsDb {
  return {
    version: 1,
    revision: 0,
    nodes: [],
    settings: { theme: 'light', view: 'grid' }
  }
}

function sanitizeName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return clean.slice(0, 200) || 'Sin nombre'
}

/** Quita los prefijos internos y recorta la descripción para buscar. */
function cleanCaption(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  if (text.startsWith('TGPLUSDRIVE') || text.startsWith('TGPlusDrive Index')) return ''
  return text.slice(0, 500)
}

export class DriveStore {
  db: VfsDb
  private file: string

  constructor(public profile: Profile) {
    this.file = join(profileDir(profile.id), 'vfs.json')
    const loaded = readJson<VfsDb | null>(this.file, null)
    if (!loaded || !Array.isArray(loaded.nodes)) {
      this.db = defaultDb()
    } else {
      this.db = loaded
      this.db.version = this.db.version || 1
      this.db.revision = this.db.revision || 0
      this.db.settings = { ...defaultDb().settings, ...(this.db.settings || {}) }
    }
  }

  save(): void {
    this.db.revision += 1
    writeJsonAtomic(this.file, this.db)
  }

  state(): { profile: Profile; db: VfsDb } {
    return { profile: this.profile, db: this.db }
  }

  node(id: string): VfsNode | undefined {
    return this.db.nodes.find((n) => n.id === id)
  }

  children(parentId: string | null, opts: { trashed?: boolean } = {}): VfsNode[] {
    const trashed = opts.trashed ?? false
    return this.db.nodes
      .filter((n) => n.parentId === parentId && n.trashed === trashed)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
      })
  }

  descendants(id: string): VfsNode[] {
    const out: VfsNode[] = []
    const walk = (parentId: string): void => {
      for (const child of this.db.nodes.filter((n) => n.parentId === parentId)) {
        out.push(child)
        if (child.kind === 'folder') walk(child.id)
      }
    }
    walk(id)
    return out
  }

  ancestors(id: string): VfsNode[] {
    const out: VfsNode[] = []
    let current = this.node(id)
    while (current?.parentId) {
      current = this.node(current.parentId)
      if (!current) break
      out.unshift(current)
    }
    return out
  }

  uniqueName(parentId: string | null, name: string, excludeId?: string): string {
    const base = sanitizeName(name)
    const siblings = this.db.nodes.filter(
      (n) => n.parentId === parentId && n.id !== excludeId && !n.trashed
    )
    const taken = new Set(siblings.map((n) => n.name.toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let i = 1
    while (taken.has(`${stem} (${i})${ext}`.toLowerCase())) i += 1
    return `${stem} (${i})${ext}`
  }

  createFolder(parentId: string | null, name: string): VfsNode {
    if (parentId) {
      const parent = this.node(parentId)
      if (!parent || parent.kind !== 'folder') throw new Error('Carpeta destino no válida')
    }
    const now = Date.now()
    const node: VfsNode = {
      id: randomUUID(),
      parentId,
      kind: 'folder',
      name: this.uniqueName(parentId, name),
      size: 0,
      mime: 'folder',
      createdAt: now,
      updatedAt: now,
      starred: false,
      trashed: false
    }
    this.db.nodes.push(node)
    this.save()
    return node
  }

  addFile(
    parentId: string | null,
    input: { id?: string; name: string; size: number; mime: string; storage: StorageRef }
  ): VfsNode {
    if (parentId) {
      const parent = this.node(parentId)
      if (!parent || parent.kind !== 'folder') throw new Error('Carpeta destino no válida')
    }
    const now = Date.now()
    const node: VfsNode = {
      id: input.id ?? randomUUID(),
      parentId,
      kind: 'file',
      name: this.uniqueName(parentId, input.name),
      size: input.size,
      mime: input.mime,
      createdAt: now,
      updatedAt: now,
      starred: false,
      trashed: false,
      storage: input.storage
    }
    this.db.nodes.push(node)
    this.save()
    return node
  }

  upsertFile(
    parentId: string | null,
    input: { id: string; name: string; size: number; mime: string; storage: StorageRef }
  ): VfsNode {
    const existing = this.db.nodes.find((node) => node.id === input.id)
    if (!existing) return this.addFile(parentId, input)
    existing.parentId = parentId
    existing.name = input.name
    existing.size = input.size
    existing.mime = input.mime
    existing.storage = input.storage
    existing.updatedAt = Date.now()
    this.save()
    return existing
  }

  addManyFiles(
    inputs: Array<{
      id?: string
      name: string
      size: number
      mime: string
      createdAt?: number
      caption?: string
      storage: StorageRef
    }>
  ): number {
    const now = Date.now()
    const taken = new Set(
      this.db.nodes.filter((n) => n.parentId === null && !n.trashed).map((n) => n.name.toLowerCase())
    )
    let added = 0
    for (const input of inputs) {
      const base = sanitizeName(input.name)
      let name = base
      if (taken.has(name.toLowerCase())) {
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const ext = dot > 0 ? base.slice(dot) : ''
        let i = 1
        while (taken.has(`${stem} (${i})${ext}`.toLowerCase())) i += 1
        name = `${stem} (${i})${ext}`
      }
      taken.add(name.toLowerCase())
      this.db.nodes.push({
        id: input.id ?? randomUUID(),
        parentId: null,
        kind: 'file',
        name,
        size: input.size,
        mime: input.mime,
        createdAt: input.createdAt ?? now,
        updatedAt: input.createdAt ?? now,
        caption: input.caption,
        starred: false,
        trashed: false,
        storage: input.storage
      })
      added += 1
    }
    if (added > 0) this.save()
    return added
  }

  moveTo(ids: string[], targetId: string | null): number {
    if (targetId) {
      const target = this.node(targetId)
      if (!target || target.kind !== 'folder') throw new Error('Solo puedes mover a una carpeta')
    }
    let moved = 0
    const now = Date.now()
    for (const id of ids) {
      const node = this.node(id)
      if (!node || node.trashed) continue
      if (id === targetId) continue
      if (node.parentId === targetId) continue
      if (targetId && this.descendants(id).some((d) => d.id === targetId)) {
        throw new Error('No puedes mover una carpeta dentro de sí misma')
      }
      node.parentId = targetId
      node.name = this.uniqueName(targetId, node.name, id)
      node.updatedAt = now
      moved += 1
    }
    if (moved > 0) this.save()
    return moved
  }

  rename(id: string, name: string): VfsNode {
    const node = this.node(id)
    if (!node) throw new Error('Elemento no encontrado')
    node.name = this.uniqueName(node.parentId, name, id)
    node.updatedAt = Date.now()
    this.save()
    return node
  }

  trash(ids: string[]): void {
    for (const id of ids) {
      const node = this.node(id)
      if (!node) continue
      node.trashed = true
      node.updatedAt = Date.now()
      for (const child of this.descendants(id)) {
        child.trashed = true
        child.updatedAt = Date.now()
      }
    }
    this.save()
  }

  restore(ids: string[]): void {
    for (const id of ids) {
      const node = this.node(id)
      if (!node) continue
      const parentMissing = node.parentId && !this.node(node.parentId)
      node.parentId = parentMissing ? null : node.parentId
      node.trashed = false
      node.updatedAt = Date.now()
      for (const child of this.descendants(id)) {
        child.trashed = false
        child.updatedAt = Date.now()
      }
    }
    this.save()
  }

  deleteForever(ids: string[]): VfsNode[] {
    const removed: VfsNode[] = []
    const removeSet = new Set<string>()
    for (const id of ids) {
      const node = this.node(id)
      if (!node) continue
      removeSet.add(id)
      for (const child of this.descendants(id)) removeSet.add(child.id)
    }
    this.db.nodes = this.db.nodes.filter((n) => {
      if (removeSet.has(n.id)) {
        removed.push(n)
        return false
      }
      return true
    })
    this.save()
    return removed
  }

  setStarred(id: string, starred: boolean): VfsNode {
    const node = this.node(id)
    if (!node) throw new Error('Elemento no encontrado')
    node.starred = starred
    node.updatedAt = Date.now()
    this.save()
    return node
  }

  /** Marca una única carpeta como raíz del respaldo (y limpia marcas anteriores). */
  setBackupRoot(id: string | null, token?: string): boolean {
    let changed = false
    for (const node of this.db.nodes) {
      const should = node.kind === 'folder' && node.id === id
      if (should) {
        const nextToken = token ?? node.backupToken
        if (!node.backup || node.backupToken !== nextToken) {
          node.backup = true
          node.backupToken = nextToken
          node.updatedAt = Date.now()
          changed = true
        }
      } else if (node.backup || node.backupToken) {
        node.backup = false
        node.backupToken = undefined
        node.updatedAt = Date.now()
        changed = true
      }
    }
    if (changed) this.save()
    return changed
  }

  setBackupMeta(meta: VfsBackupMeta | null): boolean {
    const current = this.db.backup
    if (!meta && !current) return false
    if (meta && current && JSON.stringify(meta) === JSON.stringify(current)) return false
    this.db.backup = meta ?? undefined
    this.save()
    return true
  }

  setView(view: VfsSettings['view']): void {
    this.db.settings.view = view
    this.save()
  }

  setTheme(theme: VfsSettings['theme']): void {
    this.db.settings.theme = theme
    this.save()
  }

  setIndex(messageId: number | undefined): void {
    this.db.index = { updatedAt: Date.now(), messageId }
    this.save()
  }

  fixImageMimes(guess: (name: string) => string): number {
    let changed = 0
    for (const node of this.db.nodes) {
      if (node.kind !== 'file') continue
      if (node.mime && node.mime !== 'application/octet-stream') continue
      const mime = guess(node.name)
      if (mime !== 'application/octet-stream') {
        node.mime = mime
        changed += 1
      }
    }
    if (changed > 0) this.save()
    return changed
  }

  applyMessageDates(dates: Map<number, number>): number {
    let changed = 0
    for (const node of this.db.nodes) {
      const messageId = node.storage?.messageId
      if (!messageId) continue
      const date = dates.get(messageId)
      if (!date || date <= 0) continue
      if (node.createdAt !== date) {
        node.createdAt = date
        node.updatedAt = date
        changed += 1
      }
    }
    if (changed > 0) this.save()
    return changed
  }

  /** Guarda la descripción (caption) de Telegram en los nodos indicados. */
  applyCaptions(captions: Map<number, string>): number {
    let changed = 0
    for (const node of this.db.nodes) {
      const messageId = node.storage?.messageId
      if (!messageId) continue
      const raw = captions.get(messageId)
      if (raw === undefined) continue
      const caption = cleanCaption(raw)
      if (!caption) continue
      if (node.caption !== caption) {
        node.caption = caption
        changed += 1
      }
    }
    if (changed > 0) this.save()
    return changed
  }

  replaceFromRemote(remote: Partial<VfsDb>): void {
    this.db.nodes = remote.nodes ?? []
    this.db.settings = { ...defaultDb().settings, ...(remote.settings || {}) }
    this.db.backup = remote.backup
    this.db.revision = remote.revision ?? 0
    this.db.index = { updatedAt: Date.now() }
    writeJsonAtomic(this.file, this.db)
  }

  usedBytes(): number {
    return this.db.nodes
      .filter((n) => n.kind === 'file' && !n.trashed)
      .reduce((acc, n) => acc + n.size, 0)
  }
}
