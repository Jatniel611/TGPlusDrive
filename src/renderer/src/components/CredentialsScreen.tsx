import { useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck
} from 'lucide-react'
import { Logo } from './Logo'

interface Props {
  onBack: () => void
  onSubmit: (creds: { apiId: string; apiHash: string }) => Promise<void>
}

const PORTAL_URL = 'https://my.telegram.org/apps'

function validateApiId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Escribe tu api_id'
  if (!/^\d+$/.test(trimmed)) return 'El api_id solo tiene números (sin espacios)'
  const asNumber = Number(trimmed)
  if (!Number.isFinite(asNumber) || asNumber <= 0) return 'El api_id no es válido'
  if (trimmed.length < 5) return 'Un api_id suele tener al menos 5 dígitos'
  return null
}

function validateApiHash(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Escribe tu api_hash'
  if (!/^[0-9a-f]{32}$/i.test(trimmed)) {
    return 'El api_hash son exactamente 32 caracteres (letras a-f y números)'
  }
  return null
}

export function CredentialsScreen({ onBack, onSubmit }: Props): JSX.Element {
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const idError = validateApiId(apiId)
  const hashError = validateApiHash(apiHash)
  const valid = !idError && !hashError

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setTouched(true)
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ apiId: apiId.trim(), apiHash: apiHash.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-gradient-to-br from-[#e8f0fe] via-[#f8fafd] to-[#e6f4ea] p-6 dark:from-[#0f1115] dark:via-[#14171c] dark:to-[#10161a]">
      <div className="mx-auto w-full max-w-2xl py-6">
        <button
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>

        <div className="rounded-3xl bg-white/95 p-7 shadow-xl ring-1 ring-black/5 dark:bg-[#1b1e24]/95 dark:ring-white/10">
          <div className="mb-6 flex items-center gap-3">
            <Logo className="h-12 w-12" />
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                Conecta tu cuenta de Telegram
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Solo la primera vez. Es gratis y tarda 2 minutos.
              </p>
            </div>
          </div>

          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] leading-relaxed text-blue-900 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-100">
            <p className="mb-1 font-semibold">¿Por qué necesitas estos datos?</p>
            <p>
              TGPlusDrive se conecta a Telegram con <b>tu propia app</b>. Así tu cuenta y tus
              archivos no dependen de nadie más y no hay límites compartidos. Telegram te da
              esos dos datos gratis.
            </p>
          </div>

          <ol className="mb-6 space-y-4">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gd-blue text-[11px] font-bold text-white">
                1
              </span>
              <div className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  Abre esta página e inicia sesión con tu número de Telegram
                </p>
                <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                  Es la web oficial de Telegram para desarrolladores. Entra con el mismo número
                  que usas en tu móvil.
                </p>
                <a
                  href={PORTAL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gd-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
                >
                  Abrir my.telegram.org <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gd-blue text-[11px] font-bold text-white">
                2
              </span>
              <div className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  Entra en «API development tools»
                </p>
                <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                  Si te pide rellenar un formulario, pon cualquier nombre (por ejemplo
                  «TGPlusDrive»). Los demás campos puedes dejarlos como están.
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gd-blue text-[11px] font-bold text-white">
                3
              </span>
              <div className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  Copia «App api_id» y «App api_hash» aquí abajo
                </p>
                <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                  El <b>api_id</b> son solo números. El <b>api_hash</b> son 32 letras y números.
                </p>
              </div>
            </li>
          </ol>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                <KeyRound className="h-3.5 w-3.5" /> App api_id
              </span>
              <input
                value={apiId}
                onChange={(event) => setApiId(event.target.value)}
                onBlur={() => setTouched(true)}
                inputMode="numeric"
                placeholder="12345678"
                className={`w-full rounded-xl border bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 dark:bg-black/20 dark:text-slate-100 ${
                  touched && idError
                    ? 'border-red-300 focus:border-red-400 focus:ring-red-200/40 dark:border-red-500/50'
                    : 'border-slate-200 focus:border-gd-blue focus:ring-gd-blue/20 dark:border-white/10'
                }`}
              />
              {touched && idError && (
                <p className="mt-1 text-[11px] text-red-500">{idError}</p>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                <ShieldCheck className="h-3.5 w-3.5" /> App api_hash
              </span>
              <input
                value={apiHash}
                onChange={(event) => setApiHash(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="0123456789abcdef0123456789abcdef"
                spellCheck={false}
                className={`w-full rounded-xl border bg-slate-50 px-3.5 py-2.5 font-mono text-xs text-slate-800 outline-none focus:ring-2 dark:bg-black/20 dark:text-slate-100 ${
                  touched && hashError
                    ? 'border-red-300 focus:border-red-400 focus:ring-red-200/40 dark:border-red-500/50'
                    : 'border-slate-200 focus:border-gd-blue focus:ring-gd-blue/20 dark:border-white/10'
                }`}
              />
              {touched && hashError && (
                <p className="mt-1 text-[11px] text-red-500">{hashError}</p>
              )}
            </label>

            {apiId.trim() && apiHash.trim() && valid && (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Datos correctos, listo para continuar
              </p>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !valid}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gd-blue py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Guardando…' : 'Guardar y continuar'}
            </button>
          </form>

          <p className="mt-4 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            Estos datos se guardan cifrados solo en este equipo y no se envían a ningún
            servidor. Podrás iniciar sesión con teléfono o QR sin volver a escribirlos.
          </p>
        </div>
      </div>
    </div>
  )
}
