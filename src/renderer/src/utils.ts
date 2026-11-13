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

/** Extensión normalizada del nombre ("pelicula.RAR" -> "rar"). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Puntúa una coincidencia (menor = mejor) o devuelve -1 si no coincide.
 *
 * Reglas, de mejor a peor:
 * 1. Nombre idéntico (sin tildes/signos/mayúsculas).
 * 2. El nombre empieza por la consulta.
 * 3. La consulta es la extensión del archivo (ej. "rar", "mkv").
 * 4. Algunas palabras del nombre empiezan por la consulta.
 * 5. La consulta aparece dentro del nombre compacto (solo consultas de 4+).
 * 6. Coincidencia por mayoría de palabras, tolerando que falte alguna (por
 *    ejemplo, buscar un título con el año cuando el nombre no lo incluye).
 */
export function searchScore(name: string, query: string): number {
  const compactQuery = searchCompact(query)
  if (!compactQuery) return -1
  const compactName = searchCompact(name)
  if (!compactName) return -1

  if (compactName === compactQuery) return 0
  if (compactName.startsWith(compactQuery)) return 1

  const nameTokens = searchTokens(name)
  const queryTokens = searchTokens(query).filter((token) => token.length >= 2)
  if (queryTokens.length === 0) return -1

  // Extensión exacta: buscar "rar" o "mkv" ordena esos archivos primero.
  if (queryTokens.length === 1 && extensionOf(name) === queryTokens[0]) return 2

  // Una sola palabra: solo cuenta si alguna palabra del nombre empieza por ella.
  if (queryTokens.length === 1) {
    const token = queryTokens[0]
    if (nameTokens.some((nameToken) => nameToken.startsWith(token))) return 3
    if (compactQuery.length >= 4 && compactName.includes(compactQuery)) return 4
    return -1
  }

  // Varias palabras: mayoría clara, comparando solo prefijos en la dirección
  // correcta (la consulta empieza la palabra del nombre).
  let matched = 0
  let exact = 0
  for (const token of queryTokens) {
    if (nameTokens.some((nameToken) => nameToken === token)) {
      matched += 1
      exact += 1
    } else if (nameTokens.some((nameToken) => nameToken.startsWith(token))) {
      matched += 1
    }
  }

  if (matched === 0) return -1
  if (matched / queryTokens.length < 0.6) return -1

  const missing = queryTokens.length - matched
  return 5 + missing * 2 - exact * 0.25
}
