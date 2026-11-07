/**
 * Descarga mpv.exe (build oficial de Windows) a vendor/mpv/.
 *
 * Necesario porque mpv.exe pesa >100 MB y GitHub rechaza archivos de ese
 * tamaño: el binario NO se versiona. Ejecuta `npm run fetch:mpv` una vez
 * (o tras `npm ci`) antes de `npm run dev` / `npm run dist`.
 *
 * Fuente: https://github.com/zhongfly/mpv-winbuild (builds no oficiales,
 * licencia GPLv2+/LGPLv2.1+; ver THIRD-PARTY-NOTICES.md).
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const destDir = path.join(root, 'vendor', 'mpv')
const dest = path.join(destDir, 'mpv.exe')
const API = 'https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest'

function log(message) {
  process.stdout.write(`[fetch-mpv] ${message}\n`)
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'TGPlusDrive', Accept: 'application/vnd.github+json' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume()
          resolve(getJson(res.headers.location))
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} en ${url}`))
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })
}

function download(url, file) {
  return new Promise((resolve, reject) => {
    const follow = (target) => {
      https
        .get(target, { headers: { 'User-Agent': 'TGPlusDrive' } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            res.resume()
            follow(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`HTTP ${res.statusCode} al descargar mpv`))
            return
          }
          const out = fs.createWriteStream(file)
          res.pipe(out)
          out.on('finish', () => out.close(() => resolve()))
          out.on('error', reject)
        })
        .on('error', reject)
    }
    follow(url)
  })
}

async function main() {
  if (process.platform !== 'win32') {
    log('solo Windows; se omite')
    return
  }
  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size
    if (size > 50 * 1024 * 1024) {
      log(`ya existe vendor/mpv/mpv.exe (${Math.round(size / 1024 / 1024)} MB); nada que hacer`)
      return
    }
  }

  log('buscando la última versión de mpv para Windows…')
  const release = await getJson(API)
  const assets = Array.isArray(release.assets) ? release.assets : []
  const asset =
    assets.find((a) => /^mpv-x86_64-\d{8}-git-.*\.7z$/i.test(a.name)) ||
    assets.find((a) => /^mpv-x86_64-.*\.7z$/i.test(a.name))
  if (!asset) throw new Error('No se encontró el asset mpv-x86_64 .7z en el release')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tgplusdrive-mpv-'))
  const archive = path.join(tmp, 'mpv.7z')
  log(`descargando ${asset.name} (${Math.round(asset.size / 1024 / 1024)} MB)…`)
  await download(asset.browser_download_url, archive)

  log('extrayendo…')
  fs.mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'inherit', windowsHide: true })
  const extracted = path.join(tmp, 'mpv.exe')
  if (!fs.existsSync(extracted)) {
    throw new Error('La extracción no produjo mpv.exe')
  }
  fs.copyFileSync(extracted, dest)
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  log(`listo: vendor/mpv/mpv.exe (${Math.round(fs.statSync(dest).size / 1024 / 1024)} MB)`)
}

main().catch((err) => {
  console.error(`[fetch-mpv] ERROR: ${err.message}`)
  console.error('[fetch-mpv] Descarga mpv manualmente desde https://github.com/zhongfly/mpv-winbuild/releases')
  console.error('[fetch-mpv] y guarda el binario como vendor/mpv/mpv.exe')
  process.exit(1)
})
