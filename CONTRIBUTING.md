# Contribuir a TGPlusDrive

Gracias por querer ayudar. Este documento resume cómo trabajar en el proyecto.

## Antes de empezar

- Revisa los issues abiertos para no duplicar trabajo.
- Para cambios grandes, abre un issue primero y acordamos el enfoque.
- Al enviar un PR aceptas que tu contribución se licencie bajo
  GPL-3.0-or-later, igual que el resto del proyecto.

## Entorno

Requisitos: Windows 10/11 x64, Node.js 20+ (probado con Node 24).

```powershell
npm.cmd install
npm.cmd run dev
```

En PowerShell puede estar bloqueado `npm`; usa `npm.cmd`.

## Antes de enviar un PR

```powershell
npm.cmd run typecheck   # obligatorio
npm.cmd run build       # debe compilar
```

- No subas `node_modules/`, `out/`, `release/`, `output/` ni `*.tsbuildinfo`.
- No incluyas credenciales, sesiones ni archivos de `%APPDATA%\tgplusdrive`.
- Mantén el estilo del código existente (sin comentarios innecesarios, tipos
  estrictos, componentes funcionales).
- Si tocas UI, adjunta captura o GIF.

## Estilo

- TypeScript estricto; evita `any`.
- Componentes React funcionales con hooks.
- Textos de interfaz en español, tono claro y corto.
- Nombres de archivos y funciones en inglés; mensajes al usuario en español.

## Áreas donde hace falta ayuda

- Tests de `store`, `backup`, `hash` y búsqueda.
- Filtros de exclusión para el respaldo (`node_modules`, `.git`, temporales).
- Reanudación de subidas grandes del respaldo.
- Firma de código y CI de releases.
- Traducciones (la UI está en español).

## Reportes de errores

Incluye versión, pasos para reproducir, resultado esperado y real, y capturas o
logs. No adjuntes datos personales ni credenciales.
