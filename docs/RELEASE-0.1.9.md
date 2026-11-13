# TGPlusDrive 0.1.9 (Beta)

Tu nube personal ilimitada sobre Telegram. Una app de escritorio con interfaz
tipo Google Drive que usa tus **Mensajes guardados** como almacenamiento. Sin
servidores propios, sin telemetría y sin anuncios.

> Instalador **sin firmar**. Windows SmartScreen puede avisar; usa *Más
> información → Ejecutar de todas formas* y verifica el SHA-256 de
> `SHA256SUMS.txt`.

## Descargas

- **TGPlusDrive.Setup.0.1.9.exe** — instalador NSIS (recomendado).
- **TGPlusDrive.0.1.9.exe** — portable (tarda más en arrancar).

## Novedades de esta versión

- **Subida de partes en paralelo**: los archivos divididos suben 2 partes a la vez
  (antes 1), acelerando los archivos grandes tal como ya pasaba al descargarlos.
  La reanudacion y la herramienta de recuperacion siguen funcionando igual.

## Lo más destacado

- **Espacio ilimitado sin coste** usando tu propia cuenta de Telegram.
- **Archivos gigantes** (>2 GB / >4 GB Premium): división automática, reanudación
  de partes y herramienta offline `Recuperar TGPlusDrive.html` para recomponerlos
  incluso sin la app.
- **Respaldo automático** de una carpeta del PC: vigila cambios, detecta renombres
  por hash, se puede pausar, cancelar y restaurar al PC con toda la estructura.
- **Duplicados e integridad**: SHA-256 al subir y al bajar, aviso de duplicados con
  *Sustituir* o *Subir copia*.
- **Reproductor mpv** en ventana propia con seek instantáneo (servidor local
  `Range`).
- **Búsqueda inteligente**: `curriculum` encuentra `Currículum` y
  `presupuesto 2026` encuentra `Presupuesto2026`.
- **Carpetas completas**: subir, descargar y restaurar conservando subcarpetas.
- **Multiperfil** (hasta 4 cuentas), login por teléfono o QR, temas claro/oscuro.
- **Código abierto** (GPL-3.0).

## Primer uso

1. Instala y abre la app.
2. Introduce tu `api_id` y `api_hash` de https://my.telegram.org.
3. Inicia sesión con teléfono o escanea el QR.
4. Arrastra archivos o carpetas a la ventana.

## Requisitos

Windows 10/11 x64 · Cuenta de Telegram · credenciales de API.

## Notas

- Beta: pueden existir errores. Reporta en Issues.
- Incluye mpv (GPLv2+/LGPLv2.1+). Ver `THIRD-PARTY-NOTICES.md`.
- Si te resulta útil, puedes apoyar el proyecto:
  https://www.paypal.com/donate/?hosted_button_id=JRW79EKXDN5MW

Gracias por probar TGPlusDrive. ♥
