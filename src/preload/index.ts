import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { TgApi } from '@shared/api'
import type {
  AuthState,
  BackupInfo,
  DriveState,
  ScanProgress,
  UploadProgress
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TgApi = {
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    activate: (id) => ipcRenderer.invoke('profiles:activate', id),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
    logout: (id) => ipcRenderer.invoke('profiles:logout', id),
    credentials: () => ipcRenderer.invoke('app:credentials'),
    limit: () => ipcRenderer.invoke('profiles:limit'),
    clearCredentials: () => ipcRenderer.invoke('app:clearCredentials')
  },
  auth: {
    saveCredentials: (creds) => ipcRenderer.invoke('auth:saveCredentials', creds),
    start: (creds) => ipcRenderer.invoke('auth:start', creds),
    provide: (field, value) => ipcRenderer.invoke('auth:provide', { field, value }),
    cancel: () => ipcRenderer.invoke('auth:cancel'),
    onState: (cb) => subscribe<AuthState>('auth:state', cb)
  },
  drive: {
    state: () => ipcRenderer.invoke('drive:state'),
    cacheStats: () => ipcRenderer.invoke('drive:cacheStats'),
    clearCache: () => ipcRenderer.invoke('drive:clearCache'),
    createFolder: (parentId, name) => ipcRenderer.invoke('drive:createFolder', { parentId, name }),
    uploadPaths: (parentId, paths, options) =>
      ipcRenderer.invoke('drive:uploadPaths', { parentId, paths, options }),
    pickUpload: () => ipcRenderer.invoke('drive:pickUpload'),
    analyzeUpload: (paths) => ipcRenderer.invoke('drive:analyzeUpload', paths),
    pendingUploads: () => ipcRenderer.invoke('drive:pendingUploads'),
    resumeUpload: (nodeId) => ipcRenderer.invoke('drive:resumeUpload', nodeId),
    discardUpload: (nodeId) => ipcRenderer.invoke('drive:discardUpload', nodeId),
    saveRecoveryTool: () => ipcRenderer.invoke('drive:saveRecoveryTool'),
    playNativeFile: (payload) => ipcRenderer.invoke('drive:playNative', payload),
    download: (ids) => ipcRenderer.invoke('drive:download', ids),
    restoreToDisk: (request) => ipcRenderer.invoke('drive:restoreToDisk', request),
    cancelDownload: (id) => ipcRenderer.invoke('drive:cancelDownload', id),
    cancelUpload: (id) => ipcRenderer.invoke('drive:cancelUpload', id),
    open: (id) => ipcRenderer.invoke('drive:open', id),
    rename: (id, name) => ipcRenderer.invoke('drive:rename', { id, name }),
    trash: (ids) => ipcRenderer.invoke('drive:trash', ids),
    restore: (ids) => ipcRenderer.invoke('drive:restore', ids),
    deleteForever: (ids) => ipcRenderer.invoke('drive:deleteForever', ids),
    star: (id) => ipcRenderer.invoke('drive:star', id),
    setView: (view) => ipcRenderer.invoke('drive:setView', view),
    setTheme: (theme) => ipcRenderer.invoke('drive:setTheme', theme),
    syncIndex: () => ipcRenderer.invoke('drive:syncIndex'),
    move: (ids, targetId) => ipcRenderer.invoke('drive:move', { ids, targetId }),
    scan: () => ipcRenderer.invoke('drive:scan'),
    bootstrap: () => ipcRenderer.invoke('app:bootstrap')
  },
  backup: {
    info: () => ipcRenderer.invoke('backup:info'),
    pickFolder: () => ipcRenderer.invoke('backup:pickFolder'),
    configure: (input) => ipcRenderer.invoke('backup:configure', input),
    runNow: () => ipcRenderer.invoke('backup:runNow'),
    pause: () => ipcRenderer.invoke('backup:pause'),
    resume: () => ipcRenderer.invoke('backup:resume'),
    cancel: () => ipcRenderer.invoke('backup:cancel'),
    resetSkipped: () => ipcRenderer.invoke('backup:resetSkipped'),
    onState: (cb) => subscribe<BackupInfo>('backup:state', cb)
  },
  events: {
    onChanged: (cb) => subscribe<DriveState | null>('drive:changed', cb),
    onProgress: (cb) => subscribe<UploadProgress>('drive:progress', cb),
    onScanProgress: (cb) => subscribe<ScanProgress>('scan:progress', cb)
  },
  app: {
    openDonation: () => ipcRenderer.invoke('app:openDonation'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    openUrl: (url) => ipcRenderer.invoke('app:openUrl', url),
    version: () => ipcRenderer.invoke('app:version'),
    autoStart: () => ipcRenderer.invoke('app:autoStart'),
    setAutoStart: (enabled) => ipcRenderer.invoke('app:setAutoStart', enabled)
  },
  getPathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)
