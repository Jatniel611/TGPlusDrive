import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderSync,
  FolderX
} from 'lucide-react'

import type { VfsNode } from '@shared/types'

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export type Category =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'archive'
  | 'sheet'
  | 'doc'
  | 'code'
  | 'file'

const VIDEO_EXT = [
  'mp4', 'm4v', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpg', 'mpeg',
  '3gp', '3g2', 'ogv', 'm2ts', 'mts', 'vob', 'divx', 'asf', 'rm',
  'rmvb', 'f4v', 'mxf', 'm2v'
]
const AUDIO_EXT = [
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'm4b', 'aac', 'opus', 'wma',
  'mid', 'midi', 'aiff', 'aif', 'alac', 'ape', 'amr', 'ac3', 'mka'
]
const IMAGE_EXT = [
  'jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'bmp', 'svg',
  'heic', 'heif', 'avif', 'jxl', 'tiff', 'tif', 'ico',
  'raw', 'arw', 'srf', 'sr2', 'cr2', 'cr3', 'nef', 'nrw', 'dng', 'orf',
  'rw2', 'raf', 'pef', 'srw', 'rwl'
]

export function isImageNode(node: VfsNode): boolean {
  if (node.kind !== 'file') return false
  return node.mime.startsWith('image/') || IMAGE_EXT.includes(extOf(node.name))
}

export function categoryOf(node: VfsNode): Category {
  if (node.kind === 'folder') return 'folder'
  const ext = extOf(node.name)
  if (node.mime.startsWith('video/')) return 'video'
  if (node.mime.startsWith('audio/')) return 'audio'
  if (node.mime.startsWith('image/')) return 'image'
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (
    [
      'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'cab', 'tgz', 'iso',
      'exe', 'msi', 'apk', 'jar', 'dmg', 'pkg', 'deb', 'rpm', 'bin', 'appimage'
    ].includes(ext)
  ) {
    return 'archive'
  }
  if (['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'tsv', 'ods'].includes(ext)) return 'sheet'
  if (['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'txt', 'md', 'epub', 'mobi', 'azw3', 'tex', 'log'].includes(ext)) return 'doc'
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'xml', 'yaml', 'yml', 'toml', 'sql', 'swift', 'kt', 'rb', 'php', 'cs', 'vue', 'svelte', 'scss', 'sass', 'less'].includes(ext)) {
    return 'code'
  }
  return 'file'
}

const COLORS: Record<Category, string> = {
  folder: 'text-sky-500',
  image: 'text-emerald-500',
  video: 'text-rose-500',
  audio: 'text-violet-500',
  pdf: 'text-red-500',
  archive: 'text-amber-500',
  sheet: 'text-green-600',
  doc: 'text-blue-500',
  code: 'text-cyan-600',
  file: 'text-slate-400'
}

export type BackupState = 'synced' | 'paused' | 'off'

interface Props {
  node: VfsNode
  size?: number
  className?: string
  /** Carpeta especial de respaldo automático. */
  backup?: boolean
  /** Estado del respaldo para elegir el icono. */
  backupState?: BackupState
}

export function FileIcon({
  node,
  size = 24,
  className = '',
  backup = false,
  backupState = 'synced'
}: Props): JSX.Element {
  const category = categoryOf(node)
  const style = { width: size, height: size }
  const color = `shrink-0 ${COLORS[category]} ${className}`

  switch (category) {
    case 'folder':
      if (backup) {
        if (backupState === 'off') {
          return (
            <FolderX
              style={style}
              className={`shrink-0 text-slate-400 dark:text-slate-500 ${className}`}
            />
          )
        }
        return (
          <FolderSync
            style={style}
            className={`shrink-0 ${
              backupState === 'paused'
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-emerald-500 dark:text-emerald-400'
            } ${className}`}
          />
        )
      }
      return <Folder style={style} className={`shrink-0 text-sky-500 fill-sky-200/70 dark:fill-sky-500/20 ${className}`} />
    case 'image':
      return <FileImage style={style} className={color} />
    case 'video':
      return <FileVideo style={style} className={color} />
    case 'audio':
      return <FileAudio style={style} className={color} />
    case 'pdf':
      return <FileText style={style} className={color} />
    case 'archive':
      return <FileArchive style={style} className={color} />
    case 'sheet':
      return <FileSpreadsheet style={style} className={color} />
    case 'doc':
      return <FileText style={style} className={color} />
    case 'code':
      return <FileCode style={style} className={color} />
    default:
      return <File style={style} className={color} />
  }
}
