import type {
  AuthMethod,
  AuthState,
  BackupConfigInput,
  BackupInfo,
  Bootstrap,
  DriveState,
  DuplicateAction,
  PendingUpload,
  Profile,
  RestoreRequest,
  RestoreResult,
  ScanProgress,
  UpdateInfo,
  UploadAnalysis,
  UploadProgress
} from './types'

export interface TgApi {
  profiles: {
    list(): Promise<Profile[]>
    activate(id: string): Promise<DriveState>

    remove(id: string): Promise<Profile[]>
    logout(id: string): Promise<Profile[]>
    credentials(): Promise<{ apiId: string; apiHash: string } | null>
    clearCredentials(): Promise<{ cleared: boolean }>
    limit(): Promise<{ max: number; count: number }>
  }
  auth: {
    saveCredentials(creds: { apiId: string; apiHash: string }): Promise<{ ok: boolean; error?: string }>
    start(creds: { apiId: string; apiHash: string; method?: AuthMethod }): Promise<{ started: boolean }>
    provide(field: 'phone' | 'code' | 'password', value: string): Promise<boolean>
    cancel(): Promise<boolean>
    onState(cb: (state: AuthState) => void): () => void
  }
  drive: {
    state(): Promise<DriveState | null>
    cacheStats(): Promise<{ thumbs: number; preview: number; stream: number; playable: number; total: number }>
    clearCache(): Promise<{ freed: number }>
    createFolder(parentId: string | null, name: string): Promise<DriveState>
    uploadPaths(
      parentId: string | null,
      paths: string[],
      options?: { actions?: Record<string, DuplicateAction>; hashes?: Record<string, string> }
    ): Promise<DriveState | null>
    pickUpload(): Promise<string[]>
    analyzeUpload(paths: string[]): Promise<UploadAnalysis>
    pendingUploads(): Promise<PendingUpload[]>
    resumeUpload(nodeId: string): Promise<DriveState | null>
    discardUpload(nodeId: string): Promise<{ discarded: boolean }>
    saveRecoveryTool(): Promise<{ saved: boolean; path?: string; error?: string }>
    playNativeFile(payload: {
      id: string
      start?: number
      audioOnly?: boolean
    }): Promise<{ played: boolean; error?: string }>
    download(ids: string[]): Promise<boolean>
    restoreToDisk(request: RestoreRequest): Promise<RestoreResult | null>
    cancelDownload(id: string): Promise<boolean>
    cancelUpload(id: string, wholeBatch?: boolean): Promise<boolean>
    open(id: string): Promise<boolean>
    rename(id: string, name: string): Promise<DriveState>
    trash(ids: string[]): Promise<DriveState>
    restore(ids: string[]): Promise<DriveState>
    deleteForever(ids: string[]): Promise<DriveState>
    star(id: string): Promise<DriveState>
    setView(view: 'grid' | 'list'): Promise<DriveState>
    setTheme(theme: 'light' | 'dark'): Promise<DriveState>
    syncIndex(): Promise<DriveState>
    move(ids: string[], targetId: string | null): Promise<DriveState>
    scan(): Promise<{ scanned: number; added: number }>
    bootstrap(): Promise<Bootstrap>
  }
  backup: {
    info(): Promise<BackupInfo>
    pickFolder(): Promise<string | null>
    configure(input: BackupConfigInput): Promise<BackupInfo>
    runNow(): Promise<BackupInfo>
    pause(): Promise<BackupInfo>
    resume(): Promise<BackupInfo>
    cancel(): Promise<BackupInfo>
    resetSkipped(): Promise<BackupInfo>
    onState(cb: (info: BackupInfo) => void): () => void
  }
  events: {
    onChanged(cb: (state: DriveState | null) => void): () => void
    onProgress(cb: (progress: UploadProgress) => void): () => void
    onScanProgress(cb: (progress: ScanProgress) => void): () => void
  }
  app: {
    /** Abre la página de donaciones en el navegador externo. */
    openDonation(): Promise<boolean>
    /** Comprueba si hay una versión nueva en GitHub Releases. */
    checkForUpdates(): Promise<UpdateInfo>
    /** Abre la página del release o la descarga en el navegador. */
    openUrl(url: 'release' | 'download'): Promise<boolean>
    version(): Promise<string>
    /** Vuelve a leer las descripciones de Telegram para el buscador. */
    refreshCaptions(): Promise<{ before: number; changed: number; after: number }>
    /** Inicio automático con Windows. */
    autoStart(): Promise<{ supported: boolean; enabled: boolean }>
    setAutoStart(
      enabled: boolean
    ): Promise<{ supported: boolean; enabled: boolean; error?: string }>
  }
  getPathForFile(file: File): string
}
