import type { Profile } from '@shared/types'
import { Cloud, LogIn, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { formatDate, initials } from '../utils'
import { Logo } from './Logo'

const MAX_PROFILES = 4

interface Props {
  profiles: Profile[]
  error?: string | null
  busy?: boolean
  onActivate: (id: string) => void
  onConnect: () => void
  onRemove: (id: string) => void
}

export function Onboarding({
  profiles,
  error,
  busy,
  onActivate,
  onConnect,
  onRemove
}: Props): JSX.Element {
  return (
    <div className="h-full w-full bg-gradient-to-br from-[#e8f0fe] via-[#f8fafd] to-[#e6f4ea] dark:from-[#0f1115] dark:via-[#14171c] dark:to-[#10161a] flex items-center justify-center p-8">
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Logo className="h-16 w-16 drop-shadow-lg" />
          <div>
            <h1 className="text-3xl font-semibold text-slate-800 dark:text-slate-100 tracking-tight">
              TGPlus<span className="text-gd-blue">Drive</span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Tu nube ilimitada sobre Telegram
            </p>
          </div>
        </div>

        <div className="rounded-3xl bg-white/90 dark:bg-[#1b1e24]/90 backdrop-blur shadow-xl ring-1 ring-black/5 dark:ring-white/10 p-8">
          {error && (
            <div className="mb-6 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {profiles.length > 0 ? (
            <>
              <h2 className="text-lg font-medium text-slate-800 dark:text-slate-100 mb-1">
                Elige tu unidad
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                Cada cuenta guarda su propia sesión y organización de archivos.
              </p>
              <ul className="space-y-2 mb-6">
                {profiles.map((profile) => (
                  <li
                    key={profile.id}
                    className="group flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-white/10 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-semibold text-white bg-gradient-to-br from-sky-500 to-blue-600">
                      {initials(profile.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                          {profile.name}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide rounded-full bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-300 px-2 py-0.5">
                          Telegram
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Último uso: {formatDate(profile.lastUsedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => onActivate(profile.id)}
                      disabled={busy}
                      className="rounded-full bg-gd-blue px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                      Abrir
                    </button>
                    <button
                      onClick={() => onRemove(profile.id)}
                      title="Quitar perfil"
                      className="rounded-full p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>

              <button
                onClick={onConnect}
                disabled={busy || profiles.length >= MAX_PROFILES}
                title={
                  profiles.length >= MAX_PROFILES
                    ? `Límite de ${MAX_PROFILES} cuentas alcanzado`
                    : undefined
                }
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
              >
                <Plus className="h-4 w-4" />
                {profiles.length >= MAX_PROFILES
                  ? `Límite de ${MAX_PROFILES} cuentas alcanzado`
                  : 'Conectar otra cuenta de Telegram'}
              </button>
              <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
                {profiles.length} de {MAX_PROFILES} cuentas
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-medium text-slate-800 dark:text-slate-100 mb-2">
                Inicia sesión con Telegram
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Usa tu cuenta real y Mensajes guardados como almacenamiento ilimitado. Sin
                canales, sin bots, todo privado.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <button
                  onClick={onConnect}
                  disabled={busy}
                  className="group rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 p-5 text-left text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all disabled:opacity-60"
                >
                  <LogIn className="h-8 w-8 mb-3" />
                  <div className="font-semibold">Iniciar sesión</div>
                  <div className="text-xs text-blue-100 mt-1">
                    Con tu número de teléfono o código QR
                  </div>
                </button>
                <button
                  onClick={onConnect}
                  disabled={busy}
                  className="group rounded-2xl border border-slate-200 dark:border-white/10 p-5 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors disabled:opacity-60"
                >
                  <Cloud className="h-8 w-8 mb-3 text-sky-500" />
                  <div className="font-semibold text-slate-800 dark:text-slate-100">
                    Conectar Telegram
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Vincula tu cuenta en segundos
                  </div>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" /> Sesión cifrada en tu equipo
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Cloud className="h-4 w-4 text-sky-500" /> Almacenamiento ilimitado
                </span>
              </div>

              {busy && (
                <p className="mt-4 text-sm text-gd-blue animate-pulse">Preparando tu unidad…</p>
              )}
            </>
          )}
        </div>

        <div className="mt-7 flex flex-col items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 shadow-sm ring-1 ring-slate-200/70 backdrop-blur dark:bg-white/[0.06] dark:ring-white/10">
            <span className="text-xs text-slate-500 dark:text-slate-400">Hecho con</span>
            <span className="text-base leading-none text-rose-500">♥</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">por</span>
            <span className="text-sm font-bold tracking-wide text-gd-blue">Jatniel</span>
          </div>
          <p className="text-center text-[11px] text-slate-400 dark:text-slate-600">
            TGPlusDrive · tus archivos viven en tu cuenta de Telegram
          </p>
        </div>
      </div>
    </div>
  )
}
