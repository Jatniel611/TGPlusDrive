export type Provider = 'telegram' | 'demo'

export interface Profile {
  id: string
  name: string
  provider: Provider
  createdAt: number
  lastUsedAt: number
  apiId?: number
  apiHash?: string
}

export interface StoragePart {
  messageId: number
  fileId?: string
  size: number
  offset: number
}

export interface StorageRef {
  provider: Provider
  messageId?: number
  fileId?: string
  localName?: string
  parts?: StoragePart[]
  partsComplete?: boolean
  toolMessageId?: number
  sha256?: string
}

export interface VfsNode {
  id: string
  parentId: string | null
  kind: 'folder' | 'file'
  name: string
  size: number
  mime: string
  createdAt: number
  updatedAt: number
  starred: boolean
  trashed: boolean
  /** Carpeta raíz administrada por el respaldo automático. */
  backup?: boolean
  /** Hash de la carpeta local para reconocer el respaldo aunque se pierda backup.json. */
  backupToken?: string
  storage?: StorageRef
}

export interface VfsSettings {
  theme: 'light' | 'dark'
  view: 'grid' | 'list'
}

/** Archivo del respaldo borrado a mano: no se vuelve a subir mientras no cambie. */
export interface BackupSkipEntry {
  size: number
  mtimeMs: number
  sha256: string
}

/** Configuración mínima del respaldo que viaja en el índice de Telegram. */
export interface VfsBackupMeta {
  enabled: boolean
  sourceDir: string
  folderName: string
  rootFolderId: string | null
  token?: string
  skipped?: Record<string, BackupSkipEntry>
}

export interface VfsDb {
  version: number
  revision: number
  nodes: VfsNode[]
  settings: VfsSettings
  backup?: VfsBackupMeta
  index?: {
    updatedAt: number
    messageId?: number
  }
}

export interface DriveState {
  profile: Profile
  db: VfsDb
}

export type AuthStep =
  | 'idle'
  | 'connecting'
  | 'qr'
  | 'phone'
  | 'code'
  | 'password'
  | 'ready'
  | 'error'

export type AuthMethod = 'phone' | 'qr' | 'desktop'

export interface AuthState {
  step: AuthStep
  error?: string
  profile?: Profile
  qrDataUrl?: string
  method?: AuthMethod
}

export interface UploadProgress {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'paused' | 'done' | 'error'
  kind?: 'upload' | 'download'
  error?: string
  size?: number
  speed?: number
  eta?: number
  /** Archivo actual del lote de respaldo. */
  detail?: string
  /** Índice dentro del lote (1-based) y total de archivos. */
  index?: number
  total?: number
}

export interface ScanProgress {
  phase: 'scanning' | 'done'
  scanned: number
  added: number
  filter?: string
  error?: string
}

export type DuplicateAction = 'copy' | 'replace'

export interface DuplicateMatch {
  id: string
  name: string
  path: string
  createdAt: number
}

export interface UploadAnalysisFile {
  path: string
  name: string
  size: number
  split: boolean
  parts: number
  sha256?: string
  duplicates: DuplicateMatch[]
}

export interface UploadAnalysis {
  premium: boolean
  maxBytes: number
  partSize: number
  files: UploadAnalysisFile[]
  needsSplit: boolean
}

export interface PendingUpload {
  nodeId: string
  name: string
  size: number
  uploadedBytes: number
  uploadedParts: number
  totalParts: number
  source: string
  resumable: boolean
}

export interface Bootstrap {
  profiles: Profile[]
  active: DriveState | null
}

export interface TelegramCredentials {
  apiId: string
  apiHash: string
}

export interface BackupConfigInput {
  enabled: boolean
  sourceDir: string
  folderName: string
}

export interface BackupInfo {
  enabled: boolean
  sourceDir: string
  folderName: string
  rootFolderId: string | null
  running: boolean
  paused: boolean
  /** true solo mientras hay una subida real en curso (no en escaneos vacíos). */
  uploading: boolean
  /** false si la carpeta local configurada no existe o no es accesible. */
  sourceValid: boolean
  files: number
  /** Archivos que borraste del respaldo y no se volverán a subir. */
  skipped: number
  /** Progreso del lote actual. */
  currentFile?: string
  currentIndex?: number
  currentTotal?: number
  currentProgress?: number
  currentSpeed?: number
  currentEta?: number
  lastScanAt?: number
  lastError?: string
}

export interface RestoreRequest {
  /** Nodo raíz (carpeta o archivo) a restaurar. */
  ids: string[]
  /** Carpeta local de destino. Si falta, la app pide elegirla. */
  destination?: string
  /** `restore` = desde el respaldo; `download` = descarga normal de carpetas. */
  mode?: 'restore' | 'download'
}

export interface RestoreResult {
  destination: string
  restored: number
  failed: number
}

export interface UpdateInfo {
  current: string
  latest: string | null
  hasUpdate: boolean
  releaseUrl?: string
  downloadUrl?: string
  publishedAt?: string
  notes?: string
  /** Motivo si no se pudo comprobar (sin red, límite de GitHub, etc.). */
  error?: string
}
