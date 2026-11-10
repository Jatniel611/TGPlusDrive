# TGPlusDrive

Tu nube personal ilimitada sobre Telegram. Gestor de archivos con interfaz tipo
Google Drive que usa **Mensajes guardados de Telegram** como almacenamiento.
Aplicación de escritorio para Windows (Electron + React + TypeScript + GramJS/MTProto).

> **Beta 0.1** — Todo vive en tu propia cuenta de Telegram. Sin servidores
> propios, sin telemetría, sin anuncios.

![TGPlusDrive: interfaz de la unidad sobre Telegram](<img width="1302" height="851" alt="Captura de pantalla 2026-11-09 205515" src="https://github.com/user-attachments/assets/281342b2-c23d-477f-9b10-75d810234cb7" />
)

---

## ¿Por qué TGPlusDrive?

Hay clientes de Telegram y hay nubes; TGPlusDrive intenta ser lo mejor de ambos:

- **Espacio ilimitado sin coste.** Usa los Mensajes guardados de tu propia
  cuenta; no hay cuota artificial ni servidores intermedios.
- **Privacidad por diseño.** Sin telemetría, sin analítica, sin anuncios. La
  sesión se cifra con DPAPI y solo se descifra en tu usuario de Windows.
- **Archivos gigantes resueltos de verdad.** Divide automáticamente por encima
  del límite de Telegram (2 GB / 4 GB), reanuda partes y sube una **herramienta
  offline** (`Recuperar TGPlusDrive.html`) para recomponer el archivo incluso
  sin la app.
- **Respaldo automático tipo OneDrive**, pero sobre Telegram: vigila una carpeta
  de tu PC, sube cambios, detecta renombres por hash, se puede pausar, protege
  la carpeta y permite **restaurarla al PC** con toda su estructura.
- **Reproductor profesional.** mpv en ventana propia con servidor local `Range`:
  seek instantáneo sin descargar el archivo completo.
- **Integridad y duplicados.** SHA-256 al subir y verificar al bajar; aviso de
  duplicados con *Sustituir* o *Subir copia*.
- **Búsqueda que perdona.** Encuentra `Currículum` escribiendo `curriculum` y
  `Presupuesto2026` escribiendo `presupuesto 2026`.
- **Multiperfil** (hasta 4 cuentas), login por teléfono o **QR**, temas claro y
  oscuro, y atajos de teclado.
- **Código abierto (GPL-3.0).** Auditable, compilable y sin dependencia de un
  servicio que pueda desaparecer.

---

## Características

### Organización
- Vista de cuadrícula y lista, búsqueda tolerante a tildes y espacios
  (`curriculum` encuentra `Currículum`, `presupuesto 2026` encuentra
  `Presupuesto2026`).
- Carpetas virtuales ilimitadas, breadcrumbs, ordenar por fecha/nombre/peso.
- Filtros por tipo: imágenes, videos, audio, texto y archivos.
- Destacados, papelera, restaurar y borrado definitivo.
- Selección múltiple, arrastrar y soltar, cortar/pegar y menú contextual.
- Temas claro y oscuro.

### Archivos
- Subida y descarga reales a Mensajes guardados (`peer = self`), con progreso,
  velocidad y ETA.
- Subida de **carpetas completas** conservando la estructura.
- Descarga y **restauración de carpetas** con todas sus subcarpetas.
- Renombrar, abrir y borrar; los archivos no multimedia se descargan en vez de
  intentar abrirse.
- **Archivos grandes**: se dividen automáticamente (límite 2 GB free / 4 GB
  Premium por archivo), con manifiesto reanudable y herramienta de recuperación
  offline (`Recuperar TGPlusDrive.html`) subida junto a las partes.
- **Integridad SHA-256**: se calcula al subir y se verifica al descargar.
- **Detección de duplicados**: aviso antes de subir con opciones *Sustituir* o
  *Subir copia*.
- Miniaturas locales de imágenes y videos (extraídas con mpv cuando Telegram no
  las genera).

### Reproducción
- Videos y audio en **mpv**, en su propia ventana, con seek instantáneo
  mediante un servidor HTTP local con soporte `Range`.
- La app nunca incrusta el reproductor; eso evita problemas de renderizado.

### Respaldo automático
- Espeja una carpeta de tu PC a una carpeta de la nube (nombre configurable).
- `fs.watch` recursivo + escaneo cada 10 minutos; detecta archivos nuevos,
  modificados y renombrados (por hash), sin volver a subir lo que no cambió.
- **No borra en Telegram** cuando borras en tu PC.
- La carpeta de respaldo se distingue con icono y color propios, siempre sale
  primero y muestra su estado: verde (activo), ámbar (en pausa) o gris
  (desactivado / carpeta local no disponible).
- **Protegida**: no se puede mover ni borrar mientras esté activa; borrar
  archivos dentro pide dos confirmaciones.
- **Pausar/Reanudar** y progreso detallado (archivo actual, X/Y, velocidad, ETA).
- Restaurar el respaldo al PC conservando toda la estructura.

### Cuentas
- Multiperfil (hasta 4 cuentas de Telegram).
- Login por **número + código** o **QR** (escaneado desde el móvil).
- Sesión cifrada con DPAPI de Windows; copiarla a otro equipo no sirve.

---

## Requisitos

- Windows 10/11 x64
- Cuenta de Telegram
- Credenciales `api_id` y `api_hash` desde
  https://my.telegram.org → *API development tools*
- ~1.5 GB de disco para la app (incluye mpv)

---

## Instalación

Descarga el instalador desde la página de releases y ejecútalo.

- `TGPlusDrive Setup x.y.z.exe` — instalador NSIS (recomendado).
- `TGPlusDrive x.y.z.exe` — versión portable (tarda más en arrancar porque
  descomprime los recursos).

> **Aviso:** el ejecutable no está firmado con un certificado de code signing.
> Windows SmartScreen puede mostrar "Windows protegió tu PC". Para continuar,
> pulsa *Más información → Ejecutar de todas formas*. Puedes verificar la
> integridad del archivo con el hash SHA-256 publicado junto a cada release.
>
> Si eres desarrollador y quieres compilarlo tú mismo, es la vía más segura:
> el código es abierto y reproducible (ver sección Desarrollo).

---

## Primer uso

1. Abre la app y elige **Iniciar sesión**.
2. Introduce `api_id`, `api_hash` y tu número (con código de país).
3. Escanea el QR desde Telegram → Ajustes → Dispositivos → Vincular
   dispositivo, o introduce el código que recibas.
4. Los archivos se suben a **Mensajes guardados** de tu cuenta.
5. Arrastra archivos o carpetas a la ventana, o usa **Subir**.

---

## Dónde se guardan tus datos

```
%APPDATA%\tgplusdrive\
  profiles.json                 registro de perfiles
  credentials.bin               api_id/api_hash cifrados con DPAPI
  backups\<id>.json             manifiesto del respaldo automático
  profiles\<user_id>\
    session.enc                 sesión MTProto cifrada con DPAPI
    vfs.json                    árbol de carpetas y metadatos
    thumbs\  preview\           caché de miniaturas
```

- La sesión **solo se descifra en tu usuario de Windows**. Copiar la carpeta a
  otro equipo no sirve: hay que volver a iniciar sesión.
- Pasar el programa a otra persona **no comparte tu cuenta ni tus archivos**:
  esa persona inicia su propia sesión y ve sus propios Mensajes guardados.
- El instalador **no contiene credenciales**. Se verifican ausentes en el
  binario.

---

## Cómo funciona por dentro

- Telegram no tiene carpetas: TGPlusDrive mantiene un **VFS** (`vfs.json`) que
  mapea `id` lógico → `message_id`.
- Cada archivo se sube como documento con `forceDocument` (conserva el nombre).
- El índice serializado se sube a Mensajes guardados con el texto
  `TGPlusDrive Index v1 — NO BORRAR / DO NOT DELETE`; al iniciar sesión se busca
  el más reciente y se restaura/mezcla.
- Borrar definitivamente un archivo también borra su mensaje en Telegram.
- El servidor local (`127.0.0.1`) solo sirve bytes de tu propia cuenta y se usa
  para que mpv pueda hacer seek sin descargar el archivo completo.

---

## Seguridad y límites

- **Telegram puede acceder al contenido** de Mensajes guardados. Hay cifrado en
  tránsito y en reposo en sus servidores, pero no es cifrado extremo a extremo.
  Para privacidad total sería necesario cifrar el contenido y el índice con una
  passphrase (no implementado).
- El índice remoto no está cifrado: Telegram puede ver nombres y estructura.
- Límite por archivo: 2 GB (4 GB con Premium). Total ilimitado en la práctica.
- Errores `FLOOD_WAIT` de Telegram se muestran como errores de subida; reintenta
  más tarde.
- `credentials.bin` está cifrado, pero `profiles.json` incluye el `api_id` y
  `api_hash` en claro para restaurar perfiles. No compartas esa carpeta.

---

## Desarrollo

```powershell
npm.cmd install
npm.cmd run fetch:mpv  # descarga vendor/mpv/mpv.exe (no se versiona: >100 MB)
npm.cmd run dev        # desarrollo (usa otro userData)
npm.cmd run typecheck  # obligatorio antes de entregar
npm.cmd run build      # compila a out/ sin ofuscar
npm.cmd run dist       # build + ofuscado + mpv + electron-builder
```

Para entender el diseño interno, decisiones y trampas conocidas, ver
[`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

> `vendor/mpv/mpv.exe` pesa ~115 MB y GitHub rechaza archivos de más de 100 MB,
> así que **no está en el repositorio**. `npm run fetch:mpv` lo descarga desde
> [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild/releases).
> `npm run dist` lo descarga automáticamente si falta (`predist`).

> En PowerShell, `npm` puede estar bloqueado por la política de ejecución;
> usa `npm.cmd`.

Salidas de `dist` (en `release/`):

- `TGPlusDrive 0.1.0.exe` (portable)
- `TGPlusDrive Setup 0.1.0.exe` (NSIS, recomendado)

### Estructura

```
src/main/        proceso principal: ventana, IPC, Telegram, VFS, respaldo, mpv
src/preload/     puente seguro (contextBridge)
src/renderer/    React + Tailwind (interfaz)
src/shared/      tipos y contrato IPC compartidos
scripts/         utilidades de build (ofuscado, icono de mpv, Electron)
vendor/mpv/      binario de mpv (se empaqueta en resources/mpv)
```

---

## Firma de código

El instalador se publica **sin firmar** hasta que se configure la firma. Hay dos
caminos:

### SignPath (gratis para proyectos open source, recomendado)

El workflow de release ya está preparado. Solo hay que crear la cuenta y los
secretos:

1. Crea la cuenta y el proyecto en https://signpath.io (plan Open Source).
2. Configura los slugs `tgplusdrive`, `release-signing` y
   `windows-installers` (el XML está en
   [`docs/signpath-artifact-configuration.xml`](docs/signpath-artifact-configuration.xml)).
3. Añade los secretos `SIGNPATH_API_TOKEN` y `SIGNPATH_ORGANIZATION_ID` en
   GitHub → Settings → Secrets → Actions.

El siguiente tag firmará automáticamente y SmartScreen dejará de avisar.
Guía detallada: [`docs/PUBLICAR.md`](docs/PUBLICAR.md).

### Certificado propio (.pfx)

1. Obtén un certificado OV/EV en `.pfx`.
2. Define antes de `npm.cmd run dist`:

   ```powershell
   $env:CSC_LINK = "C:\ruta\certificado.pfx"
   $env:CSC_KEY_PASSWORD = "tu-contraseña"
   ```

3. `electron-builder` firma el `.exe` y el instalador con sello de tiempo.

También se puede configurar en `package.json` → `build.win.signtoolOptions`
(`certificateFile`, `certificatePassword`, `certificateSubjectName`,
`rfc3161TimeStampServer`). Sin certificado, la build funciona pero SmartScreen
avisa.

---

## Historial del proyecto

El registro de lo construido y el estado actual está en
[`docs/HISTORIAL.md`](docs/HISTORIAL.md). Para colaborar o continuar el
desarrollo, lee también [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia y terceros

- **Código:** [GPL-3.0-or-later](LICENSE). Es software libre: puedes usarlo,
  estudiarlo, modificarlo y redistribuirlo bajo los mismos términos.
- **Marca y nombre:** TGPlusDrive y su identidad siguen siendo de Jatniel.
- **Terceros:** ver [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), con nota
  especial sobre la licencia GPL de **mpv**.

Telegram es una marca de Telegram FZ-LLC. TGPlusDrive no está afiliado a
Telegram.

## Apoya el proyecto

TGPlusDrive es gratuito y sin anuncios. Si te resulta útil, puedes apoyar su
desarrollo con una donación por
[PayPal](https://www.paypal.com/donate/?hosted_button_id=JRW79EKXDN5MW) o desde
el botón **“Apoyar el proyecto”** de la app. Ver [`DONATIONS.md`](DONATIONS.md).
Las donaciones son voluntarias y no otorgan licencia, soporte ni derechos
adicionales.

### Gracias a quienes apoyan el proyecto

Este proyecto existe gracias a su comunidad. Si donas y quieres aparecer aquí,
dímelo y añado tu nombre (o tu alias). También agradezco de corazón a quienes
reportan errores, proponen mejoras, comparten la app o simplemente la usan.

<!-- Agradecimientos: añade nombres aquí cuando quieras, p. ej.
- @usuario — por ...
-->

---

Hecho con ♥ por **Jatniel**.
