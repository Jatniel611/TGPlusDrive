import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, Provider } from '@shared/types'
import { ensureDir, readJson, writeJsonAtomic } from './fsutil'

/** Límite de cuentas simultáneas. Cada perfil mantiene conexión y VFS en RAM. */
export const MAX_PROFILES = 4

function rootDir(): string {
  return join(app.getPath('userData'), 'profiles')
}

function registryFile(): string {
  return join(app.getPath('userData'), 'profiles.json')
}

export function profileDir(id: string): string {
  return join(rootDir(), id)
}

export function listProfiles(): Profile[] {
  const list = readJson<Profile[]>(registryFile(), [])
  return list
    .filter((profile) => profile.provider === 'telegram')
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export function getProfile(id: string): Profile | undefined {
  return listProfiles().find((p) => p.id === id)
}

export function saveProfiles(profiles: Profile[]): void {
  writeJsonAtomic(registryFile(), profiles)
}

export function upsertProfile(input: {
  id: string
  name: string
  provider: Provider
  apiId?: number
  apiHash?: string
}): Profile {
  ensureDir(rootDir())
  const profiles = listProfiles()
  const existing = profiles.find((p) => p.id === input.id)
  const now = Date.now()
  if (existing) {
    existing.name = input.name || existing.name
    existing.lastUsedAt = now
    if (input.apiId) existing.apiId = input.apiId
    if (input.apiHash) existing.apiHash = input.apiHash
    saveProfiles(profiles)
    return existing
  }
  const profile: Profile = {
    id: input.id,
    name: input.name,
    provider: input.provider,
    createdAt: now,
    lastUsedAt: now,
    apiId: input.apiId,
    apiHash: input.apiHash
  }
  profiles.push(profile)
  saveProfiles(profiles)
  ensureDir(profileDir(profile.id))
  if (input.apiId && input.apiHash) {
    saveAppCredentials({ apiId: input.apiId, apiHash: input.apiHash })
  }
  return profile
}

export function touchProfile(id: string): void {
  const profiles = listProfiles()
  const profile = profiles.find((p) => p.id === id)
  if (profile) {
    profile.lastUsedAt = Date.now()
    saveProfiles(profiles)
  }
}

export function removeProfile(id: string): void {
  saveProfiles(listProfiles().filter((p) => p.id !== id))
  const dir = profileDir(id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/** Quita el perfil de la lista pero CONSERVA su carpeta (vfs.json, thumbs...). */
export function unlistProfile(id: string): void {
  saveProfiles(listProfiles().filter((p) => p.id !== id))
}

function credentialsFile(): string {
  return join(app.getPath('userData'), 'credentials.bin')
}

export interface AppCredentials {
  apiId: number
  apiHash: string
}

export function saveAppCredentials(creds: AppCredentials): void {
  if (!Number.isFinite(creds.apiId) || creds.apiId <= 0 || !creds.apiHash) return
  const payload = JSON.stringify(creds)
  // Se guarda SOLO cifrado (DPAPI). El antiguo credentials.json en texto plano
  // se elimina para no dejar el api_id/api_hash legibles en disco.
  removeLegacyCredentials()
  try {
    if (safeStorage.isEncryptionAvailable()) {
      writeFileSync(credentialsFile(), safeStorage.encryptString(payload))
    } else {
      writeFileSync(credentialsFile(), `plain:${Buffer.from(payload, 'utf8').toString('base64')}`, 'utf8')
    }
  } catch {
    /* ignore */
  }
}

function legacyCredentialsFile(): string {
  return join(app.getPath('userData'), 'credentials.json')
}

function removeLegacyCredentials(): void {
  try {
    const file = legacyCredentialsFile()
    if (existsSync(file)) rmSync(file, { force: true })
  } catch {
    /* ignore */
  }
}

export function clearAppCredentials(): void {
  for (const file of [credentialsFile(), legacyCredentialsFile()]) {
    try {
      if (existsSync(file)) rmSync(file, { force: true })
    } catch {
      /* ignore */
    }
  }
}

export function loadAppCredentials(): AppCredentials | null {
  const envId = Number(process.env['TGPLUSDRIVE_API_ID'])
  const envHash = process.env['TGPLUSDRIVE_API_HASH']
  if (Number.isFinite(envId) && envId > 0 && envHash) {
    return { apiId: envId, apiHash: envHash.trim() }
  }

  // Migración: si existe el archivo legado en texto plano, se importa y se borra.
  const legacy = legacyCredentialsFile()
  if (existsSync(legacy)) {
    try {
      const text = readFileSync(legacy, 'utf8').replace(/^\uFEFF/, '').trim()
      const parsed = JSON.parse(text) as AppCredentials
      if (parsed.apiId && parsed.apiHash) {
        saveAppCredentials(parsed)
        return parsed
      }
    } catch {
      /* ignore */
    }
    removeLegacyCredentials()
  }

  const file = credentialsFile()
  if (!existsSync(file)) return null
  const raw = readFileSync(file)
  let text: string
  if (raw.toString('utf8').startsWith('plain:')) {
    text = Buffer.from(raw.toString('utf8').slice(6), 'base64').toString('utf8')
  } else {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null
      text = safeStorage.decryptString(raw)
    } catch {
      return null
    }
  }
  try {
    const parsed = JSON.parse(text) as AppCredentials
    if (!parsed.apiId || !parsed.apiHash) return null
    return parsed
  } catch {
    return null
  }
}

function sessionFile(id: string): string {
  return join(profileDir(id), 'session.enc')
}

export function saveSession(id: string, session: string): void {
  ensureDir(profileDir(id))
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(session)
    writeFileSync(sessionFile(id), encrypted)
  } else {
    writeFileSync(sessionFile(id), `plain:${Buffer.from(session, 'utf8').toString('base64')}`, 'utf8')
  }
}

export function loadSession(id: string): string | null {
  const file = sessionFile(id)
  if (!existsSync(file)) return null
  const raw = readFileSync(file)
  const text = raw.toString('utf8')
  if (text.startsWith('plain:')) {
    return Buffer.from(text.slice(6), 'base64').toString('utf8')
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(raw)
    }
  } catch {
    return null
  }
  return null
}

export function hasSession(id: string): boolean {
  return existsSync(sessionFile(id))
}

export function clearSession(id: string): void {
  const file = sessionFile(id)
  if (existsSync(file)) rmSync(file, { force: true })
}
