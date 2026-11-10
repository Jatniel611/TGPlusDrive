<div align="center">

# ☁️ TGPlusDrive

### Tu nube ilimitada sobre Telegram

**Gestor de archivos tipo Google Drive que usa los Mensajes guardados de Telegram como almacenamiento.**
Gratis · Open source · Sin anuncios · Sin telemetría

[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white)](#-instalación)
[![GPL-3.0](https://img.shields.io/badge/Licencia-GPL--3.0-blue)](LICENSE)
[![Descargas](https://img.shields.io/github/downloads/Jatniel611/TGPlusDrive/total?color=34b27b)](https://github.com/Jatniel611/TGPlusDrive/releases)
[![Estrellas](https://img.shields.io/github/stars/Jatniel611/TGPlusDrive?color=ffcb47)](https://github.com/Jatniel611/TGPlusDrive/stargazers)

[⬇️ Descargar](https://github.com/Jatniel611/TGPlusDrive/releases/latest) · [🌐 Página web](https://jatniel611.github.io/TGPlusDrive/) · [💛 Apoyar](https://www.paypal.com/donate/?hosted_button_id=JRW79EKXDN5MW)

</div>

![Interfaz de TGPlusDrive](<img width="1302" height="851" alt="Captura de pantalla 2026-11-09 205515" src="https://github.com/user-attachments/assets/63ec9040-3ad9-4c9c-9737-b07da64fe3e0" />
)

---

## ✨ ¿Por qué TGPlusDrive?

Hay clientes de Telegram y hay nubes. TGPlusDrive intenta ser lo mejor de ambos:

| | |
|---|---|
| ♾️ **Espacio ilimitado sin coste** | Usa los Mensajes guardados de tu propia cuenta: sin cuotas artificiales ni servidores intermedios. |
| 🔐 **Privacidad por diseño** | Sin telemetría, sin analítica, sin anuncios. La sesión se cifra con DPAPI y solo se descifra en tu usuario de Windows. |
| 🗂️ **Archivos gigantes resueltos** | Divide automáticamente por encima del límite de Telegram (2 GB / 4 GB), reanuda partes e incluye herramienta offline para recomponerlos. |
| 🔄 **Respaldo automático** | Vigila una carpeta del PC, sube cambios, detecta renombres por hash, se pausa, se cancela y se restaura con toda la estructura. |
| 🎬 **Reproductor profesional** | mpv en ventana propia con seek instantáneo mediante un servidor local con soporte `Range`. |
| 🔎 **Búsqueda que perdona** | `curriculum` encuentra **Currículum** y `presupuesto 2026` encuentra **Presupuesto2026**. |
| 🧩 **Integridad y duplicados** | SHA-256 al subir y al bajar; aviso de duplicados con *Sustituir* o *Subir copia*. |
| 👥 **Multiperfil y QR** | Hasta 4 cuentas, inicio por teléfono o QR, temas claro y oscuro. |

---

## 🚀 Instalación

1. **Descarga** el instalador desde [Releases](https://github.com/Jatniel611/TGPlusDrive/releases/latest).
   - `TGPlusDrive.Setup.x.y.z.exe` → instalador NSIS **(recomendado)**
   - `TGPlusDrive.x.y.z.exe` → portable
2. **Instala** y abre la app.
3. Introduce tu `api_id` y `api_hash` de [my.telegram.org](https://my.telegram.org) → *API development tools*.
4. Inicia sesión con tu **teléfono** o escanea el **QR** desde Telegram.

> ⚠️ El ejecutable aún **no está firmado**. Windows SmartScreen puede avisar:
> *Más información → Ejecutar de todas formas*. Verifica el SHA-256 del release.

---

## 🧭 Primeros pasos

| Acción | Cómo |
|---|---|
| 📤 Subir | Arrastra archivos/carpetas a la ventana o pulsa **Subir** |
| 📁 Carpeta | Botón **Nueva carpeta** |
| ⬇️ Descargar | Clic derecho → **Descargar** (carpetas incluidas) |
| 🔄 Respaldo | Sidebar → **Respaldo automático** |
| ⚙️ Ajustes | Icono de **llave** en la barra superior |
| 🔔 Actualizaciones | Icono de **caja ámbar** con flecha |

---

## 🧰 Características técnicas

<details>
<summary><b>📦 Archivos y carpetas</b></summary>

- Subida y descarga reales a Mensajes guardados (`peer = self`), con progreso, velocidad y ETA.
- Subida de **carpetas completas** conservando la estructura.
- Descarga y restauración de carpetas con todas sus subcarpetas.
- Los archivos no multimedia se descargan en vez de intentar abrirse.
- Miniaturas locales de imágenes y videos (extraídas con mpv si Telegram no las genera).
- Etiquetas de formato (`MP4`, `MKV`, `RAR`, `PDF`…) sobre cada miniatura.

</details>

<details>
<summary><b>🗂️ Archivos grandes</b></summary>

- Límite de Telegram: 2 GB (gratis) / 4 GB (Premium).
- División automática en partes de 1.5 GiB con manifiesto reanudable.
- Herramienta offline **`Recuperar TGPlusDrive.html`** subida junto a las partes para unirlas sin la app.

</details>

<details>
<summary><b>🔄 Respaldo automático</b></summary>

- Espeja una carpeta local a una carpeta VFS de nivel superior.
- `fs.watch` recursivo + escaneo cada 10 minutos, con debounce.
- Detecta archivos nuevos, modificados y **renombrados por hash**.
- **No borra en Telegram** cuando borras en tu PC.
- La carpeta se distingue por color e icono, siempre sale primero y muestra su estado.
- **Protegida**: no se puede mover ni borrar mientras está activa.
- Pausar, reanudar y **cancelar**; progreso con archivo actual, X/Y, velocidad y ETA.
- Restaurar al PC conservando toda la estructura.

</details>

<details>
<summary><b>🔐 Seguridad</b></summary>

- Sesión MTProto cifrada con **DPAPI** de Windows; copiarla a otro equipo no sirve.
- Credenciales API cifradas en `credentials.bin`.
- Sin telemetría ni analítica.
- Todo se guarda en tu propia cuenta: no hay servidores de TGPlusDrive.

</details>

---

## 💻 Desarrollo

```powershell
npm.cmd install
npm.cmd run fetch:mpv  # descarga vendor/mpv/mpv.exe (no se versiona: >100 MB)
npm.cmd run dev        # desarrollo con otro userData
npm.cmd run typecheck  # obligatorio antes de entregar
npm.cmd run build      # compila a out/ sin ofuscar
npm.cmd run dist       # build + ofuscado + mpv + electron-builder
```

> En PowerShell puede estar bloqueado `npm`; usa **`npm.cmd`**.

<details>
<summary><b>📁 Estructura del proyecto</b></summary>

```
src/main/        proceso principal: ventana, IPC, Telegram, VFS, respaldo, mpv
src/preload/     puente seguro (contextBridge)
src/renderer/    React + Tailwind (interfaz)
src/shared/      tipos y contrato IPC compartidos
scripts/         utilidades de build
vendor/mpv/      binario de mpv (se empaqueta en resources/mpv)
docs/            guías y página web (GitHub Pages)
```

Más detalles en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

</details>

---

## ❓ Preguntas frecuentes

<details>
<summary><b>¿Es realmente gratis e ilimitado?</b></summary>

Sí. No hay servidores propios: usa el almacenamiento de tu cuenta de Telegram. El único límite es el tamaño por archivo, que la app resuelve dividiéndolo.
</details>

<details>
<summary><b>¿Mis archivos están cifrados?</b></summary>

Viajan y se guardan cifrados en los servidores de Telegram, pero Telegram puede acceder a ellos. La sesión local sí está cifrada con DPAPI. El cifrado de extremo a extremo no está implementado.
</details>

<details>
<summary><b>¿Puedo borrar la app sin perder mis archivos?</b></summary>

Sí. Viven en tus Mensajes guardados. Al reinstalar y volver a iniciar sesión, el índice se restaura.
</details>

<details>
<summary><b>¿Por qué Windows avisa al instalar?</b></summary>

Porque el ejecutable aún no tiene firma de código. Es SmartScreen, no un virus. También puedes compilarlo tú mismo desde el código fuente.
</details>

---

## 🛠️ Stack

Electron · React · TypeScript · Tailwind CSS · GramJS (MTProto) · mpv · electron-builder

---

## 💛 Apoya el proyecto

TGPlusDrive es gratuito y sin anuncios. Si te resulta útil, puedes apoyar su desarrollo:

- 💰 [Donar por PayPal](https://www.paypal.com/donate/?hosted_button_id=JRW79EKXDN5MW)
- ⭐ Dar una estrella al repositorio
- 🐞 Reportar errores o proponer mejoras en [Issues](https://github.com/Jatniel611/TGPlusDrive/issues)

Las donaciones son voluntarias y no otorgan licencia, soporte ni derechos adicionales.
Ver [`DONATIONS.md`](DONATIONS.md).

---

## 📄 Licencia y terceros

- **Código:** [GPL-3.0-or-later](LICENSE).
- **Terceros:** [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) — incluye la nota GPL de **mpv**.

Telegram es una marca de Telegram FZ-LLC. TGPlusDrive **no está afiliado** a Telegram.

---

<div align="center">

**Hecho con ❤️ por [Jatniel](https://github.com/Jatniel611)**

</div>
