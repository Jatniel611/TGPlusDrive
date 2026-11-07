export function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function formatDate(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return `Hoy, ${date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
  }
  return date.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Minúsculas, sin tildes y sin signos: "Visión.Quest" -> "visionquest". */
export function searchCompact(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

/** Palabras normalizadas para búsquedas por varios términos. */
export function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Puntúa una coincidencia (menor = mejor) o devuelve -1 si no coincide.
 * Tolera tildes, mayúsculas, puntos/guiones/paréntesis y orden de palabras.
 */
export function searchScore(name: string, query: string): number {
  const compactQuery = searchCompact(query)
  if (!compactQuery) return -1
  const compactName = searchCompact(name)

  if (compactName === compactQuery) return 0
  if (compactName.startsWith(compactQuery)) return 1
  if (compactName.includes(compactQuery)) return 2

  const nameTokens = searchTokens(name)
  const queryTokens = searchTokens(query)
  if (queryTokens.length === 0) return -1
  const allTokens = queryTokens.every((token) =>
    nameTokens.some((nameToken) => nameToken.includes(token))
  )
  return allTokens ? 3 : -1
}
