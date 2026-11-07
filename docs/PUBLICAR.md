# Guía de publicación

Pasos para publicar una versión, con firma **gratuita** para proyectos open
source usando [SignPath.io](https://signpath.io).

## 1. Antes de publicar

```powershell
npm.cmd run typecheck
npm.cmd run dist
```

Comprueba que se generan:

- `release\TGPlusDrive 0.1.0.exe` (portable)
- `release\TGPlusDrive Setup 0.1.0.exe` (NSIS)

Calcula y publica los hashes:

```powershell
Get-ChildItem release -Filter *.exe |
  ForEach-Object { "$($_.Name)  $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
```

## 2. Checklist legal

- [ ] `LICENSE` es GPL-3.0-or-later y coincide con `package.json`.
- [ ] `THIRD-PARTY-NOTICES.md` actualizado (versiones de dependencias).
- [ ] El release incluye el **código fuente** del tag (GitHub lo hace solo).
- [ ] El release incluye `LICENSE` y `THIRD-PARTY-NOTICES.md` (van dentro del
      instalador, en `resources/`).
- [ ] Se indica dónde obtener el fuente de mpv.
- [ ] No hay credenciales ni `%APPDATA%\tgplusdrive` en el repo.
- [ ] `README.md` describe la versión real.

## 3. Subir el repositorio

```powershell
git init
git add .
git status                     # revisar que no entre basura ni secretos
git commit -m "TGPlusDrive 0.1.0"
git branch -M main
git remote add origin https://github.com/Jatniel611/TGPlusDrive.git
git push -u origin main
```

Revisa que `.gitignore` excluya `node_modules/`, `out/`, `release/`,
`output/`, `*.tsbuildinfo`, `*.pfx`, `*.env` y **`vendor/mpv/*.exe`**
(GitHub rechaza archivos de más de 100 MB).

## 4. Crear el release

```powershell
git tag v0.1.0
git push origin v0.1.0
```

El workflow `.github/workflows/release.yml` compila en Windows, calcula
`SHA256SUMS.txt` y crea un release **en borrador**. Revísalo y publícalo.

---

## 5. Firma gratuita con SignPath (elimina el aviso de SmartScreen)

SignPath ofrece firma de código **gratis para proyectos open source** con
licencia OSI (tu GPL-3.0 cumple). Requiere que el repositorio sea público y que
los jobs corran en runners de GitHub (es tu caso).

### 5.1 Crear la cuenta y el proyecto

1. Regístrate en https://signpath.io con tu cuenta de GitHub.
2. Solicita el plan **Open Source Code Signing** (Community).
3. En SignPath, crea una **Organization** (puede ser tu usuario) y un
   **Project** con:
   - **Slug:** `tgplusdrive`
   - **Repositorio:** `https://github.com/Jatniel611/TGPlusDrive`
4. Dentro del proyecto, crea una **Signing Policy**:
   - **Slug:** `release-signing`
   - Vinculada al certificado que te asigne el plan open source.
5. Crea un **Artifact Configuration**:
   - **Slug:** `windows-installers`
   - Pega el contenido de
     [`docs/signpath-artifact-configuration.xml`](signpath-artifact-configuration.xml).

   Ese XML firma todos los `.exe` del ZIP que sube GitHub Actions.

### 5.2 Instalar la GitHub App

1. En SignPath: **Organization → Trusted Build Systems → GitHub.com → Add**.
2. Autoriza e instala la **SignPath GitHub App** en el repositorio
   `Jatniel611/TGPlusDrive`.
3. Vuelve al proyecto de SignPath y vincula el Trusted Build System.

### 5.3 Crear el token de API

1. En SignPath: tu usuario → **API Tokens → New**.
2. Permiso: **submitter** en el proyecto `tgplusdrive`.
3. Copia el token (solo se muestra una vez).

### 5.4 Configurar los secretos en GitHub

En `https://github.com/Jatniel611/TGPlusDrive/settings/secrets/actions` crea
dos secretos:

| Nombre | Valor |
| --- | --- |
| `SIGNPATH_API_TOKEN` | el token del paso 5.3 |
| `SIGNPATH_ORGANIZATION_ID` | el ID de tu organización en SignPath (aparece en **Organization → Settings**) |

> Si además usas un certificado propio `.pfx`, define `CSC_LINK_BASE64` y
> `CSC_KEY_PASSWORD`. Si usas SignPath, deja esos dos vacíos.

### 5.5 Cómo funciona el workflow

El `release.yml` ya está preparado:

1. Compila los instaladores sin firmar.
2. Si existe `SIGNPATH_API_TOKEN`, los sube como artefacto de GitHub.
3. Llama a `signpath/github-action-submit-signing-request@v3`.
4. Sustituye los `.exe` por los firmados en `release/`.
5. Verifica la firma con `Get-AuthenticodeSignature`.
6. Calcula los hashes **de los archivos firmados**.
7. Crea el release en borrador.

Si aún no hay token, publica sin firmar (con el aviso en el README).

### 5.6 Primera firma

```powershell
git tag v0.1.1
git push origin v0.1.1
```

Ve a **Actions → Release** y comprueba en el log:

```
TGPlusDrive Setup 0.1.1.exe: Valid - CN=SignPath Foundation, O=...
```

Eso significa que SmartScreen dejará de avisar (con firma EV/OV de reputación
acreditada; el aviso puede tardar un poco en desaparecer del todo).

### 5.7 Solución de problemas

- **"Artifact configuration not found"** → revisa el slug
  `windows-installers` y que el XML esté guardado en el proyecto.
- **"Signing request rejected"** → normalmente falta vincular el Trusted Build
  System o el token no tiene permiso `submitter`.
- **"Project not found"** → revisa `project-slug` (`tgplusdrive`) y
  `signing-policy-slug` (`release-signing`).
- **El .exe firmado no reemplaza al original** → revisa el paso
  *Replace with signed installers* y que el ZIP conserve los nombres.

## 6. Después de publicar

- Publica los hashes SHA-256 en el release.
- Mantén `THIRD-PARTY-NOTICES.md` al día cuando actualices dependencias.
- Si aún no firmaste, avisa en el README de que el binario no está firmado.

## Nota sobre mpv y GPL

Al distribuir `mpv.exe` debes ofrecer su código fuente correspondiente. El
release de GitHub con el fuente del proyecto y los enlaces oficiales de mpv
cubren ese requisito; no elimines esos enlaces de `THIRD-PARTY-NOTICES.md`.
