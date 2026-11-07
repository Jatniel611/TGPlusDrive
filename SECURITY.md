# Política de seguridad

## Versiones soportadas

Solo la última versión publicada recibe correcciones de seguridad.

| Versión | Soportada |
| --- | --- |
| 0.1.x (beta) | Sí |
| anteriores | No |

## Cómo reportar una vulnerabilidad

**No abras un issue público** para problemas de seguridad.

Envía un correo a _(tu correo de contacto)_ o usa el reporte privado de
vulnerabilidades de GitHub (Security → Advisories → Report a vulnerability).

Incluye, si puedes:

- Versión de TGPlusDrive y de Windows.
- Descripción del problema y su impacto.
- Pasos para reproducirlo.
- Prueba de concepto o capturas (sin datos personales).

## Qué esperar

- Confirmación de recepción en un plazo razonable.
- Evaluación y, si procede, parche en la siguiente versión.
- Crédito en las notas de la versión si lo deseas.

## Alcance

Este proyecto maneja credenciales de Telegram y archivos personales. Nos
interesan especialmente:

- Fugas de sesión (`session.enc`), credenciales (`credentials.bin`) o del
  `api_hash`.
- Ejecución de comandos o rutas no validadas.
- Exposición del servidor HTTP local (`127.0.0.1`) más allá de su uso previsto.
- Problemas en el manejo de rutas de respaldo/restauración.

## Buenas prácticas para usuarios

- Descarga solo desde la página oficial de releases.
- Verifica el hash SHA-256 publicado.
- No compartas `%APPDATA%\tgplusdrive` (contiene tus credenciales y sesión).
- Mantén Windows y Telegram actualizados.
