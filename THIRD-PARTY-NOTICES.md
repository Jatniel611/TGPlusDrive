# Avisos de terceros — TGPlusDrive

TGPlusDrive incluye y/o distribuye los siguientes componentes de terceros.
Cada uno conserva sus propios derechos de autor y licencia.

## Componentes empaquetados (se distribuyen con la app)

| Componente | Versión | Licencia | Proyecto |
| --- | --- | --- | --- |
| Electron | 34.5.8 | MIT | https://github.com/electron/electron |
| Chromium (incluido en Electron) | — | BSD-3-Clause y otras | https://www.chromium.org/ |
| Node.js (incluido en Electron) | — | MIT | https://nodejs.org/ |
| React | 18.3.1 | MIT | https://github.com/facebook/react |
| React DOM | 18.3.1 | MIT | https://github.com/facebook/react |
| GramJS (`telegram`) | 2.26.22 | MIT | https://github.com/gram-js/gramjs |
| `qrcode` | 1.5.4 | MIT | https://github.com/soldair/node-qrcode |
| `big-integer` | 1.6.52 | Unlicense | https://github.com/peterolson/BigInteger.js |
| `lucide-react` | 0.474.0 | ISC | https://github.com/lucide-icons/lucide |
| **mpv** | — | **GPLv2+ / LGPLv2.1+** | https://mpv.io/ |

## Componentes de desarrollo (no se distribuyen)

| Componente | Versión | Licencia |
| --- | --- | --- |
| electron-vite | 3.1.0 | MIT |
| Vite | 6.4.5 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| Tailwind CSS | 3.4.19 | MIT |
| PostCSS | 8.5.32 | MIT |
| Autoprefixer | 10.6.2 | MIT |
| javascript-obfuscator | 5.10.0 | BSD-2-Clause |
| electron-builder | 26.18.0 | MIT |

---

## Aviso especial sobre mpv (GPL/LGPL)

TGPlusDrive **distribuye el binario `mpv.exe`** en `resources/mpv/` y lo ejecuta
como proceso externo (nunca enlazado dentro de la app). mpv es software libre
bajo GPLv2 o posterior (y partes bajo LGPLv2.1 o posterior).

Esto implica:

1. Debes incluir el texto de la licencia de mpv y el aviso de copyright de sus
   autores originales al distribuir el instalador.
2. Debes ofrecer el **código fuente correspondiente de mpv** (o un enlace al
   mismo) a quien reciba el binario. El código fuente oficial está en
   https://github.com/mpv-player/mpv y las versiones compiladas para Windows en
   https://sourceforge.net/projects/mpv-player-windows/files/.
3. Si modificas `mpv.exe` (por ejemplo con la aplicación de icono de
   `scripts/brand-mpv.cjs`), esa modificación también queda sujeta a la GPL.
   La aplicación del icono es un cambio de recursos; conserva el aviso de
   licencia y ofrece el binario modificado con su fuente/instrucciones.
4. La ejecución de mpv como proceso separado mediante `child_process` no
   convierte a TGPlusDrive en una obra derivada de mpv, pero la redistribución
   del binario sí activa las obligaciones anteriores.

### Compatibilidad con la licencia del proyecto

TGPlusDrive se distribuye bajo **GPL-3.0-or-later**, que es compatible con el
mpv GPLv2+ que se empaqueta. Por eso cada release debe publicar, junto a los
binarios:

- El **código fuente completo** de TGPlusDrive (o enlace al repositorio y al tag
  exacto de la versión).
- El texto de `LICENSE` (GPL-3.0).
- Este archivo de avisos.
- Instrucciones para obtener el fuente de mpv (`mpv-build`/enlaces oficiales).

Se recomienda que el repositorio sea público; así el requisito de "fuente
correspondiente" queda cubierto por el propio repo y sus releases.

---

## Marcas

Telegram es una marca de Telegram FZ-LLC. TGPlusDrive no está afiliado,
patrocinado ni respaldado por Telegram. El uso de la API oficial de Telegram
está sujeto a sus Términos de Servicio: https://telegram.org/tos

Windows es una marca de Microsoft Corporation.
