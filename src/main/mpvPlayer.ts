import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let mpvProcess: ChildProcess | null = null

function mpvCandidates(): string[] {
  const list: string[] = []
  const env = process.env['TGPLUSDRIVE_MPV'] || process.env['MPV_PATH']
  if (env) list.push(env)
  if (app.isPackaged) {
    list.push(join(process.resourcesPath, 'mpv', 'mpv.exe'))
  } else {
    list.push(join(app.getAppPath(), 'vendor', 'mpv', 'mpv.exe'))
    list.push(join(process.cwd(), 'vendor', 'mpv', 'mpv.exe'))
  }
  list.push('C:\\Program Files\\MPV Player\\mpv.exe')
  return list
}

let cachedMpv: string | null | undefined

export function resolveMpv(): string | null {
  if (cachedMpv !== undefined) return cachedMpv
  for (const candidate of mpvCandidates()) {
    try {
      if (existsSync(candidate)) {
        cachedMpv = candidate
        return cachedMpv
      }
    } catch {
      /* ignore */
    }
  }
  cachedMpv = null
  return null
}

export function isMpvPlaying(): boolean {
  return Boolean(mpvProcess)
}

const ownedProcesses = new Set<ChildProcess>()

export function stopMpv(): void {
  for (const child of ownedProcesses) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
  ownedProcesses.clear()
  if (mpvProcess) {
    try {
      mpvProcess.kill()
    } catch {
      /* ignore */
    }
    mpvProcess = null
  }
}

export interface MpvOptions {
  url: string
  title?: string
  start?: number
  audioOnly?: boolean
  geometry?: { x: number; y: number; width: number; height: number }
}

/**
 * Abre el reproductor mpv en su propia ventana. Reproduce de forma nativa
 * todos los códecs (H.264, HEVC, AC-3, E-AC-3, DTS, TrueHD…) con audio real.
 * Se usa como reproductor predeterminado para video y audio.
 */
export function playWithMpv(options: MpvOptions): boolean {
  const mpv = resolveMpv()
  if (!mpv) return false

  stopMpv()

  const args = [
    '--force-window=yes',
    '--keep-open=no',
    '--cache=yes',
    // Buffer máximo: prioriza fluidez continua sobre memoria.
    '--cache-secs=600',
    '--cache-pause-wait=1',
    '--cache-pause-initial=no',
    '--demuxer-readahead-secs=120',
    '--demuxer-max-bytes=1GiB',
    '--demuxer-max-back-bytes=256MiB',
    '--demuxer-thread=yes',
    '--hwdec=auto-safe',
    '--osc=yes',
    '--save-position-on-quit=no',
    '--volume=100',
    '--force-media-title=' + (options.title || 'TGPlusDrive'),
    '--title=TGPlusDrive — ' + (options.title || 'Reproductor'),
    '--osd-playing-msg=TGPlusDrive',
    '--osd-playing-msg-duration=2500'
  ]
  if (options.audioOnly) {
    args.push('--audio-display=no')
  }
  if (options.geometry) {
    const g = options.geometry
    args.push(
      '--geometry=' + Math.round(g.width) + 'x' + Math.round(g.height) + '+' + Math.round(g.x) + '+' + Math.round(g.y)
    )
  }
  if (options.start && options.start > 0) {
    args.push('--start=' + Math.floor(options.start))
  }
  args.push(options.url)

  try {
    mpvProcess = spawn(mpv, args, { windowsHide: false, stdio: 'ignore' })
  } catch {
    mpvProcess = null
    return false
  }

  ownedProcesses.add(mpvProcess)
  const spawned = mpvProcess
  mpvProcess.on('error', () => {
    ownedProcesses.delete(spawned)
    if (mpvProcess === spawned) mpvProcess = null
  })
  mpvProcess.on('close', () => {
    ownedProcesses.delete(spawned)
    if (mpvProcess === spawned) mpvProcess = null
  })

  return true
}
