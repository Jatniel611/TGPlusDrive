/**
 * Windows: verifica que el binario de Electron exista.
 * Algunos antivirus / instalaciones de npm dejan node_modules/electron/dist incompleto.
 * Si falta, intenta el instalador oficial y, como último recurso, extrae el ZIP de la caché.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const platform = process.platform
const arch = process.arch
const exeName =
  platform === 'win32'
    ? 'electron.exe'
    : platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron'

let electronDir
try {
  electronDir = path.dirname(require.resolve('electron/package.json'))
} catch {
  console.log('[ensure-electron] electron no está instalado todavía; se omite.')
  process.exit(0)
}

const distDir = path.join(electronDir, 'dist')
const exePath = path.join(distDir, exeName)

if (fs.existsSync(exePath)) {
  process.exit(0)
}

console.log('[ensure-electron] Falta el binario de Electron. Intentando instalarlo…')

try {
  execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' })
} catch (err) {
  console.warn('[ensure-electron] install.js falló:', err.message)
}

if (fs.existsSync(exePath)) {
  console.log('[ensure-electron] Binario instalado correctamente.')
  process.exit(0)
}

function findZip(root) {
  if (!fs.existsSync(root)) return null
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === `electron-v${version}-${platform}-${arch}.zip`) return full
    }
  }
  return null
}

const version = require('electron/package.json').version
const cacheRoot =
  process.env.electron_config_cache ||
  (platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'electron', 'Cache')
    : platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library', 'Caches', 'electron')
      : path.join(process.env.HOME || '', '.cache', 'electron'))

const zip = findZip(cacheRoot)
if (!zip) {
  console.warn(
    '[ensure-electron] No se encontró el ZIP en caché. Ejecuta `npm rebuild electron` o reinstala dependencias.'
  )
  process.exit(0)
}

let extract
try {
  extract = require('extract-zip')
} catch {
  console.warn('[ensure-electron] extract-zip no disponible; no se puede extraer la caché.')
  process.exit(0)
}

extract(zip, { dir: distDir })
  .then(() => {
    fs.writeFileSync(path.join(electronDir, 'path.txt'), exeName)
    console.log('[ensure-electron] Binario extraído desde la caché.')
  })
  .catch((err) => {
    console.warn('[ensure-electron] No se pudo extraer:', err.message)
  })
