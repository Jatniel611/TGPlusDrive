# Historial del proyecto — TGPlusDrive

Registro de lo construido, para que cualquier colaborador retome el contexto sin
releer todo el código. Aquí va la línea de tiempo y el estado del proyecto.

## Resumen

- **Qué es:** gestor de archivos tipo Google Drive sobre los Mensajes guardados
  de Telegram. Electron + React + TypeScript + GramJS/MTProto + mpv.
- **Repo:** https://github.com/Jatniel611/TGPlusDrive
- **Licencia:** GPL-3.0-or-later (compatible con mpv GPLv2+).
- **Versión:** 0.1.2 beta, publicada como pre-release.

## Línea de tiempo

### v0.1.0 — base
- Login por teléfono y QR (sin modo demo en la UI).
- Sidebar siempre visible y con scroll; búsqueda, grid/lista, filtros, papelera,
  destacados, temas, atajos.
- Subida/descarga a Mensajes guardados con progreso, velocidad y ETA.
- Subida dividida para archivos >2 GB / 4 GB con manifiesto reanudable y
  herramienta offline `Recuperar TGPlusDrive.html`.
- Índice de la organización en Telegram (`TGPlusDrive Index v1`).
- SHA-256 al subir y verificar al bajar.
- Detección de duplicados (Sustituir / Subir copia).
- Reproducción con mpv en ventana propia y servidor local con `Range`.
- Respaldos: `BackupManager` con `fs.watch`, escaneo cada 10 min, renombres por
  hash, sin borrar en Telegram, carpeta protegida, doble confirmación al borrar,
  pausa/reanudación y progreso X/Y.
- Restaurar al PC y descargar carpetas completas conservando estructura.
- Carpeta de respaldo anclada primero y con estado visual (verde/ámbar/gris).
- Persistencia del respaldo fuera del perfil (`backups/<id>.json` + `db.backup`
  en el índice + `node.backup`/`backupToken`).
- Multiperfil (4 cuentas), sesión con DPAPI; se elimina el `credentials.json`
  en texto plano.
- Escaneo de Telegram con `getMessages` cacheado (evita FLOOD_WAIT).

### v0.1.1 — publicación y mejoras
- Buscador tolerante a tildes, signos y orden de palabras (`searchScore`).
- README reescrito con “¿Por qué TGPlusDrive?”, instalación, seguridad y
  licencias; avisos de terceros con obligación GPL de mpv.
- Publicación en GitHub: workflows de build y release, Dependabot, plantillas de
  issues, política de seguridad y guía de publicación.
- `mpv.exe` fuera del repo (>100 MB) con `npm run fetch:mpv` y `predist`.
- Donaciones: `.github/FUNDING.yml` con PayPal y botón en la app
  (`app:openDonation` con URL fija en el proceso principal).
- Limpieza de código muerto (VideoPlayer, UploadTray, IPC sin uso).

### v0.1.2 — actual
- **Buscador de actualizaciones**: `app:checkForUpdates` (GitHub Releases, caché
  10 min, ignora borradores, prefiere estable), `app:openUrl` y modal con
  “Ya tienes la última versión” / notas y botón Descargar.
- Iconos diferenciados: `CloudUpload` azul (sincronizar índice) y
  `PackageOpen` ámbar con insignia `ArrowUp` (actualizaciones).
- Captura de la interfaz en `docs/screenshots/app.png` y en el README.
- Ejemplos de búsqueda neutros (`Currículum`, `Presupuesto2026`), sin referencias
  a contenido multimedia.
- Preparada la **firma gratuita con SignPath** (workflow, XML de artefacto y
  guía), pendiente de configurar la cuenta y los secretos.

## Estado actual

Funciona en pruebas reales con una cuenta:

- Subir, descargar, carpetas, archivos gigantes, duplicados.
- Respaldo automático, pausa, restauración y protección.
- Búsqueda tolerante y actualizaciones.

Pendiente / ideas:

- **Firma de código** (SignPath o certificado OV/EV). Sin firma, SmartScreen
  avisa; aviso visible en el README y en el release.
- Filtros de exclusión en el respaldo (`node_modules`, `.git`, temporales).
- Reanudar subidas grandes fallidas del respaldo entre escaneos.
- Tests automatizados (store, backup, hash, búsqueda).
- Log de diagnóstico para soporte.

## Cómo continuar

1. Lee el `README.md` y `CONTRIBUTING.md` (arquitectura, estilo y entorno).
2. `npm.cmd run typecheck` antes de tocar nada.
3. Para publicar: subir `version`, crear `docs/RELEASE-x.y.z.md`, commit, tag y
   push. El workflow crea el release en borrador.
4. Detalle del proceso en `docs/PUBLICAR.md`.
