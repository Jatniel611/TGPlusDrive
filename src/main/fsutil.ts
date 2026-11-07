import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function writeBufferAtomic(file: string, value: Buffer): void {
  ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, value)
  renameSync(tmp, file)
}
