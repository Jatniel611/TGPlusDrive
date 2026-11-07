/**
 * Windows: aplica el icono de TGPlusDrive al mpv.exe que se empaqueta.
 * Así el reproductor muestra el logo de la app en la barra de tareas y ventana.
 * Es idempotente: si ya tiene el icono correcto, no hace nada.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const exe = path.join(root, 'vendor', 'mpv', 'mpv.exe')
const ico = path.join(root, 'build', 'icon.ico')
const backup = path.join(root, 'vendor', 'mpv', 'mpv.original.exe')

function log(message) {
  process.stdout.write(`[brand-mpv] ${message}\n`)
}

if (process.platform !== 'win32') {
  log('solo Windows, se omite')
  process.exit(0)
}

if (!fs.existsSync(exe)) {
  log('no existe vendor/mpv/mpv.exe, se omite')
  process.exit(0)
}

if (!fs.existsSync(ico)) {
  log('no existe build/icon.ico, se omite')
  process.exit(0)
}

const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
if (!fs.existsSync(rcedit)) {
  log('rcedit no disponible, se omite')
  process.exit(0)
}

// Guardar el original una sola vez para poder reaplicar o revertir.
if (!fs.existsSync(backup)) {
  fs.copyFileSync(exe, backup)
  log('copia original guardada en vendor/mpv/mpov.original.exe'.replace('mpov', 'mpv'))
}

try {
  execFileSync(rcedit, [exe, '--set-icon', ico], { stdio: 'inherit', windowsHide: true })
  log('icono aplicado a mpv.exe')
} catch (err) {
  log(`no se pudo aplicar el icono: ${err.message}`)
}
