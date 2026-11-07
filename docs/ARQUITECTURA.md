# Arquitectura — TGPlusDrive

Documento técnico para colaboradores: cómo está organizado el proyecto y las
decisiones que no deben revertirse.

## Mapa del código

```
src/main/
  index.ts        ventana, IPC, protocolo tgfile, subida/descarga, bandeja
  telegram.ts     GramJS: login, stream por rangos, escaneo, índice, rename, miniaturas
  profiles.ts     perfiles, sesión DPAPI, credenciales API, MAX_PROFILES = 4
  store.ts        VFS (nodos, orden, fechas, mime)
  backup.ts       BackupManager: espeja una carpeta local a la VFS
  hash.ts         SHA-256 en streaming (integridad/duplicados)
  mediaServer.ts  servidor HTTP local 127.0.0.1 con Range para mpv
  mpvPlayer.ts    lanza mpv.exe (ventana propia), stopMpv, resolveMpv
  mime.ts         guessMime + listas IMAGE/VIDEO/AUDIO_EXT
  recovery-tool.html  herramienta offline para unir partes (se sube a Telegram)
src/renderer/src/
  App.tsx               estado global, sonido de fin, pantallas
  components/Drive.tsx  UI principal: grid/lista, filtros, transferencias, modales
  components/{Onboarding,AuthScreen,CredentialsScreen,ImageViewer}.tsx
src/shared/{types.ts,api.ts}  contrato tipado IPC
scripts/{obfuscate,brand-mpv,ensure-electron,fetch-mpv}.cjs
```

## Comandos

Usar **`npm.cmd`** (PowerShell bloquea `npm.ps1`).

```powershell
npm.cmd run typecheck   # obligatorio antes de entregar
npm.cmd run build       # electron-vite -> out/ (SIN ofuscar)
npm.cmd run dev         # desarrollo (usa OTRO userData)
npm.cmd run fetch:mpv   # descarga vendor/mpv/mpv.exe (no versionado)
npm.cmd run dist        # build + ofuscar + brand-mpv + electron-builder
```

`vendor/mpv/mpv.exe` pesa ~117 MB y GitHub rechaza archivos de más de 100 MB, así
que no está en el repositorio. `predist` lo descarga automáticamente.

## Reproductor — decisión inmutable

**mpv en su propia ventana.** Incrustarlo (`--wid` sobre un HWND de Electron)
provocó pantalla negra con brillo 0 en todas las pruebas.

- `mediaServer.ts` sirve bytes de Telegram con **Range** → seek sin descargar todo.
- Un solo mpv: `stopMpv()` mata solo los procesos lanzados por la app.
- Flags principales: `--force-window=yes --cache=yes --cache-secs=600
  --demuxer-readahead-secs=120 --demuxer-max-bytes=1GiB --hwdec=auto-safe --osc=yes`.
- La URL del stream **debe incluir la extensión** (`/src/<id>/<nombre.mkv>`).

## Transferencias

- Subida: `workers: 16` (máximo de GramJS), limitada por la conexión.
- Descarga: `DOWNLOAD_WORKERS = 4` es el óptimo medido (8 y 12 empeoran por
  contención).
- El medidor de velocidad/ETA debe aplicarse en todos los caminos de descarga.
- La barra de selección es flotante (`fixed bottom-6`): no debe ocupar espacio en
  el flujo o desplaza las tarjetas y rompe el doble clic.

## Subida dividida (archivos por encima del límite)

- Límite: 2 GB free / 4 GB Premium.
- Tamaño de parte: **1.5 GiB** (`partSafeBytes`). Nunca ~2 GB: genera más de 4000
  fragmentos y Telegram rechaza.
- Caption: `TGPLUSDRIVE|<nodeId>|<nombre>|PART|<idx>|<total>|<offset>|<length>`.
- Manifiesto reanudable en `%APPDATA%\tgplusdrive\uploads\<nodeId>.json`.
- `pendingUploads()` excluye subidas activas.

## Trampas ya resueltas (no repetir)

1. **No incrustar mpv**: pantalla negra.
2. **No duplicar `ipcMain.handle`**: la app no arranca.
3. **`getMessages` repetido = FLOOD_WAIT**: hay caché y deduplicación porque mpv
   lanza varios `Range` en paralelo.
4. **`OFFSET_INVALID`**: el offset debe ser múltiplo de 4096 y en archivos
   divididos cada parte empieza en 0.
5. **Miniaturas de video**: `spawn` asíncrono, nunca `spawnSync` (el servidor
   HTTP vive en el mismo proceso → deadlock).
6. **Miniatura al marcar favorito**: `NodeThumb` solo se reinicia con `node.id`.
7. **Logout**: `unlistProfile` conserva la carpeta del perfil; `removeProfile`
   la borra.
8. **Bandeja**: `createTray()` debe llamarse siempre, o la X deja la app
   inaccesible.

## Datos de usuario (nunca al repo)

```
%APPDATA%\tgplusdrive\
  profiles.json                 perfiles
  credentials.bin               api_id/api_hash cifrados con DPAPI
  backups\<id>.json             manifiesto del respaldo
  profiles\<userId>\            session.enc, vfs.json, thumbs/, preview/
```

## Detalles de UI que no deben romperse

- Sidebar siempre visible y con scroll interno; abajo, fijos, el botón
  “Apoyar el proyecto” y el crédito.
- Iconos distintos en la barra: `CloudUpload` azul (sincronizar índice) y
  `PackageOpen` ámbar con insignia de flecha (actualizaciones).
- Búsqueda tolerante a tildes, signos y orden de palabras (`searchScore`).
- Las URLs externas se abren con `shell.openExternal` desde el proceso principal,
  nunca desde el renderer.
