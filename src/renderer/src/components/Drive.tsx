import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BackupInfo,
  DriveState,
  DuplicateAction,
  PendingUpload,
  ScanProgress,
  UploadAnalysis,
  UploadAnalysisFile,
  UpdateInfo,
  UploadProgress,
  VfsNode
} from '@shared/types'
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Scissors,
  Clock,
  Download,
  Eye,
  FolderPlus,
  FolderSync,
  FolderX,
  HardDrive,
  Heart,
  LayoutGrid,
  List,
  Loader2,
  LogOut,
  Moon,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Search,
  Star,
  Sun,
  Power,
  ArrowUp,
  CloudUpload,
  PackageOpen,
  Trash2,
  Upload,
  User,
  UserPlus,
  Wrench,
  X
} from 'lucide-react'
import { categoryOf, FileIcon, isImageNode, type BackupState } from './FileIcon'
import { ImageViewer } from './ImageViewer'
import { Logo } from './Logo'
import { formatDate, formatSize, initials, searchScore } from '../utils'

type Section = 'drive' | 'recent' | 'starred' | 'trash'

interface Props {
  state: DriveState
  onExit: () => void
  onLogout: () => void
  onAddAccount?: () => void
  transfers?: UploadProgress[]
  onCancelTransfer?: (id: string, kind: 'upload' | 'download', wholeBatch?: boolean) => void
  onClearTransfers?: () => void
  transfersOpen?: boolean
  onToggleTransfers?: () => void
}

interface MenuState {
  x: number
  y: number
  ids: string[]
}

type ModalState =
  | { type: 'new-folder' }
  | { type: 'rename'; id: string; name: string }
  | { type: 'confirm-forever'; ids: string[] }
  | { type: 'backup-delete'; ids: string[]; permanent: boolean; step?: 1 | 2 }
  | { type: 'confirm-scan' }
  | null

const DRAG_TYPE = 'application/x-tgplus-nodes'

function compareNodes(
  a: VfsNode,
  b: VfsNode,
  sortBy: 'date' | 'name' | 'size',
  sortDir: 'desc' | 'asc'
): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  // La carpeta de respaldo automático siempre va primero (anclada).
  if (a.kind === 'folder' && !a.trashed && !b.trashed) {
    const pinnedA = a.backup ? 0 : 1
    const pinnedB = b.backup ? 0 : 1
    if (pinnedA !== pinnedB) return pinnedA - pinnedB
  }
  const dir = sortDir === 'desc' ? -1 : 1
  if (sortBy === 'name') {
    return dir * a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  }
  if (sortBy === 'size') {
    if (a.kind === 'folder') {
      return dir * a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    }
    return dir * ((a.size ?? 0) - (b.size ?? 0))
  }
  return dir * ((a.createdAt ?? 0) - (b.createdAt ?? 0))
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return h + ' h ' + m + ' min'
  if (m > 0) return m + ' min ' + s + ' s'
  return s + ' s'
}

const storageCategories = [
  { key: 'video', label: 'Videos', color: 'bg-rose-500' },
  { key: 'image', label: 'Imágenes', color: 'bg-emerald-500' },
  { key: 'audio', label: 'Audio', color: 'bg-violet-500' },
  { key: 'archive', label: 'Archivos', color: 'bg-amber-500' },
  { key: 'text', label: 'Texto', color: 'bg-blue-500' },
  { key: 'other', label: 'Otros', color: 'bg-slate-400' }
] as const

export function Drive({
  state,
  onExit,
  onLogout,
  onAddAccount,
  transfers = [],
  onCancelTransfer,
  onClearTransfers,
  transfersOpen = false,
  onToggleTransfers
}: Props): JSX.Element {
  const { profile, db } = state
  const activeItems = transfers.filter(
    (item) => item.status === 'uploading' || item.status === 'queued'
  )
  const activeTransfers = activeItems.length
  const transferProgress =
    activeItems.length === 0
      ? 0
      : activeItems.reduce((sum, item) => sum + item.progress, 0) / activeItems.length
  const [section, setSection] = useState<Section>('drive')
  const [currentFolder, setCurrentFolder] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video' | 'text' | 'archive' | 'audio'>('all')
  const [clipboard, setClipboard] = useState<{ ids: string[]; action: 'cut' } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [renderLimit, setRenderLimit] = useState(120)
  const [cacheInfo, setCacheInfo] = useState<{ total: number } | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const marqueeStart = useRef<{ x: number; y: number } | null>(null)
  const justMarqueed = useRef(false)
  const [preview, setPreview] = useState<VfsNode | null>(null)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [scanning, setScanning] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [discardTarget, setDiscardTarget] = useState<PendingUpload | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [splitPrompt, setSplitPrompt] = useState<{
    parentId: string | null
    analysis: UploadAnalysis
    actions?: Record<string, DuplicateAction>
  } | null>(null)
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    parentId: string | null
    analysis: UploadAnalysis
  } | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [autoStart, setAutoStart] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [autoStartBusy, setAutoStartBusy] = useState(false)
  const toastTimer = useRef<number | null>(null)
  const dragDepth = useRef(0)
  const autoScrollTimer = useRef<number | null>(null)

  const theme = db.settings.theme
  const view = db.settings.view

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    let alive = true
    void window.api.drive
      .cacheStats()
      .then((stats) => {
        if (alive) setCacheInfo({ total: stats.total })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void window.api.backup
      .info()
      .then((info) => {
        if (alive) setBackupInfo(info)
      })
      .catch(() => undefined)
    const off = window.api.backup.onState((info) => setBackupInfo(info))
    return () => {
      alive = false
      off()
    }
  }, [])

  const clearCache = async (): Promise<void> => {
    setClearingCache(true)
    try {
      const res = await window.api.drive.clearCache()
      showToast(`Caché liberada: ${formatSize(res.freed)}`)
      const stats = await window.api.drive.cacheStats()
      setCacheInfo({ total: stats.total })
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setClearingCache(false)
    }
  }

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void window.api.drive
        .pendingUploads()
        .then((list) => {
          if (alive) setPending(list)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 8000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const discardPending = async (item: PendingUpload): Promise<void> => {
    setDiscarding(true)
    try {
      await window.api.drive.discardUpload(item.nodeId)
      setPending(await window.api.drive.pendingUploads())
      showToast('Subida descartada')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setDiscarding(false)
      setDiscardTarget(null)
    }
  }

  const resumePending = async (nodeId: string): Promise<void> => {
    try {
      await window.api.drive.resumeUpload(nodeId)
      setPending(await window.api.drive.pendingUploads())
      showToast('Subida reanudada')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    return window.api.events.onScanProgress((progress) => {
      setScan(progress)
      if (progress.phase === 'done') {
        setScanning(false)
        window.setTimeout(() => setScan(null), 6000)
      }
    })
  }, [])

  useEffect(() => {
    if (currentFolder && !db.nodes.some((n) => n.id === currentFolder && !n.trashed)) {
      setCurrentFolder(null)
    }
  }, [db.nodes, currentFolder])

  useEffect(() => {
    const backupOn = Boolean(backupInfo?.enabled)
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA'].includes(target.tagName)
      if (event.key === 'Escape' && !typing) {
        setSelected([])
        setMenu(null)
        setPreview(null)
        setDropTarget(null)
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && selected.length) {
        if (backupOn && selected.some((id) => isBackupRootNode(id))) {
          backupProtectedToast()
        } else if (section === 'trash') {
          if (selected.some((id) => isInsideBackup(id))) {
            setModal({ type: 'backup-delete', ids: selected, permanent: true, step: 1 })
          } else {
            setModal({ type: 'confirm-forever', ids: selected })
          }
        } else if (selected.some((id) => isInsideBackup(id))) {
          setModal({ type: 'backup-delete', ids: selected, permanent: false })
        } else {
          void runAction(() => window.api.drive.trash(selected)).then(() => setSelected([]))
        }
      }
      if (event.key === 'F2' && !typing && selected.length === 1) {
        const node = db.nodes.find((n) => n.id === selected[0])
        if (node) setModal({ type: 'rename', id: node.id, name: node.name })
      }
      if ((event.ctrlKey || event.metaKey) && !typing) {
        if (event.key === 'x' && selected.length) {
          event.preventDefault()
          cut(selected)
        } else if (event.key === 'v') {
          event.preventDefault()
          paste()
        }
      }
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [selected, db.nodes, section, currentFolder, backupInfo])

  const nodeById = useMemo(() => {
    const map = new Map<string, VfsNode>()
    for (const node of db.nodes) map.set(node.id, node)
    return map
  }, [db.nodes])

  const sessionNodes = useMemo(() => {
    if (query.trim()) {
      const q = query.trim()
      return db.nodes
        .filter((n) => !n.trashed && searchScore(n.name, q) >= 0)
        .sort((a, b) => {
          const scoreDiff = searchScore(a.name, q) - searchScore(b.name, q)
          return scoreDiff !== 0 ? scoreDiff : compareNodes(a, b, sortBy, sortDir)
        })
    }
    if (section === 'trash') {
      return db.nodes
        .filter((n) => n.trashed && (!n.parentId || !nodeById.get(n.parentId)?.trashed))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
          return b.updatedAt - a.updatedAt
        })
    }
    if (section === 'starred') {
      return db.nodes
        .filter((n) => !n.trashed && n.starred)
        .sort((a, b) => compareNodes(a, b, sortBy, sortDir))
    }
    if (section === 'recent') {
      return db.nodes
        .filter((n) => !n.trashed && n.kind === 'file')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 100)
    }
    if (typeFilter !== 'all') {
      const filtered = db.nodes.filter((n) => {
        if (n.trashed) return false
        if (n.kind === 'folder') return true
        const cat = categoryOf(n)
        if (typeFilter === 'image') return cat === 'image'
        if (typeFilter === 'video') return cat === 'video'
        if (typeFilter === 'text') return cat === 'doc' || cat === 'code' || cat === 'pdf' || cat === 'sheet'
        if (typeFilter === 'archive') return cat === 'archive'
        if (typeFilter === 'audio') return cat === 'audio'
        return true
      })
      return filtered.sort((a, b) => compareNodes(a, b, sortBy, sortDir))
    }

    const nodes = db.nodes.filter((n) => n.parentId === currentFolder && !n.trashed)
    return nodes.sort((a, b) => compareNodes(a, b, sortBy, sortDir))
  }, [db.nodes, section, currentFolder, query, nodeById, sortBy, sortDir, typeFilter])

  useEffect(() => {
    setRenderLimit(120)
  }, [section, currentFolder, query, typeFilter, sortBy, sortDir])

  const visibleNodes = useMemo(
    () => sessionNodes.slice(0, renderLimit),
    [sessionNodes, renderLimit]
  )
  const hasMore = sessionNodes.length > visibleNodes.length

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const isInsideBackup = (id: string): boolean => {
    let cursor = nodeById.get(id)
    const guard = new Set<string>()
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id)
      if (cursor.backup) return true
      cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined
    }
    return false
  }
  const isBackupRootNode = (id: string): boolean => Boolean(nodeById.get(id)?.backup)
  const backupActive = Boolean(backupInfo?.enabled || db.backup?.enabled)
  const backupProtectedToast = (): void =>
    showToast(
      'La carpeta de respaldo está protegida. Desactiva el respaldo automático para modificarla.'
    )
  const markedBackupRoot = db.nodes.find(
    (node) => node.kind === 'folder' && node.backup && !node.trashed
  )
  const metaBackupRoot = db.backup?.rootFolderId
    ? db.nodes.find((node) => node.id === db.backup?.rootFolderId && !node.trashed)
    : undefined
  const backupRootId =
    backupInfo?.rootFolderId ?? metaBackupRoot?.id ?? markedBackupRoot?.id ?? null
  const backupRootExists = Boolean(
    backupRootId && db.nodes.some((node) => node.id === backupRootId && !node.trashed)
  )
  const currentFolderNode = currentFolder ? nodeById.get(currentFolder) : undefined
  const insideBackup = Boolean(
    section === 'drive' &&
      currentFolder &&
      (currentFolder === backupRootId || currentFolderNode?.backup)
  )
  // Verde = sincronizada; ámbar = en pausa; gris/desconectado = apagada o la
  // carpeta local no está disponible.
  const backupState: BackupState =
    !backupInfo?.enabled || !backupInfo.sourceValid
      ? 'off'
      : backupInfo.paused
        ? 'paused'
        : 'synced'

  const breadcrumbs = useMemo(() => {
    const chain: VfsNode[] = []
    let cursor = currentFolder ? nodeById.get(currentFolder) : undefined
    while (cursor) {
      chain.unshift(cursor)
      cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined
    }
    return chain
  }, [currentFolder, nodeById])

  const used = useMemo(
    () => db.nodes.filter((n) => n.kind === 'file' && !n.trashed).reduce((sum, n) => sum + n.size, 0),
    [db.nodes]
  )

  const usedByCategory = useMemo(() => {
    const totals: Record<string, number> = { image: 0, video: 0, audio: 0, archive: 0, text: 0, other: 0 }
    for (const n of db.nodes) {
      if (n.kind !== 'file' || n.trashed) continue
      const cat = categoryOf(n)
      if (cat === 'image') totals.image += n.size
      else if (cat === 'video') totals.video += n.size
      else if (cat === 'audio') totals.audio += n.size
      else if (cat === 'archive' || cat === 'file') totals.archive += n.size
      else if (cat === 'doc' || cat === 'code' || cat === 'pdf' || cat === 'sheet') totals.text += n.size
      else totals.other += n.size
    }
    return totals
  }, [db.nodes])

  const showToast = (message: string): void => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }

  const runAction = async (action: () => Promise<unknown>, success?: string): Promise<void> => {
    try {
      await action()
      if (success) showToast(success)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  const navigate = (folderId: string | null): void => {
    setSection('drive')
    setCurrentFolder(folderId)
    setSelected([])
    setQuery('')
  }

  const playNative = async (node: VfsNode, audioOnly = false): Promise<void> => {
    try {
      const res = await window.api.drive.playNativeFile({
        id: node.id,
        audioOnly
      })
      if (!res.played) {
        showToast(res.error || 'No se pudo abrir el reproductor')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  const openNode = (node: VfsNode): void => {
    if (node.trashed) return
    if (node.kind === 'folder') {
      navigate(node.id)
      return
    }
    const category = categoryOf(node)
    if (category === 'video' || category === 'audio') {
      void playNative(node, category === 'audio')
      return
    }
    if (category === 'image') {
      setPreview(node)
      return
    }
    // No multimedia: la única acción es descargar (con diálogo de guardar).
    download([node.id])
  }

  const startNodeDrag = (event: React.DragEvent, node: VfsNode): void => {
    if (node.trashed) {
      event.preventDefault()
      return
    }
    const ids = selectedSet.has(node.id) && selected.length > 1 ? selected : [node.id]
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
    event.dataTransfer.effectAllowed = 'move'
  }

  const readDragIds = (event: React.DragEvent): string[] => {
    try {
      const raw = event.dataTransfer.getData(DRAG_TYPE)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
    } catch {
      return []
    }
  }

  const dropInto = (event: React.DragEvent, targetId: string | null): void => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
    event.preventDefault()
    event.stopPropagation()
    setDropTarget(null)
    const ids = readDragIds(event)
    if (ids.length === 0) return
    void runAction(() => window.api.drive.move(ids, targetId), 'Elementos movidos')
    setSelected([])
  }

  const dragTargetProps = (
    key: string,
    targetId: string | null
  ): {
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
  } => ({
    onDragOver: (event) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(key)
    },
    onDragLeave: (event) => {
      event.stopPropagation()
      setDropTarget((current) => (current === key ? null : current))
    },
    onDrop: (event) => dropInto(event, targetId)
  })

  const handleSelect = (node: VfsNode, event: React.MouseEvent): void => {
    event.stopPropagation()
    // El menú contextual detenía la propagación, así que el clic normal no
    // llegaba al listener global: se cierra aquí explícitamente.
    setMenu(null)
    if (node.trashed) {
      setSelected([node.id])
      return
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((prev) =>
        prev.includes(node.id) ? prev.filter((id) => id !== node.id) : [...prev, node.id]
      )
    } else {
      setSelected([node.id])
    }
  }

  const openMenu = (event: React.MouseEvent, node: VfsNode): void => {
    event.preventDefault()
    event.stopPropagation()
    const ids =
      selectedSet.has(node.id) && selected.length > 1 ? selected : [node.id]
    setSelected(ids)
    const width = 220
    const height = 260
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - width - 8),
      y: Math.min(event.clientY, window.innerHeight - height - 8),
      ids
    })
  }

  const download = (ids: string[]): void => {
    const nodes = ids.map((id) => nodeById.get(id)).filter((n): n is VfsNode => Boolean(n))
    if (nodes.length === 0) {
      showToast('Selecciona al menos un archivo o carpeta para descargar')
      return
    }
    // El proceso principal expande las carpetas conservando su estructura.
    void runAction(() => window.api.drive.download(nodes.map((node) => node.id)))
  }

  const restoreToPc = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    try {
      const result = await window.api.drive.restoreToDisk({ ids })
      if (!result) {
        showToast('Restauración cancelada')
        return
      }
      showToast(
        result.failed > 0
          ? `Restaurado en ${result.destination} · ${result.failed} archivo(s) con error`
          : `Restaurado en ${result.destination}`
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (!settingsOpen) return
    let alive = true
    void window.api.app
      .autoStart()
      .then((state) => {
        if (alive) setAutoStart(state)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [settingsOpen])

  const toggleAutoStart = async (): Promise<void> => {
    if (autoStartBusy) return
    setAutoStartBusy(true)
    try {
      const next = await window.api.app.setAutoStart(!(autoStart?.enabled ?? false))
      setAutoStart({ supported: next.supported, enabled: next.enabled })
      if (next.error) showToast(next.error)
      else showToast(next.enabled ? 'Se abrirá al iniciar Windows' : 'Ya no se abrirá al iniciar')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setAutoStartBusy(false)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setUpdateOpen(true)
    setUpdateBusy(true)
    try {
      setUpdateInfo(await window.api.app.checkForUpdates())
    } catch (err) {
      setUpdateInfo({
        current: '',
        latest: null,
        hasUpdate: false,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setUpdateBusy(false)
    }
  }

  const cancelBackup = async (): Promise<void> => {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      setBackupInfo(await window.api.backup.cancel())
      showToast('Respaldo cancelado')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setBackupBusy(false)
    }
  }

  const toggleBackupPause = async (): Promise<void> => {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      const next = backupInfo?.paused
        ? await window.api.backup.resume()
        : await window.api.backup.pause()
      setBackupInfo(next)
      showToast(next.paused ? 'Respaldo en pausa' : 'Respaldo reanudado')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setBackupBusy(false)
    }
  }

  const toggleStar = (ids: string[]): void => {
    const nodes = ids.map((id) => nodeById.get(id)).filter(Boolean) as VfsNode[]
    if (!nodes.length) return
    const shouldStar = !nodes.every((n) => n.starred)
    for (const node of nodes) {
      if (node.starred !== shouldStar) void window.api.drive.star(node.id)
    }
    showToast(shouldStar ? 'Añadido a destacados' : 'Quitado de destacados')
  }

  const cut = (ids: string[]): void => {
    setClipboard({ ids, action: 'cut' })
    setSelected([])
    showToast('Cortado. Usa Ctrl+V para pegar')
  }

  const paste = (targetId?: string | null): void => {
    if (!clipboard || clipboard.ids.length === 0) return
    const target = targetId !== undefined ? targetId : section === 'drive' ? currentFolder : null
    void runAction(() => window.api.drive.move(clipboard.ids, target), 'Pegado')
    if (clipboard.action === 'cut') setClipboard(null)
    setSelected([])
  }

  const uploadOptions = (
    analysis: UploadAnalysis,
    actions?: Record<string, DuplicateAction>
  ): { actions?: Record<string, DuplicateAction>; hashes: Record<string, string> } => {
    const hashes: Record<string, string> = {}
    for (const file of analysis.files) {
      if (file.sha256) hashes[file.path] = file.sha256
    }
    return { actions, hashes }
  }

  const proceedUpload = (
    parentId: string | null,
    analysis: UploadAnalysis,
    actions?: Record<string, DuplicateAction>
  ): void => {
    if (analysis.needsSplit) {
      setSplitPrompt({ parentId, analysis, actions })
      return
    }
    const paths = analysis.files.map((file) => file.path)
    void runAction(() =>
      window.api.drive.uploadPaths(parentId, paths, uploadOptions(analysis, actions))
    )
  }

  const startUpload = (parentId: string | null, paths: string[]): void => {
    if (paths.length === 0) return
    void window.api.drive
      .analyzeUpload(paths)
      .then((analysis) => {
        if (analysis.files.some((file) => file.duplicates.length > 0)) {
          setDuplicatePrompt({ parentId, analysis })
          return
        }
        proceedUpload(parentId, analysis)
      })
      .catch(() => {
        void runAction(() => window.api.drive.uploadPaths(parentId, paths))
      })
  }

  const uploadTo = async (parentId: string | null): Promise<void> => {
    if (section !== 'drive') {
      setSection('drive')
      setCurrentFolder(parentId)
    }
    try {
      const paths = await window.api.drive.pickUpload()
      if (paths.length > 0) startUpload(parentId, paths)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  const onDrop = (event: React.DragEvent): void => {
    dragDepth.current = 0
    setDragging(false)
    if (autoScrollTimer.current) {
      window.clearInterval(autoScrollTimer.current)
      autoScrollTimer.current = null
    }
    if (event.dataTransfer.types.includes(DRAG_TYPE)) {
      dropInto(event, section === 'drive' ? currentFolder : null)
      return
    }
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    const paths = files
      .map((file) => window.api.getPathForFile(file))
      .filter((p): p is string => Boolean(p))
    if (paths.length === 0) return
    const parentId = section === 'drive' ? currentFolder : null
    if (section !== 'drive') {
      setSection('drive')
      setCurrentFolder(parentId)
    }
    startUpload(parentId, paths)
  }

  const syncIndex = async (): Promise<void> => {
    setSyncing(true)
    try {
      await window.api.drive.syncIndex()
      showToast('Índice sincronizado en Mensajes guardados')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  const saveRecoveryTool = async (): Promise<void> => {
    try {
      const res = await window.api.drive.saveRecoveryTool()
      if (res.saved) showToast('Herramienta de recuperación guardada')
      else if (res.error) showToast(res.error)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  const runScan = async (): Promise<void> => {
    setScanning(true)
    setScan({ phase: 'scanning', scanned: 0, added: 0 })
    try {
      const result = await window.api.drive.scan()
      showToast(
        result.added > 0
          ? `${result.added} archivo(s) indexado(s) desde Telegram`
          : 'No se encontraron archivos nuevos'
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
      setScan(null)
      setScanning(false)
    }
  }

  const title =
    query.trim()
      ? `Resultados para “${query.trim()}”`
      : section === 'drive'
        ? currentFolder
          ? nodeById.get(currentFolder)?.name ?? 'Mi unidad'
          : 'Mi unidad'
        : section === 'recent'
          ? 'Recientes'
          : section === 'starred'
            ? 'Destacados'
            : 'Papelera'

  const emptyMessage =
    section === 'trash'
      ? 'La papelera está vacía'
      : section === 'starred'
        ? 'Aún no has destacado nada'
        : section === 'recent'
          ? 'No hay archivos recientes'
          : query.trim()
            ? 'Sin resultados'
            : 'Arrastra archivos aquí o usa “Subir”'

  return (
    <div className="gd-app-bg flex h-full w-full bg-gd-bg text-gd-text dark:bg-[#12141a] dark:text-slate-100">
      <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-slate-200/70 bg-gd-bg px-3 py-3 sm:w-64 dark:border-white/10 dark:bg-[#12141a]">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <div className="flex items-center gap-2 px-2 pb-4">
          <Logo className="h-10 w-10" />
          <span className="text-lg font-semibold tracking-tight">
            TGPlus<span className="text-gd-blue">Drive</span>
          </span>
        </div>

        <button
          onClick={() => setModal({ type: 'new-folder' })}
          className="mb-4 flex items-center gap-3 self-start rounded-2xl bg-white dark:bg-[#20242b] px-5 py-3 text-sm font-medium shadow-card hover:shadow-md transition-shadow"
        >
          <Plus className="h-5 w-5 text-gd-blue" /> Nueva carpeta
        </button>

        <nav className="space-y-0.5">
          <NavItem
            icon={<HardDrive className="h-4 w-4" />}
            label="Mi unidad"
            active={section === 'drive' && !query}
            onClick={() => navigate(null)}
          />
          <NavItem
            icon={<Clock className="h-4 w-4" />}
            label="Recientes"
            active={section === 'recent' && !query}
            onClick={() => {
              setSection('recent')
              setQuery('')
              setSelected([])
            }}
          />
          <NavItem
            icon={<Star className="h-4 w-4" />}
            label="Destacados"
            active={section === 'starred' && !query}
            onClick={() => {
              setSection('starred')
              setQuery('')
              setSelected([])
            }}
          />
          <NavItem
            icon={<Trash2 className="h-4 w-4" />}
            label="Papelera"
            active={section === 'trash' && !query}
            onClick={() => {
              setSection('trash')
              setQuery('')
              setSelected([])
            }}
          />
          <button
            onClick={() => setBackupOpen(true)}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
          >
            <FolderSync className="h-4 w-4" />
            Respaldo automático
            {backupInfo?.enabled && (
              <span
                className={`ml-auto h-2 w-2 rounded-full ${
                  backupInfo.paused
                    ? 'bg-amber-500'
                    : backupInfo.uploading
                      ? 'animate-pulse bg-amber-500'
                      : 'bg-emerald-500'
                }`}
                title={
                  backupInfo.paused
                    ? 'En pausa'
                    : backupInfo.uploading
                      ? 'Sincronizando…'
                      : 'Activo'
                }
              />
            )}
          </button>
        </nav>

        <div className="mt-4 px-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Almacenamiento</span>
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {formatSize(used)}
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            {storageCategories.map(({ key, color }) => {
              const size = usedByCategory[key] ?? 0
              if (size === 0 || used === 0) return null
              return (
                <div
                  key={key}
                  className={`h-full ${color}`}
                  style={{ width: `${(size / used) * 100}%` }}
                />
              )
            })}
          </div>
          <div className="mt-3 space-y-1.5">
            {storageCategories.map(({ key, label, color }) => {
              const size = usedByCategory[key] ?? 0
              if (size === 0) return null
              const pct = used > 0 ? (size / used) * 100 : 0
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 text-[11px]"
                  title={`${label}: ${formatSize(size)} (${pct.toFixed(1)}% del total)`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
                  <span className="flex-1 text-slate-500 dark:text-slate-400">{label}</span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">{formatSize(size)}</span>
                  <span className="w-9 text-right text-slate-400">{pct.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            Ilimitado · Mensajes guardados
          </p>
          {profile.provider === 'telegram' && (
            <button
              onClick={() => setModal({ type: 'confirm-scan' })}
              disabled={scanning}
              className="group mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-gd-blue to-blue-600 px-3 py-2.5 text-xs font-semibold text-white shadow-md shadow-blue-500/25 transition-all hover:shadow-lg hover:shadow-blue-500/35 hover:brightness-110 disabled:opacity-60"
            >
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="h-4 w-4 transition-transform group-hover:scale-110" />
              )}
              {scanning ? 'Escaneando Telegram…' : 'Escanear Telegram'}
            </button>
          )}
        </div>

        <div className="mt-3 shrink-0">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 p-3 ring-1 ring-slate-200/70 dark:from-white/[0.06] dark:to-white/[0.02] dark:ring-white/10">
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-sm font-semibold text-white shadow-md">
                {initials(profile.name)}
                <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500 dark:border-[#171a20]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-slate-800 dark:text-slate-100">
                  {profile.name}
                </p>
                <p className="truncate text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                  Cuenta de Telegram conectada
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={onAddAccount}
                title="Añadir otra cuenta de Telegram"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition-all hover:bg-slate-50 hover:shadow dark:bg-white/10 dark:text-slate-100 dark:ring-white/10 dark:hover:bg-white/15"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0" />
                Añadir cuenta
              </button>
              <button
                onClick={onLogout}
                title="Cerrar sesión de esta cuenta"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500/10 px-2 py-2 text-[11px] font-semibold text-red-600 ring-1 ring-red-500/20 transition-all hover:bg-red-500/20 dark:text-red-400"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                Cerrar sesión
              </button>
            </div>

            <button
              onClick={onExit}
              title="Cambiar de perfil"
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white/60 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
            >
              <User className="h-3 w-3" />
              Cambiar de perfil
            </button>
          </div>

        </div>
        </div>

        {/* Crédito y donación siempre visibles, fuera del área con scroll. */}
        <div className="mt-2 shrink-0 border-t border-slate-200/70 pt-2.5 dark:border-white/10">
          <button
            onClick={() => void window.api.app.openDonation()}
            title="Apoyar el proyecto con una donación voluntaria (PayPal)"
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 px-3 py-2 text-[11px] font-semibold text-white shadow-md shadow-amber-500/25 ring-1 ring-amber-300/60 transition-all hover:shadow-lg hover:shadow-amber-500/35 hover:brightness-105 active:scale-[0.98] dark:ring-amber-300/30"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Heart className="h-3.5 w-3.5 shrink-0 fill-white/90 drop-shadow-sm transition-transform group-hover:scale-110" />
            Apoyar el proyecto
          </button>
          <p className="mt-2 text-center text-[10px] text-slate-500 dark:text-slate-400">
            Hecho con <span className="text-[11px] leading-none text-rose-500">♥</span> por{' '}
            <span className="font-bold tracking-wide text-gd-blue">Jatniel</span>
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 bg-gd-bg px-3 py-3 dark:bg-[#12141a] sm:gap-4 sm:px-6">
          <div className="relative mx-auto w-full max-w-2xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar en tu unidad"
              className="w-full rounded-full bg-[#e9eef6] dark:bg-[#20242b] py-2.5 pl-11 pr-4 text-sm text-slate-700 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#262b33] focus:shadow-card transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onToggleTransfers}
              title="Transferencias activas (cargas y descargas)"
              className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-slate-200 dark:hover:bg-white/10 ${
                transfersOpen
                  ? 'bg-blue-100 text-gd-blue dark:bg-blue-500/20'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {activeTransfers > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
                  viewBox="0 0 36 36"
                  fill="none"
                >
                  <circle
                    cx="18"
                    cy="18"
                    r="16"
                    stroke="currentColor"
                    strokeOpacity="0.18"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="16"
                    stroke="#1a73e8"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={`${(transferProgress * 100.5).toFixed(2)} 100.5`}
                    className="transition-[stroke-dasharray] duration-300 ease-out"
                  />
                </svg>
              )}
              <ArrowDownToLine className="relative h-5 w-5" />
              {activeTransfers > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gd-blue px-1 text-[9px] font-bold text-white">
                  {activeTransfers}
                </span>
              )}
            </button>
            {profile.provider === 'telegram' && (
              <button
                onClick={syncIndex}
                disabled={syncing}
                title="Sincronizar índice en Mensajes guardados"
                className="rounded-full p-2 text-sky-600 transition-colors hover:bg-sky-100 dark:text-sky-400 dark:hover:bg-sky-500/15"
              >
                {syncing ? (
                  <RefreshCw className="h-4.5 w-4.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-5 w-5" />
                )}
              </button>
            )}
            <button
              onClick={() => void checkUpdates()}
              title="Buscar actualizaciones"
              className="relative rounded-full p-2 text-amber-600 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-500/15"
            >
              <PackageOpen className="h-5 w-5" />
              <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm ring-2 ring-gd-bg dark:ring-[#12141a]">
                <ArrowUp className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              title="Configuración"
              className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-white/10"
            >
              <Wrench className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex items-center gap-2 overflow-x-auto px-3 pb-2 pt-1 sm:gap-3 sm:px-6">
          {section === 'drive' && !query ? (
            <div className="flex min-w-0 items-center gap-1 text-sm">
              <button
                onClick={() => navigate(null)}
                {...dragTargetProps('crumb-root', null)}
                className={`rounded-md px-1.5 py-0.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10 ${
                  dropTarget === 'crumb-root' ? 'bg-blue-100 dark:bg-blue-500/20' : ''
                }`}
              >
                Mi unidad
              </button>
              {breadcrumbs.map((crumb) => (
                <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  <button
                    onClick={() => navigate(crumb.id)}
                    {...dragTargetProps(`crumb-${crumb.id}`, crumb.id)}
                    className={`inline-flex items-center gap-1 ellipsis max-w-[180px] rounded-md px-1.5 py-0.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 ${
                      dropTarget === `crumb-${crumb.id}` ? 'bg-blue-100 dark:bg-blue-500/20' : ''
                    }`}
                  >
                    {(crumb.id === backupRootId || crumb.backup) &&
                      (backupState === 'off' ? (
                        <FolderX className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                      ) : (
                        <FolderSync
                          className={`h-3.5 w-3.5 shrink-0 ${
                            backupState === 'paused'
                              ? 'text-amber-500 dark:text-amber-400'
                              : 'text-emerald-500 dark:text-emerald-400'
                          }`}
                        />
                      ))}
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <h2 className="text-base font-medium text-slate-700 dark:text-slate-200">{title}</h2>
          )}

          <div className="flex shrink-0 items-center gap-2">
            {section === 'drive' && !query && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1">
                  <span className="hidden sm:inline">Tipo:</span>
                  <select
                    value={typeFilter}
                    onChange={(e) =>
                      setTypeFilter(
                        e.target.value as 'all' | 'image' | 'video' | 'text' | 'archive' | 'audio'
                      )
                    }
                    className="rounded-full bg-[#e9eef6] dark:bg-[#20242b] px-2.5 py-1 text-xs text-slate-700 dark:text-slate-100 outline-none"
                  >
                    <option value="all">Todos</option>
                    <option value="image">Imágenes</option>
                    <option value="video">Videos</option>
                    <option value="audio">Audio</option>
                    <option value="text">Texto</option>
                    <option value="archive">Archivos</option>
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="hidden sm:inline">Ordenar por:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}
                    className="rounded-full bg-[#e9eef6] dark:bg-[#20242b] px-2.5 py-1 text-xs text-slate-700 dark:text-slate-100 outline-none"
                  >
                    <option value="date">Fecha de subida</option>
                    <option value="name">Nombre</option>
                    <option value="size">Peso</option>
                  </select>
                  <button
                    onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
                    className="rounded-full p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10"
                    title={sortDir === 'desc' ? 'Descendente' : 'Ascendente'}
                  >
                    {sortDir === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => void uploadTo(section === 'drive' ? currentFolder : null)}
              className="inline-flex items-center gap-1.5 rounded-full bg-gd-blue px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
            >
              <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Subir</span>
            </button>
            <button
              onClick={() => void window.api.drive.setView(view === 'grid' ? 'list' : 'grid')}
              title={view === 'grid' ? 'Vista de lista' : 'Vista de cuadrícula'}
              className="rounded-full p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
            >
              {view === 'grid' ? <List className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {selected.length > 0 && (
          <div className="pointer-events-auto fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-full bg-[#e8f0fe] px-3 py-2 text-sm shadow-2xl ring-1 ring-black/10 animate-fade-in dark:bg-[#20242b] dark:ring-white/20 sm:bottom-6 sm:gap-2 sm:px-4">
            <span className="font-medium text-blue-800 dark:text-blue-200">
              {selected.length} seleccionado{selected.length > 1 ? 's' : ''}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <IconAction
                icon={<Download className="h-4 w-4" />}
                label="Descargar"
                onClick={() => download(selected)}
              />
              <IconAction
                icon={<Star className="h-4 w-4" />}
                label="Destacar"
                onClick={() => toggleStar(selected)}
              />
              {selected.length === 1 && (
                <IconAction
                  icon={<Pencil className="h-4 w-4" />}
                  label="Renombrar"
                  onClick={() => {
                    const node = nodeById.get(selected[0])
                    if (node) setModal({ type: 'rename', id: node.id, name: node.name })
                  }}
                />
              )}
              {section === 'trash' ? (
                <>
                  <IconAction
                    icon={<RotateCcw className="h-4 w-4" />}
                    label="Restaurar"
                    onClick={() => {
                      void runAction(() => window.api.drive.restore(selected), 'Restaurado')
                      setSelected([])
                    }}
                  />
                  <IconAction
                    icon={<Trash2 className="h-4 w-4" />}
                    label="Eliminar"
                    danger
                    onClick={() => {
                      if (backupActive && selected.some((id) => isBackupRootNode(id))) {
                        backupProtectedToast()
                        return
                      }
                      setModal(
                        selected.some((id) => isInsideBackup(id))
                          ? { type: 'backup-delete', ids: selected, permanent: true, step: 1 }
                          : { type: 'confirm-forever', ids: selected }
                      )
                    }}
                  />
                </>
              ) : (
                <IconAction
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Mover a papelera"
                  onClick={() => {
                    if (backupActive && selected.some((id) => isBackupRootNode(id))) {
                      backupProtectedToast()
                      return
                    }
                    if (selected.some((id) => isInsideBackup(id))) {
                      setModal({ type: 'backup-delete', ids: selected, permanent: false, step: 1 })
                      return
                    }
                    void runAction(() => window.api.drive.trash(selected), 'Movido a la papelera')
                    setSelected([])
                  }}
                />
              )}
              {section === 'drive' && selected.some((id) => isInsideBackup(id)) && (
                <IconAction
                  icon={<HardDrive className="h-4 w-4" />}
                  label="Restaurar al PC"
                  onClick={() => void restoreToPc(selected)}
                />
              )}
              <IconAction icon={<X className="h-4 w-4" />} label="Cerrar" onClick={() => setSelected([])} />
            </div>
          </div>
        )}

        {insideBackup && (
          <div
            className={`mx-6 mb-3 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
              backupState === 'off'
                ? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200'
                : backupState === 'paused'
                  ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200'
            }`}
          >
            {backupState === 'off' ? (
              <FolderX className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <FolderSync className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {backupState === 'off'
                  ? 'Respaldo desconectado'
                  : backupState === 'paused'
                    ? 'Respaldo en pausa'
                    : 'Carpeta administrada por el respaldo automático'}
              </p>
              <p className="mt-0.5 text-xs opacity-90">
                {backupState === 'off'
                  ? 'El respaldo automático está desactivado o la carpeta de tu PC no está disponible. Los archivos que ves son los que ya estaban respaldados.'
                  : backupState === 'paused'
                    ? 'La sincronización está en pausa. Reanúdala desde Configurar o desde el panel de transferencias.'
                    : 'Los archivos nuevos o modificados de tu PC se suben aquí solos. Con el respaldo activo no se puede mover la carpeta ni sus archivos, y borrar un archivo pide confirmación dos veces.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => backupRootId && void restoreToPc([backupRootId])}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-300 transition-colors hover:bg-emerald-100 dark:bg-transparent dark:text-emerald-200 dark:ring-emerald-500/40 dark:hover:bg-emerald-500/15"
              >
                Restaurar al PC
              </button>
              <button
                onClick={() => setBackupOpen(true)}
                className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
              >
                Configurar
              </button>
            </div>
          </div>
        )}

        <main
          ref={mainRef}
          className="relative flex-1 overflow-y-auto px-6 pb-10"
          onClick={() => {
            if (justMarqueed.current) {
              justMarqueed.current = false
              return
            }
            setSelected([])
          }}
          onScroll={(event) => {
            const el = event.currentTarget
            if (!hasMore) return
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) {
              setRenderLimit((limit) => limit + 120)
            }
          }}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            const target = event.target as HTMLElement
            if (target.closest('.group')) return
            const rect = mainRef.current?.getBoundingClientRect()
            if (!rect) return
            const x = event.clientX - rect.left + (mainRef.current?.scrollLeft ?? 0)
            const y = event.clientY - rect.top + (mainRef.current?.scrollTop ?? 0)
            marqueeStart.current = { x, y }
            setMarquee({ x1: x, y1: y, x2: x, y2: y })
          }}
          onMouseMove={(event) => {
            if (!marqueeStart.current) return
            const rect = mainRef.current?.getBoundingClientRect()
            if (!rect) return
            const x = event.clientX - rect.left + (mainRef.current?.scrollLeft ?? 0)
            const y = event.clientY - rect.top + (mainRef.current?.scrollTop ?? 0)
            setMarquee((m) => m ? { ...m, x2: x, y2: y } : null)
          }}
          onMouseUp={() => {
            if (!marquee || !mainRef.current) {
              marqueeStart.current = null
              setMarquee(null)
              return
            }
            const rect = mainRef.current.getBoundingClientRect()
            const scrollLeft = mainRef.current.scrollLeft
            const scrollTop = mainRef.current.scrollTop
            const box = {
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              right: Math.max(marquee.x1, marquee.x2),
              bottom: Math.max(marquee.y1, marquee.y2)
            }
            const cards = Array.from(mainRef.current.querySelectorAll('.group'))
            const selectedIds: string[] = []
            for (const card of cards) {
              const r = card.getBoundingClientRect()
              const cardLeft = r.left - rect.left + scrollLeft
              const cardTop = r.top - rect.top + scrollTop
              const cardRight = cardLeft + r.width
              const cardBottom = cardTop + r.height
              if (cardLeft < box.right && cardRight > box.left && cardTop < box.bottom && cardBottom > box.top) {
                const id = card.getAttribute('data-id')
                if (id) selectedIds.push(id)
              }
            }
            const moved = box.right - box.left > 4 || box.bottom - box.top > 4
            if (moved && selectedIds.length) {
              setSelected(selectedIds)
              justMarqueed.current = true
            }
            marqueeStart.current = null
            setMarquee(null)
          }}
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            dragDepth.current += 1
            setDragging(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            if (!mainRef.current) return
            const rect = mainRef.current.getBoundingClientRect()
            const threshold = 60
            const speed = 12
            const y = event.clientY
            if (y < rect.top + threshold) {
              if (!autoScrollTimer.current) {
                autoScrollTimer.current = window.setInterval(() => {
                  if (mainRef.current) mainRef.current.scrollTop -= speed
                }, 16)
              }
            } else if (y > rect.bottom - threshold) {
              if (!autoScrollTimer.current) {
                autoScrollTimer.current = window.setInterval(() => {
                  if (mainRef.current) mainRef.current.scrollTop += speed
                }, 16)
              }
            } else {
              if (autoScrollTimer.current) {
                window.clearInterval(autoScrollTimer.current)
                autoScrollTimer.current = null
              }
            }
          }}
          onDragLeave={() => {
            dragDepth.current -= 1
            if (dragDepth.current <= 0) {
              dragDepth.current = 0
              setDragging(false)
            }
            if (autoScrollTimer.current) {
              window.clearInterval(autoScrollTimer.current)
              autoScrollTimer.current = null
            }
          }}
          onDrop={onDrop}
        >
          {sessionNodes.length === 0 ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <div className="h-20 w-20 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                {section === 'trash' ? (
                  <Trash2 className="h-9 w-9" />
                ) : section === 'starred' ? (
                  <Star className="h-9 w-9" />
                ) : (
                  <FolderPlus className="h-9 w-9" />
                )}
              </div>
              <p className="text-sm">{emptyMessage}</p>
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
              {visibleNodes.map((node) => {
                const isSelected = selectedSet.has(node.id)
                  const isBackup =
                    node.kind === 'folder' && (node.id === backupRootId || Boolean(node.backup))
                return (
                  <div
                    key={node.id}
                    data-id={node.id}
                    draggable={!node.trashed}
                    onDragStart={(event) => startNodeDrag(event, node)}
                    {...(node.kind === 'folder' && !node.trashed
                      ? dragTargetProps(node.id, node.id)
                      : {})}
                    onClick={(event) => handleSelect(node, event)}
                    onDoubleClick={() => openNode(node)}
                    onContextMenu={(event) => openMenu(event, node)}
                    title={`${node.name}${
                      node.kind === 'file' ? ` · ${formatSize(node.size)}` : ''
                    }${isBackup ? ' · Respaldo automático' : ''}`}
                    className={`group relative flex cursor-default select-none flex-col rounded-2xl border p-3 transition-colors ${
                      dropTarget === node.id
                        ? 'border-gd-blue bg-blue-50 dark:border-blue-500/60 dark:bg-blue-500/20'
                        : isSelected
                          ? 'border-blue-300 bg-[#e8f0fe] dark:border-blue-500/40 dark:bg-blue-500/15'
                          : isBackup
                            ? backupState === 'off'
                              ? 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
                              : backupState === 'paused'
                                ? 'border-amber-200/80 bg-amber-50/60 hover:bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/5 dark:hover:bg-amber-500/10'
                                : 'border-emerald-200/80 bg-emerald-50/60 hover:bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/5 dark:hover:bg-emerald-500/10'
                            : 'border-transparent hover:bg-slate-100 dark:hover:bg-white/5'
                    } ${clipboard?.action === 'cut' && clipboard.ids.includes(node.id) ? 'opacity-50' : ''}`}
                  >
                    <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-xl">
                      <NodeThumb
                        node={node}
                        size={56}
                        backup={isBackup}
                        backupState={backupState}
                      />
                      {isBackup && (
                        <span
                          title={
                            backupState === 'off'
                              ? 'Respaldo desconectado'
                              : backupState === 'paused'
                                ? 'Respaldo en pausa'
                                : 'Respaldo activo'
                          }
                          className={`absolute left-1 top-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-sm ring-1 ${
                            backupState === 'off'
                              ? 'bg-slate-100/95 text-slate-500 ring-slate-200 dark:bg-slate-500/20 dark:text-slate-300 dark:ring-slate-500/30'
                              : backupState === 'paused'
                                ? 'bg-amber-100/95 text-amber-700 ring-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/30'
                                : 'bg-emerald-100/95 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-500/30'
                          }`}
                        >
                          {backupState === 'off' ? (
                            <FolderX className="h-2.5 w-2.5" />
                          ) : (
                            <FolderSync className="h-2.5 w-2.5" />
                          )}
                          Respaldo
                        </span>
                      )}
                      {node.starred && (
                        <span className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 shadow-sm dark:bg-black/60">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        </span>
                      )}
                      {node.kind === 'file' && <ExtensionBadge name={node.name} />}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <FileIcon node={node} size={15} />
                      <span className="ellipsis flex-1 text-[13px] font-medium text-slate-700 dark:text-slate-200">
                        {node.name}
                      </span>
                      {node.starred && (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      )}
                      <button
                        onClick={(event) => openMenu(event, node)}
                        className="rounded-full p-1 text-slate-400 opacity-0 hover:bg-slate-200 dark:hover:bg-white/10 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                    {node.kind === 'file' && (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                        {formatSize(node.size)}
                        {node.storage?.parts && node.storage.parts.length > 1 && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            {node.storage.parts.length} partes
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
              <div className="grid grid-cols-[1fr_150px_140px_36px] items-center gap-2 bg-slate-50 dark:bg-white/5 px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Nombre</span>
                <span>Fecha</span>
                <span>Tamaño</span>
                <span />
              </div>
              <ul>
                {visibleNodes.map((node) => {
                  const isSelected = selectedSet.has(node.id)
                const isBackup =
                  node.kind === 'folder' && (node.id === backupRootId || Boolean(node.backup))
                  return (
                    <li
                      key={node.id}
                      data-id={node.id}
                      draggable={!node.trashed}
                      onDragStart={(event) => startNodeDrag(event, node)}
                      {...(node.kind === 'folder' && !node.trashed
                        ? dragTargetProps(node.id, node.id)
                        : {})}
                      onClick={(event) => handleSelect(node, event)}
                      onDoubleClick={() => openNode(node)}
                      onContextMenu={(event) => openMenu(event, node)}
                      title={`${node.name}${
                        node.kind === 'file' ? ` · ${formatSize(node.size)}` : ''
                      }${isBackup ? ' · Respaldo automático' : ''}`}
                      className={`group grid cursor-default select-none grid-cols-[1fr_150px_140px_36px] items-center gap-2 border-t border-slate-100 dark:border-white/5 px-4 py-2 text-sm transition-colors ${
                        dropTarget === node.id
                          ? 'bg-blue-50 dark:bg-blue-500/20'
                          : isSelected
                            ? 'bg-[#e8f0fe] dark:bg-blue-500/15'
                            : isBackup
                              ? backupState === 'off'
                                ? 'bg-slate-50/70 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10'
                                : backupState === 'paused'
                                  ? 'bg-amber-50/50 hover:bg-amber-50 dark:bg-amber-500/5 dark:hover:bg-amber-500/10'
                                  : 'bg-emerald-50/50 hover:bg-emerald-50 dark:bg-emerald-500/5 dark:hover:bg-emerald-500/10'
                              : 'hover:bg-slate-50 dark:hover:bg-white/5'
                      } ${clipboard?.action === 'cut' && clipboard.ids.includes(node.id) ? 'opacity-50' : ''}`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <FileIcon
                          node={node}
                          size={20}
                          backup={isBackup}
                          backupState={backupState}
                        />
                        <span className="ellipsis text-slate-700 dark:text-slate-200">{node.name}</span>
                        {node.kind === 'file' && <ExtensionBadge name={node.name} inline />}
                        {isBackup && (
                          <span
                            title={
                              backupState === 'off'
                                ? 'Respaldo desconectado'
                                : backupState === 'paused'
                                  ? 'Respaldo en pausa'
                                  : 'Respaldo activo'
                            }
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                              backupState === 'off'
                                ? 'bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-300'
                                : backupState === 'paused'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                            }`}
                          >
                            {backupState === 'off' ? (
                              <FolderX className="h-2.5 w-2.5" />
                            ) : (
                              <FolderSync className="h-2.5 w-2.5" />
                            )}
                            Respaldo
                          </span>
                        )}
                        {node.starred && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {formatDate(node.createdAt)}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {node.kind === 'folder' ? '—' : formatSize(node.size)}
                      </span>
                      <button
                        onClick={(event) => openMenu(event, node)}
                        className="rounded-full p-1 text-slate-400 opacity-0 hover:bg-slate-200 dark:hover:bg-white/10 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {marquee && (
            <div
              className="pointer-events-none absolute z-30 border border-gd-blue bg-blue-500/10"
              style={{
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1)
              }}
            />
          )}

          {dragging && (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-gd-blue bg-blue-50/80 dark:bg-blue-500/10 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-gd-blue">
                <Upload className="h-8 w-8" />
                <span className="text-sm font-medium">
                  Suelta para subir a {section === 'drive' && currentFolder ? title : 'Mi unidad'}
                </span>
              </div>
            </div>
          )}
        </main>
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          nodeById={nodeById}
          section={section}
          clipboard={clipboard}
          onClose={() => setMenu(null)}
          actions={{
            open: openNode,
            preview: (node) => setPreview(node),
            download,
            star: toggleStar,
            rename: (id) => {
              const node = nodeById.get(id)
              if (node) setModal({ type: 'rename', id, name: node.name })
            },
            trash: (ids) => {
              if (backupActive && ids.some((id) => isBackupRootNode(id))) {
                backupProtectedToast()
                return
              }
              if (ids.some((id) => isInsideBackup(id))) {
                setModal({ type: 'backup-delete', ids, permanent: false, step: 1 })
                return
              }
              void runAction(() => window.api.drive.trash(ids), 'Movido a la papelera')
              setSelected([])
            },
            restore: (ids) => {
              void runAction(() => window.api.drive.restore(ids), 'Restaurado')
              setSelected([])
            },
            deleteForever: (ids) => {
              if (backupActive && ids.some((id) => isBackupRootNode(id))) {
                backupProtectedToast()
                return
              }
              setModal(
                ids.some((id) => isInsideBackup(id))
                  ? { type: 'backup-delete', ids, permanent: true, step: 1 }
                  : { type: 'confirm-forever', ids }
              )
            },
            restoreToPc: (ids) => void restoreToPc(ids),
            cut,
            paste
          }}
        />
      )}

      {modal?.type === 'new-folder' && (
        <NameModal
          title="Nueva carpeta"
          placeholder="Carpeta sin título"
          confirmLabel="Crear"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void runAction(
              () => window.api.drive.createFolder(currentFolder, name),
              'Carpeta creada'
            )
            setModal(null)
          }}
        />
      )}

      {modal?.type === 'rename' && (
        <NameModal
          title="Renombrar"
          initial={modal.name}
          placeholder="Nombre"
          confirmLabel="Guardar"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void runAction(() => window.api.drive.rename(modal.id, name), 'Renombrado')
            setModal(null)
            setSelected([])
          }}
        />
      )}

      {modal?.type === 'confirm-forever' && (
        <ConfirmModal
          title="Eliminar definitivamente"
          message={`Se eliminarán ${modal.ids.length} elemento(s) de Telegram. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => {
            const ids = modal.ids
            setModal(null)
            setSelected([])
            void runAction(() => window.api.drive.deleteForever(ids), 'Eliminado definitivamente')
          }}
        />
      )}

      {modal?.type === 'backup-delete' && (
        <ConfirmModal
          title={modal.step === 2 ? 'Confirmar eliminación del respaldo' : 'Archivo de respaldo'}
          message={
            modal.step === 2
              ? `Última confirmación: se ${
                  modal.permanent ? 'eliminará definitivamente de Telegram' : 'moverá a la papelera'
                } ${modal.ids.length} archivo(s) del respaldo. No se volverá a subir mientras no cambie en tu PC.`
              : 'Este archivo pertenece a la carpeta de respaldo. Si lo borras, no se volverá a subir mientras no cambie en tu PC.'
          }
          confirmLabel={modal.step === 2 ? 'Sí, eliminar el respaldo' : 'Continuar'}
          cancelLabel={modal.step === 2 ? 'No, conservarlo' : 'Cancelar'}
          danger
          onClose={() => setModal(null)}
          onConfirm={() => {
            if (modal.step !== 2) {
              setModal({ ...modal, step: 2 })
              return
            }
            const ids = modal.ids
            const permanent = modal.permanent
            setModal(null)
            setSelected([])
            void runAction(
              () =>
                permanent
                  ? window.api.drive.deleteForever(ids)
                  : window.api.drive.trash(ids),
              permanent ? 'Eliminado definitivamente' : 'Movido a la papelera'
            )
          }}
        />
      )}

      {splitPrompt && (
        <SplitUploadModal
          analysis={splitPrompt.analysis}
          onClose={() => setSplitPrompt(null)}
          onConfirm={() => {
            const prompt = splitPrompt
            setSplitPrompt(null)
            void runAction(() =>
              window.api.drive.uploadPaths(
                prompt.parentId,
                prompt.analysis.files.map((file) => file.path),
                uploadOptions(prompt.analysis, prompt.actions)
              )
            )
          }}
        />
      )}

      {duplicatePrompt && (
        <DuplicateUploadModal
          files={duplicatePrompt.analysis.files}
          onClose={() => setDuplicatePrompt(null)}
          onConfirm={(actions) => {
            const prompt = duplicatePrompt
            setDuplicatePrompt(null)
            proceedUpload(prompt.parentId, prompt.analysis, actions)
          }}
        />
      )}

      {backupOpen && (
        <BackupModal
          info={backupInfo}
          onClose={() => setBackupOpen(false)}
          onChange={setBackupInfo}
          onToast={showToast}
          onOpenFolder={
            backupRootExists && backupRootId
              ? () => {
                  setBackupOpen(false)
                  navigate(backupRootId)
                }
              : undefined
          }
          onRestore={
            backupRootExists && backupRootId
              ? () => {
                  setBackupOpen(false)
                  void restoreToPc([backupRootId])
                }
              : undefined
          }
        />
      )}

      {updateOpen && (
        <UpdateModal
          info={updateInfo}
          busy={updateBusy}
          onClose={() => setUpdateOpen(false)}
          onRecheck={() => void checkUpdates()}
          onDownload={() => void window.api.app.openUrl('download')}
          onOpenRelease={() => void window.api.app.openUrl('release')}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          cacheInfo={cacheInfo}
          clearingCache={clearingCache}
          backupInfo={backupInfo}
          profileName={profile.name}
          autoStart={autoStart}
          autoStartBusy={autoStartBusy}
          onToggleAutoStart={() => void toggleAutoStart()}
          onClose={() => setSettingsOpen(false)}
          onToggleTheme={() =>
            void window.api.drive.setTheme(theme === 'dark' ? 'light' : 'dark')
          }
          onClearCache={() => void clearCache()}
          onOpenBackup={() => {
            setSettingsOpen(false)
            setBackupOpen(true)
          }}
          onCheckUpdates={() => {
            setSettingsOpen(false)
            void checkUpdates()
          }}
          onSaveRecovery={() => void saveRecoveryTool()}
          onDonate={() => void window.api.app.openDonation()}
        />
      )}

      {discardTarget && (
        <ConfirmModal
          title="Descartar subida"
          message={`Se borrarán de Telegram las ${discardTarget.uploadedParts} parte(s) ya subidas de "${discardTarget.name}" y se eliminará de la lista. Esta acción no se puede deshacer.`}
          confirmLabel={discarding ? 'Descartando…' : 'Descartar'}
          danger
          onClose={() => (discarding ? undefined : setDiscardTarget(null))}
          onConfirm={() => void discardPending(discardTarget)}
        />
      )}

      {modal?.type === 'confirm-scan' && (
        <ConfirmModal
          title="Escanear Mensajes guardados"
          message="TGPlusDrive recorrerá tu historial y añadirá a la unidad los archivos que ya tienes en Mensajes guardados. No se vuelve a subir nada a Telegram. Puede tardar unos minutos."
          confirmLabel={scanning ? 'Escaneando…' : 'Escanear'}
          onClose={() => setModal(null)}
          onConfirm={() => {
            setModal(null)
            void runScan()
          }}
        />
      )}

      {scan && (
        <div className="fixed bottom-5 left-5 z-40 w-72 animate-fade-in">
          <div className="rounded-2xl bg-white dark:bg-[#20242b] p-4 shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              {scan.phase === 'scanning' ? (
                <Loader2 className="h-4 w-4 animate-spin text-gd-blue" />
              ) : (
                <ScanSearch className="h-4 w-4 text-emerald-500" />
              )}
              {scan.phase === 'scanning' ? 'Escaneando Telegram…' : 'Escaneo completado'}
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {scan.scanned.toLocaleString('es')} mensajes revisados · {scan.added} nuevos
            </p>
            {scan.filter && (
              <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                Filtro: {scan.filter}
              </p>
            )}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div
                className={`h-full rounded-full bg-gd-blue ${
                  scan.phase === 'scanning' ? 'w-1/3 animate-pulse' : 'w-full'
                }`}
              />
            </div>
            {scan.error && (
              <p className="mt-2 text-[11px] text-red-500">{scan.error}</p>
            )}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="fixed bottom-5 left-5 z-40 w-80 animate-fade-in">
          <div className="rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-black/10 dark:bg-[#20242b] dark:ring-white/10">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Subidas incompletas
            </div>
            <ul className="mt-2 space-y-2">
              {pending.map((item) => {
                const pct = item.size > 0 ? Math.round((item.uploadedBytes / item.size) * 100) : 0
                return (
                  <li key={item.nodeId}>
                    <p className="ellipsis text-xs font-medium text-slate-700 dark:text-slate-200">
                      {item.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {item.uploadedParts} de {item.totalParts} partes · {pct}%
                    </p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        onClick={() => void resumePending(item.nodeId)}
                        className="rounded-lg bg-gd-blue px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
                      >
                        Reanudar
                      </button>
                      <button
                        onClick={() => setDiscardTarget(item)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                      >
                        Descartar
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm animate-fade-in"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex items-center gap-3 px-5 py-3 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <FileIcon node={preview} size={20} />
            <span className="ellipsis text-sm font-medium">{preview.name}</span>
            <span className="shrink-0 text-xs text-white/50">{formatSize(preview.size)}</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => download([preview.id])}
                title="Descargar"
                className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Download className="h-5 w-5" />
              </button>
              <button
                onClick={() => setPreview(null)}
                title="Cerrar"
                className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <PreviewImage node={preview} />
          </div>
        </div>
      )}

      {transfersOpen && (
        <div className="fixed right-3 top-16 z-50 w-[calc(100vw-1.5rem)] max-w-[380px] animate-fade-in sm:right-6">
          <div className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-[#20242b] dark:ring-white/10">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/10">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Transferencias
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {activeTransfers > 0
                    ? `${activeTransfers} en curso`
                    : 'No hay transferencias activas'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {activeItems.some((item) => item.batchId) && onCancelTransfer && (
                  <button
                    onClick={() => {
                      const batch =
                        activeItems.find((item) => item.status === 'uploading' && item.batchId) ??
                        activeItems.find((item) => item.batchId)
                      if (batch) onCancelTransfer(batch.id, batch.kind ?? 'upload', true)
                    }}
                    className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400"
                    title="Detener toda la cola de subida"
                  >
                    Detener todo
                  </button>
                )}
                {transfers.length > 0 && onClearTransfers && (
                  <button
                    onClick={onClearTransfers}
                    className="rounded-full px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
                  >
                    Limpiar
                  </button>
                )}
                <button
                  onClick={onToggleTransfers}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {transfers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <ArrowDownToLine className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Aquí verás las cargas y descargas en curso.
                </p>
              </div>
            ) : (
              <ul className="max-h-[420px] space-y-3 overflow-y-auto px-4 py-3">
                {transfers.map((item) => (
                  <li key={item.id}>
                    <div className="mb-1 flex items-center gap-2">
                      {item.status === 'done' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      ) : item.status === 'error' ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                      ) : item.status === 'paused' ? (
                        <Pause className="h-4 w-4 shrink-0 text-amber-500" />
                      ) : item.status === 'queued' ? (
                        <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                      ) : (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gd-blue" />
                      )}
                      <span className="ellipsis flex-1 text-xs text-slate-700 dark:text-slate-200">
                        <span className="mr-1 text-[9px] uppercase tracking-wide text-slate-400">
                          {item.status === 'paused'
                            ? 'En pausa'
                            : item.status === 'queued'
                              ? 'En cola'
                              : item.id.startsWith('backup:')
                                ? 'Respaldo'
                                : item.id.startsWith('restore:')
                                  ? 'Restaurando'
                                  : item.kind === 'download'
                                    ? 'Bajando'
                                    : 'Subiendo'}
                        </span>
                        {item.name}
                        {item.index && item.total ? (
                          <span className="ml-1 text-[10px] tabular-nums text-slate-400">
                            {item.index}/{item.total}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[10px] tabular-nums text-slate-400">
                        {item.status === 'error'
                          ? 'Error'
                          : item.status === 'done'
                            ? 'Listo'
                            : item.status === 'queued'
                              ? '—'
                              : `${Math.round(item.progress * 100)}%`}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${
                          item.status === 'error'
                            ? 'bg-red-500'
                            : item.status === 'done'
                              ? 'bg-emerald-500'
                              : item.status === 'paused'
                                ? 'bg-amber-500'
                                : item.status === 'queued'
                                  ? 'bg-slate-300 dark:bg-white/20'
                                  : 'bg-gd-blue'
                        }`}
                        style={{ width: `${Math.max(2, Math.round(item.progress * 100))}%` }}
                      />
                    </div>
                    {item.detail && item.detail !== item.name && (
                      <p className="mb-1 truncate text-[10px] text-slate-400" title={item.detail}>
                        {item.detail}
                      </p>
                    )}
                    <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-slate-400">
                      <span>
                        {item.speed ? `${formatSize(item.speed)}/s` : ''}
                        {item.speed && item.eta && item.eta > 1
                          ? ` · quedan ${formatDuration(item.eta)}`
                          : ''}
                        {!item.speed && item.size ? formatSize(item.size) : ''}
                      </span>
                      <div className="flex items-center gap-1">
                        {item.id.startsWith('backup:') && backupInfo?.enabled && (
                          <>
                            <button
                              onClick={() => void toggleBackupPause()}
                              disabled={backupBusy}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
                            >
                              {backupInfo?.paused || item.status === 'paused' ? (
                                <Play className="h-3 w-3" />
                              ) : (
                                <Pause className="h-3 w-3" />
                              )}
                              {backupInfo?.paused || item.status === 'paused'
                                ? 'Reanudar'
                                : 'Pausar'}
                            </button>
                            {item.status !== 'done' && item.status !== 'error' && (
                              <button
                                onClick={() => void cancelBackup()}
                                disabled={backupBusy}
                                className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                              >
                                <X className="h-3 w-3" />
                                Cancelar
                              </button>
                            )}
                          </>
                        )}
                        {(item.status === 'uploading' || item.status === 'queued') &&
                          !item.id.startsWith('backup:') &&
                          onCancelTransfer && (
                            <button
                              onClick={() => onCancelTransfer(item.id, item.kind ?? 'download')}
                              className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400"
                              title="Detener solo este archivo"
                            >
                              Detener
                            </button>
                          )}
                      </div>
                    </div>
                    {item.error && (
                      <p className="mt-1 text-[10px] text-red-500">{item.error}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
          <div className="rounded-full bg-slate-800 dark:bg-slate-100 px-4 py-2 text-sm text-white dark:text-slate-800 shadow-xl">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}

/** Extensión de archivo en minúsculas (máx. 4 letras) o null. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  const ext = name.slice(dot + 1).toLowerCase()
  if (!/^[a-z0-9]{1,6}$/.test(ext)) return null
  return ext
}

const EXT_STYLES: Record<string, string> = {
  video: 'bg-rose-500/90 text-white ring-rose-300/40',
  audio: 'bg-violet-500/90 text-white ring-violet-300/40',
  image: 'bg-emerald-500/90 text-white ring-emerald-300/40',
  archive: 'bg-amber-500/90 text-white ring-amber-300/40',
  doc: 'bg-blue-500/90 text-white ring-blue-300/40',
  code: 'bg-cyan-600/90 text-white ring-cyan-300/40'
}

const EXT_CATEGORY: Record<string, keyof typeof EXT_STYLES> = {
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', wmv: 'video',
  flv: 'video', m4v: 'video', mpg: 'video', mpeg: 'video', ts: 'video', m2ts: 'video',
  mp3: 'audio', ogg: 'audio', oga: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio',
  aac: 'audio', opus: 'audio', wma: 'audio', aiff: 'audio', mid: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
  svg: 'image', heic: 'image', avif: 'image', tif: 'image', tiff: 'image',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  bz2: 'archive', xz: 'archive', iso: 'archive', exe: 'archive', apk: 'archive',
  pdf: 'doc', doc: 'doc', docx: 'doc', txt: 'doc', md: 'doc', rtf: 'doc', epub: 'doc',
  xls: 'doc', xlsx: 'doc', csv: 'doc', ppt: 'doc', pptx: 'doc',
  js: 'code', tsx: 'code', jsx: 'code', json: 'code', html: 'code',
  css: 'code', py: 'code', rs: 'code', go: 'code', java: 'code', sh: 'code', xml: 'code'
}

function ExtensionBadge({
  name,
  inline = false
}: {
  name: string
  inline?: boolean
}): JSX.Element | null {
  const ext = extensionOf(name)
  if (!ext) return null
  const category = EXT_CATEGORY[ext] ?? 'doc'
  const style = EXT_STYLES[category]
  return (
    <span
      title={ext.toUpperCase()}
      className={`shrink-0 select-none rounded-[4px] px-1 py-[1px] text-[8px] font-bold uppercase leading-none tracking-wide ring-1 ${
        inline ? '' : 'absolute bottom-1 right-1 shadow-sm'
      } ${style}`}
    >
      {ext}
    </span>
  )
}

function NodeThumb({
  node,
  size,
  backup = false,
  backupState = 'synced'
}: {
  node: VfsNode
  size: number
  backup?: boolean
  backupState?: BackupState
}): JSX.Element {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const canThumb =
    node.kind === 'file' &&
    !node.trashed &&
    (isImageNode(node) ||
      node.mime.startsWith('video/') ||
      node.mime === 'application/pdf')

  // Solo reiniciar al cambiar de archivo. Si se reiniciara con updatedAt
  // (que cambia al marcar favorito), la imagen ya cargada nunca volvería a
  // disparar onLoad y la miniatura quedaría invisible hasta reiniciar.
  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [node.id])

  if (!canThumb || failed || node.kind === 'folder') {
    return <FileIcon node={node} size={size} backup={backup} backupState={backupState} />
  }

  return (
    <div className="relative h-full w-full">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <FileIcon node={node} size={size} />
        </div>
      )}
      <img
        src={`tgfile://thumb/${node.id}`}
        alt={node.name}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`h-full w-full rounded-lg object-cover transition-opacity duration-200 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}

function PreviewImage({ node }: { node: VfsNode }): JSX.Element {
  return <ImageViewer node={node} />
}

function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-full px-4 py-2 text-sm transition-colors ${
        active
          ? 'bg-gd-blueSoft font-medium text-gd-blueDark dark:bg-blue-500/25 dark:text-blue-100'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function IconAction({
  icon,
  label,
  onClick,
  danger
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`rounded-full p-2 transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-100 dark:hover:bg-red-950/50'
          : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-white/10'
      }`}
    >
      {icon}
    </button>
  )
}

function ContextMenu({
  menu,
  nodeById,
  section,
  clipboard,
  onClose,
  actions
}: {
  menu: MenuState
  nodeById: Map<string, VfsNode>
  section: Section
  clipboard: { ids: string[]; action: 'cut' } | null
  onClose: () => void
  actions: {
    open: (node: VfsNode) => void
    preview: (node: VfsNode) => void
    download: (ids: string[]) => void
    star: (ids: string[]) => void
    rename: (id: string) => void
    trash: (ids: string[]) => void
    restore: (ids: string[]) => void
    deleteForever: (ids: string[]) => void
    restoreToPc?: (ids: string[]) => void
    cut: (ids: string[]) => void
    paste: (targetId?: string | null) => void
  }
}): JSX.Element {
  const first = nodeById.get(menu.ids[0])
  const items: Array<{ label: string; icon: React.ReactNode; run: () => void; danger?: boolean }> = []
  const insideBackup = (node: VfsNode | undefined): boolean => {
    let cursor = node
    const guard = new Set<string>()
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id)
      if (cursor.backup) return true
      cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined
    }
    return false
  }

  if (menu.ids.length === 1 && first) {
    if (first.kind === 'file' && !first.trashed) {
      const cat = categoryOf(first)
      const multimedia = cat === 'image' || cat === 'video' || cat === 'audio'
      if (cat === 'image') {
        items.push({
          label: 'Vista previa',
          icon: <Eye className="h-4 w-4" />,
          run: () => actions.preview(first)
        })
      }
      if (multimedia) {
        items.push({
          label: 'Reproducir',
          icon: <Upload className="h-4 w-4 rotate-180" />,
          run: () => actions.open(first)
        })
      }
      items.push({
        label: 'Descargar',
        icon: <Download className="h-4 w-4" />,
        run: () => actions.download(menu.ids)
      })
    }
    if (first.kind === 'folder' && !first.trashed) {
      items.push({
        label: 'Descargar carpeta',
        icon: <Download className="h-4 w-4" />,
        run: () => actions.download(menu.ids)
      })
    }
    if (actions.restoreToPc && insideBackup(first)) {
      items.push({
        label: 'Restaurar al PC',
        icon: <HardDrive className="h-4 w-4" />,
        run: () => actions.restoreToPc?.(menu.ids)
      })
    }
    if (!first.trashed) {
      items.push({
        label: first.starred ? 'Quitar de destacados' : 'Añadir a destacados',
        icon: <Star className="h-4 w-4" />,
        run: () => actions.star(menu.ids)
      })
      items.push({
        label: 'Renombrar',
        icon: <Pencil className="h-4 w-4" />,
        run: () => actions.rename(first.id)
      })
    }
  }

  if (menu.ids.length > 1 && !first?.trashed) {
    items.push({
      label: 'Descargar selección',
      icon: <Download className="h-4 w-4" />,
      run: () => actions.download(menu.ids)
    })
  }
  if (menu.ids.length > 0 && !first?.trashed) {
    items.push({
      label: 'Cortar',
      icon: <Scissors className="h-4 w-4" />,
      run: () => actions.cut(menu.ids)
    })
  }
  if (clipboard && clipboard.ids.length > 0) {
    items.push({
      label: 'Pegar',
      icon: <ClipboardPaste className="h-4 w-4" />,
      run: () => {
        const node = first
        const target = node && node.kind === 'folder' ? node.id : undefined
        actions.paste(target)
      }
    })
  }

  if (section === 'trash') {
    items.push({
      label: 'Restaurar',
      icon: <RotateCcw className="h-4 w-4" />,
      run: () => actions.restore(menu.ids)
    })
    items.push({
      label: 'Eliminar definitivamente',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      run: () => actions.deleteForever(menu.ids)
    })
  } else {
    items.push({
      label: 'Mover a la papelera',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      run: () => actions.trash(menu.ids)
    })
  }

  return (
    <div
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-50 w-56 animate-fade-in overflow-hidden rounded-xl bg-white dark:bg-[#20242b] py-1.5 shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.run()
            onClose()
          }}
          className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
            item.danger
              ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}

function NameModal({
  title,
  initial = '',
  placeholder,
  confirmLabel,
  onClose,
  onSubmit
}: {
  title: string
  initial?: string
  placeholder: string
  confirmLabel: string
  onClose: () => void
  onSubmit: (name: string) => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dot = initial.lastIndexOf('.')
  const hasExt = dot > 0
  const ext = hasExt ? initial.slice(dot) : ''
  const stem = hasExt ? initial.slice(0, dot) : initial
  const [value, setValue] = useState(stem)
  const finalName = `${value.trim()}${ext}`

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (hasExt) input.setSelectionRange(0, stem.length)
    else input.select()
  }, [hasExt, stem.length])

  const invalid = /[\\/:*?"<>|]/.test(finalName)
  const submit = (): void => {
    if (!finalName.trim() || invalid) return
    onSubmit(finalName.trim())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#20242b] p-6 shadow-2xl animate-fade-in"
      >
        <h3 className="mb-4 text-lg font-medium text-slate-800 dark:text-slate-100">{title}</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus-within:border-gd-blue focus-within:ring-2 focus-within:ring-gd-blue/20 dark:border-white/10 dark:bg-black/20">
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={() => {
                const input = inputRef.current
                if (input && hasExt) input.setSelectionRange(0, value.length)
              }}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-slate-800 outline-none dark:text-slate-100"
            />
            {hasExt && (
              <span className="shrink-0 pr-3.5 font-mono text-xs text-slate-400 dark:text-slate-500">
                {ext}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {hasExt
              ? 'La extensión se conserva. Solo cambia el nombre.'
              : 'Escribe el nuevo nombre.'}
          </p>
          {invalid && (
            <p className="mt-1 text-[11px] text-red-500">
              El nombre no puede contener \ / : * ? " &lt; &gt; |
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!finalName.trim() || invalid}
              className="rounded-full bg-gd-blue px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SplitUploadModal({
  analysis,
  onClose,
  onConfirm
}: {
  analysis: UploadAnalysis
  onClose: () => void
  onConfirm: () => void
}): JSX.Element {
  const splitFiles = analysis.files.filter((file) => file.split)
  const limitLabel = analysis.premium ? '4 GB' : '2 GB'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl animate-fade-in dark:bg-[#20242b]"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">
              Este archivo se dividirá en partes
            </h3>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Tu cuenta {analysis.premium ? 'tiene Telegram Premium' : 'es gratuita'} y el límite por
          archivo es <b>{limitLabel}</b>. Los siguientes archivos superan ese límite y se subirán
          divididos en trozos de <b>{formatSize(analysis.partSize)}</b>:
        </p>

        <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3 dark:bg-white/5">
          {splitFiles.map((file) => (
            <li key={file.path} className="flex items-start gap-2 text-xs">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span className="min-w-0 flex-1">
                <span className="block break-all font-medium text-slate-700 dark:text-slate-200">
                  {file.name}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {formatSize(file.size)} · {file.parts} partes
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          En tu unidad aparecerá como un solo archivo. Junto a las partes se sube una herramienta
          (<b>Recuperar TGPlusDrive.html</b>) para unirlas sin la app. ¿Deseas continuar?
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="rounded-full bg-gd-blue px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
          >
            Subir en {splitFiles.reduce((sum, file) => sum + file.parts, 0)} partes
          </button>
        </div>
      </div>
    </div>
  )
}

function DuplicateUploadModal({
  files,
  onClose,
  onConfirm
}: {
  files: UploadAnalysisFile[]
  onClose: () => void
  onConfirm: (actions: Record<string, DuplicateAction>) => void
}): JSX.Element {
  const duplicated = files.filter((file) => file.duplicates.length > 0)
  const [actions, setActions] = useState<Record<string, DuplicateAction>>(() => {
    const initial: Record<string, DuplicateAction> = {}
    for (const file of duplicated) initial[file.path] = 'copy'
    return initial
  })

  const choose = (path: string, action: DuplicateAction): void => {
    setActions((prev) => ({ ...prev, [path]: action }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl animate-fade-in dark:bg-[#20242b]"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">
            Archivos duplicados
          </h3>
        </div>

        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Estos archivos ya existen en tu unidad con el <b>mismo contenido</b>. Elige qué hacer
          con cada uno:
        </p>

        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3 dark:bg-white/5">
          {duplicated.map((file) => {
            const action = actions[file.path] ?? 'copy'
            const match = file.duplicates[0]
            return (
              <li key={file.path} className="rounded-lg bg-white p-3 dark:bg-white/5">
                <div className="flex items-start gap-2">
                  <Copy className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-xs font-medium text-slate-700 dark:text-slate-200">
                      {file.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {formatSize(file.size)} · Ya existe: <b>{match.name}</b> en {match.path}
                      {file.duplicates.length > 1
                        ? ` (y ${file.duplicates.length - 1} más)`
                        : ''}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => choose(file.path, 'replace')}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                          action === 'replace'
                            ? 'bg-gd-blue text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300'
                        }`}
                      >
                        Sustituir
                      </button>
                      <button
                        onClick={() => choose(file.path, 'copy')}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                          action === 'copy'
                            ? 'bg-gd-blue text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300'
                        }`}
                      >
                        Subir copia
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <b>Sustituir</b> borra de Telegram todas las copias idénticas y deja solo la nueva.{" "}
          <b>Subir copia</b> mantiene todas.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(actions)}
            className="rounded-full bg-gd-blue px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsRow({
  icon,
  title,
  description,
  children
}: {
  icon: React.ReactNode
  title: string
  description?: string
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {children && <div className="shrink-0 self-center">{children}</div>}
    </div>
  )
}

function SettingsModal({
  theme,
  cacheInfo,
  clearingCache,
  backupInfo,
  profileName,
  autoStart,
  autoStartBusy,
  onToggleAutoStart,
  onClose,
  onToggleTheme,
  onClearCache,
  onOpenBackup,
  onCheckUpdates,
  onSaveRecovery,
  onDonate
}: {
  theme: 'light' | 'dark'
  cacheInfo: { total: number } | null
  clearingCache: boolean
  backupInfo: BackupInfo | null
  profileName: string
  autoStart: { supported: boolean; enabled: boolean } | null
  autoStartBusy: boolean
  onToggleAutoStart: () => void
  onClose: () => void
  onToggleTheme: () => void
  onClearCache: () => void
  onOpenBackup: () => void
  onCheckUpdates: () => void
  onSaveRecovery: () => void
  onDonate: () => void
}): JSX.Element {
  const backupLabel = !backupInfo?.enabled
    ? 'Desactivado'
    : backupInfo.paused
      ? 'En pausa'
      : backupInfo.uploading
        ? 'Sincronizando'
        : 'Activo'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-fade-in dark:bg-[#20242b]"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
            <Wrench className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">Configuración</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Ajustes de la app para {profileName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Apariencia
          </p>
          <SettingsRow
            icon={theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            title="Tema"
            description={theme === 'dark' ? 'Oscuro' : 'Claro'}
          >
            <button
              onClick={onToggleTheme}
              className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              Cambiar
            </button>
          </SettingsRow>

          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Sistema
          </p>
          <SettingsRow
            icon={<Power className="h-4 w-4" />}
            title="Iniciar con Windows"
            description={
              autoStart?.supported === false
                ? 'No disponible en esta versión (solo con la app instalada).'
                : 'Abre TGPlusDrive automáticamente al encender el PC.'
            }
          >
            <button
              onClick={onToggleAutoStart}
              disabled={autoStartBusy || autoStart?.supported === false}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
                autoStart?.enabled ? 'bg-gd-blue' : 'bg-slate-300 dark:bg-white/20'
              }`}
              role="switch"
              aria-checked={autoStart?.enabled ?? false}
              aria-label="Iniciar con Windows"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  autoStart?.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </SettingsRow>

          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Respaldo y almacenamiento
          </p>
          <SettingsRow
            icon={<FolderSync className="h-4 w-4" />}
            title="Respaldo automático"
            description={`${backupLabel}${
              backupInfo?.folderName ? ` · ${backupInfo.folderName}` : ''
            }`}
          >
            <button
              onClick={onOpenBackup}
              className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              Configurar
            </button>
          </SettingsRow>
          <SettingsRow
            icon={<HardDrive className="h-4 w-4" />}
            title="Caché local"
            description={`${formatSize(cacheInfo?.total ?? 0)} en miniaturas. No borra tus archivos de Telegram.`}
          >
            <button
              onClick={onClearCache}
              disabled={clearingCache || !cacheInfo || cacheInfo.total === 0}
              className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              {clearingCache ? 'Limpiando…' : 'Liberar'}
            </button>
          </SettingsRow>

          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Herramientas
          </p>
          <SettingsRow
            icon={<Wrench className="h-4 w-4" />}
            title="Herramienta de recuperación"
            description="Guarda el HTML para unir archivos divididos sin la app."
          >
            <button
              onClick={onSaveRecovery}
              className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              Guardar
            </button>
          </SettingsRow>
          <SettingsRow
            icon={<PackageOpen className="h-4 w-4" />}
            title="Actualizaciones"
            description="Comprueba si hay una versión nueva en GitHub."
          >
            <button
              onClick={onCheckUpdates}
              className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              Buscar
            </button>
          </SettingsRow>

          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Acerca de
          </p>
          <SettingsRow
            icon={<Heart className="h-4 w-4" />}
            title="Apoyar el proyecto"
            description="TGPlusDrive es gratis y sin anuncios. Una donación voluntaria ayuda a mantenerlo."
          >
            <button
              onClick={onDonate}
              className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
            >
              Donar
            </button>
          </SettingsRow>
          <div className="px-3 pb-3 pt-2 text-[10px] text-slate-400 dark:text-slate-500">
            Hecho con <span className="text-rose-500">♥</span> por{' '}
            <span className="font-bold text-gd-blue">Jatniel</span> · GPL-3.0
          </div>
        </div>
      </div>
    </div>
  )
}

function UpdateModal({
  info,
  busy,
  onClose,
  onRecheck,
  onDownload,
  onOpenRelease
}: {
  info: UpdateInfo | null
  busy: boolean
  onClose: () => void
  onRecheck: () => void
  onDownload: () => void
  onOpenRelease: () => void
}): JSX.Element {
  const hasUpdate = Boolean(info?.hasUpdate)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-in dark:bg-[#20242b]"
      >
        <div className="mb-3 flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              hasUpdate
                ? 'bg-blue-100 text-gd-blue dark:bg-blue-500/15 dark:text-blue-300'
                : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
            }`}
          >
            {hasUpdate ? (
              <PackageOpen className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </div>
          <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">
            Buscar actualizaciones
          </h3>
        </div>

        {busy ? (
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Comprobando en GitHub…
          </p>
        ) : info?.error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
            No se pudo comprobar: {info.error}
          </div>
        ) : hasUpdate ? (
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <p>
              Hay una versión nueva disponible: <b>v{info?.latest}</b>
              {info?.current ? (
                <>
                  {' '}
                  (tienes <b>v{info.current}</b>)
                </>
              ) : null}
            </p>
            {info?.publishedAt && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Publicada el {new Date(info.publishedAt).toLocaleDateString('es')}
              </p>
            )}
            {info?.notes && (
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                {info.notes}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Ya tienes la última versión
            {info?.current ? (
              <>
                {' '}
                (<b>v{info.current}</b>)
              </>
            ) : null}
            .
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onRecheck}
            disabled={busy}
            className="mr-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Volver a comprobar
          </button>
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cerrar
          </button>
          {hasUpdate && (
            <button
              onClick={onDownload}
              className="rounded-full bg-gd-blue px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              Descargar
            </button>
          )}
          {!hasUpdate && info && !info.error && info.releaseUrl && (
            <button
              onClick={onOpenRelease}
              className="rounded-full bg-slate-100 px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              Ver releases
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function BackupModal({
  info,
  onClose,
  onChange,
  onToast,
  onOpenFolder,
  onRestore
}: {
  info: BackupInfo | null
  onClose: () => void
  onChange: (info: BackupInfo) => void
  onToast: (message: string) => void
  onOpenFolder?: () => void
  onRestore?: () => void
}): JSX.Element {
  const [enabled, setEnabled] = useState(info?.enabled ?? false)
  const [sourceDir, setSourceDir] = useState(info?.sourceDir ?? '')
  const [folderName, setFolderName] = useState(info?.folderName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [touched, setTouched] = useState(false)

  // Hidratar una sola vez, salvo que el usuario aún no haya editado nada.
  useEffect(() => {
    if (!info || touched) return
    setEnabled(info.enabled)
    setSourceDir(info.sourceDir)
    setFolderName(info.folderName)
  }, [info, touched])

  const pickFolder = async (): Promise<void> => {
    try {
      const folder = await window.api.backup.pickFolder()
      if (!folder) return
      setTouched(true)
      setSourceDir(folder)
      if (!folderName.trim()) {
        const parts = folder.split(/[\\/]/).filter(Boolean)
        setFolderName(parts[parts.length - 1] ?? 'Respaldo')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const next = await window.api.backup.configure({ enabled, sourceDir, folderName })
      onChange(next)
      onToast(next.enabled ? 'Respaldo automático activado' : 'Respaldo automático desactivado')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const runNow = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      const next = await window.api.backup.runNow()
      onChange(next)
      onToast('Sincronización iniciada')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const restoreSkipped = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      const next = await window.api.backup.resetSkipped()
      onChange(next)
      onToast('Se volverán a respaldar los archivos omitidos')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const togglePause = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      const next = info?.paused
        ? await window.api.backup.resume()
        : await window.api.backup.pause()
      onChange(next)
      onToast(next.paused ? 'Respaldo en pausa' : 'Respaldo reanudado')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const cancelRun = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      onChange(await window.api.backup.cancel())
      onToast('Respaldo cancelado')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const active = info?.running || running

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl animate-fade-in dark:bg-[#20242b]"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-gd-blue dark:bg-blue-500/15 dark:text-blue-300">
            <FolderSync className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">
              Respaldo automático
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Copia una carpeta de tu PC a tu unidad de Telegram
            </p>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setTouched(true)
              setEnabled(event.target.checked)
            }}
            className="h-4 w-4 accent-[#2f6fed]"
          />
          <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
            Activar respaldo automático
          </span>
          {info?.enabled && (
            <span
              className={`h-2 w-2 rounded-full ${
                active ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'
              }`}
            />
          )}
        </label>

        <div className="mt-4">
          <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
            Carpeta de tu PC
          </span>
          <div className="flex gap-2">
            <input
              value={sourceDir}
              onChange={(event) => {
                setTouched(true)
                setSourceDir(event.target.value)
              }}
              placeholder={'C:\\Users\\TuUsuario\\Documentos'}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-gd-blue focus:ring-2 focus:ring-gd-blue/20 dark:border-white/10 dark:bg-black/20 dark:text-slate-100"
            />
            <button
              onClick={() => void pickFolder()}
              className="shrink-0 rounded-xl bg-slate-100 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              Elegir
            </button>
          </div>
        </div>

        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
            Nombre de la carpeta en la unidad
          </span>
          <input
            value={folderName}
            onChange={(event) => {
              setTouched(true)
              setFolderName(event.target.value)
            }}
            placeholder="Respaldo"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-gd-blue focus:ring-2 focus:ring-gd-blue/20 dark:border-white/10 dark:bg-black/20 dark:text-slate-100"
          />
        </div>

        {info && (
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <p>
              Archivos respaldados: <b>{info.files}</b>
              {info.lastScanAt
                ? ` · Última sincronización: ${new Date(info.lastScanAt).toLocaleString('es')}`
                : ''}
            </p>
            {info.skipped > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span>
                  {info.skipped} archivo(s) omitido(s) por borrarlos a mano.
                </span>
                <button
                  onClick={() => void restoreSkipped()}
                  disabled={running}
                  className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-50 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
                >
                  Volver a respaldarlos
                </button>
              </p>
            )}
            {(info.uploading || info.paused) && (
              <p className="mt-1">
                {info.paused ? 'Pausando tras el archivo actual' : 'Sincronizando'}:{' '}
                <b>{info.currentFile || 'preparando…'}</b>
                {info.currentTotal ? ` · ${info.currentIndex}/${info.currentTotal}` : ''}
                {info.currentSpeed ? ` · ${formatSize(info.currentSpeed)}/s` : ''}
              </p>
            )}
            {info.enabled && !info.sourceValid && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                La carpeta de tu PC no está disponible. Elige la ruta correcta para reanudar la
                sincronización.
              </p>
            )}
            {info.lastError && (
              <p className="mt-1 text-red-600 dark:text-red-400">{info.lastError}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {onOpenFolder && info.rootFolderId && (
                <button
                  onClick={onOpenFolder}
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25"
                >
                  <FolderSync className="h-3 w-3" />
                  Abrir carpeta de respaldo
                </button>
              )}
              {onRestore && info.rootFolderId && (
                <button
                  onClick={onRestore}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
                >
                  <HardDrive className="h-3 w-3" />
                  Restaurar al PC
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Los archivos nuevos o modificados se suben solos. Si borras algo en tu PC{" "}
          <b>no se borra en Telegram</b>. La carpeta está protegida contra movimientos y borrados
          accidentales; para quitarla, desactiva antes el respaldo. La primera sincronización puede
          tardar según el tamaño de la carpeta.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {info?.enabled && (
            <button
              onClick={() => void togglePause()}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10"
            >
              {info.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {info.paused ? 'Reanudar respaldo' : 'Pausar respaldo'}
            </button>
          )}
          {info?.enabled && (info.uploading || info.paused) && (
            <button
              onClick={() => void cancelRun()}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
            >
              <X className="h-4 w-4" />
              Cancelar carga
            </button>
          )}
          <button
            onClick={() => void runNow()}
            disabled={!info?.enabled || active}
            className="mr-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${active ? 'animate-spin' : ''}`} />
            Sincronizar ahora
          </button>
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cerrar
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || (enabled && !sourceDir.trim())}
            className="rounded-full bg-gd-blue px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancelar',
  danger,
  onClose,
  onConfirm
}: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#20242b] p-6 shadow-2xl animate-fade-in"
      >
        <div className="mb-3 flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              danger ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400' : 'bg-blue-100 text-blue-600'
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">{title}</h3>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-full px-4 py-1.5 text-sm font-medium text-white transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gd-blue hover:bg-blue-600'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
