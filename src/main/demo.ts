import { copyFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Profile } from '@shared/types'
import { profileDir } from './profiles'
import { ensureDir } from './fsutil'

function demoDir(profile: Profile): string {
  return join(profileDir(profile.id), 'demo-files')
}

export function demoAddFile(profile: Profile, sourcePath: string): { localName: string; size: number } {
  ensureDir(demoDir(profile))
  const localName = `${randomUUID()}__${sourcePath.split(/[\\/]/).pop() ?? 'archivo'}`
  copyFileSync(sourcePath, join(demoDir(profile), localName))
  return { localName, size: statSync(sourcePath).size }
}

export function demoCopyOut(profile: Profile, localName: string, dest: string): void {
  const src = join(demoDir(profile), localName)
  if (!existsSync(src)) throw new Error('Archivo no encontrado en el almacenamiento local')
  copyFileSync(src, dest)
}

export function demoPath(profile: Profile, localName: string): string {
  return join(demoDir(profile), localName)
}

export function demoDelete(profile: Profile, localName: string): void {
  const file = join(demoDir(profile), localName)
  if (existsSync(file)) rmSync(file, { force: true })
}
