import { useEffect, useState } from 'react'
import type { AuthMethod, AuthState } from '@shared/types'
import { ArrowLeft, Loader2, Lock, Phone, QrCode, ShieldCheck } from 'lucide-react'
import { Logo } from './Logo'

interface Props {
  state: AuthState
  defaultCredentials?: { apiId: string; apiHash: string }
  onStart: (
    creds: { apiId: string; apiHash: string },
    method: AuthMethod
  ) => Promise<void>
  onProvide: (field: 'phone' | 'code' | 'password', value: string) => Promise<void>
  onCancel: () => Promise<void>
  onBack: () => void
  onConfigure: () => void
}

export function AuthScreen({
  state,
  defaultCredentials,
  onStart,
  onProvide,
  onCancel,
  onBack,
  onConfigure
}: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [busy, setBusy] = useState(false)

  const step = state.step
  const canStart = Boolean(defaultCredentials)

  useEffect(() => {
    setValue('')
  }, [step])

  const start = async (chosen: AuthMethod): Promise<void> => {
    if (!defaultCredentials) return
    setBusy(true)
    try {
      await onStart(defaultCredentials, chosen)
    } finally {
      setBusy(false)
    }
  }

  const submitField = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!value.trim() || (step !== 'phone' && step !== 'code' && step !== 'password')) return
    setBusy(true)
    try {
      await onProvide(step, value.trim())
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    await onCancel()
    onBack()
  }

  const isField = step === 'phone' || step === 'code' || step === 'password'
  const isWorking = step === 'connecting' || step === 'qr'

  const title =
    step === 'qr'
      ? 'Vincula este equipo'
      : step === 'phone'
        ? 'Tu número de teléfono'
        : step === 'code'
          ? 'Código de verificación'
          : step === 'password'
            ? 'Verificación en dos pasos'
            : 'Iniciar sesión con Telegram'

  const subtitle =
    step === 'qr'
      ? 'Escanea el QR desde tu móvil: Telegram → Ajustes → Dispositivos → Vincular dispositivo.'
      : step === 'phone'
        ? 'Incluye el código de país. Ejemplo: +5215512345678'
        : step === 'code'
          ? 'Telegram te envió un código por la app o por SMS.'
          : step === 'password'
            ? state.error || 'Introduce tu contraseña de verificación en dos pasos.'
            : 'Accede con tu cuenta de Telegram. Tus archivos se guardan en Mensajes guardados.'

  return (
    <div className="h-full w-full bg-gradient-to-br from-[#e8f0fe] via-[#f8fafd] to-[#e6f4ea] dark:from-[#0f1115] dark:via-[#14171c] dark:to-[#10161a] flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        <button
          onClick={cancel}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>

        <div className="rounded-3xl bg-white/95 dark:bg-[#1b1e24]/95 backdrop-blur shadow-xl ring-1 ring-black/5 dark:ring-white/10 p-8">
          <div className="flex items-center gap-3 mb-6">
            <Logo className="h-12 w-12" />
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            </div>
          </div>

          {!canStart ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                Antes de conectar tu Telegram necesitamos una configuración de app gratuita
                que Telegram te da en 2 minutos. Te guiamos paso a paso.
              </div>
              <button
                onClick={onConfigure}
                className="w-full rounded-xl bg-gd-blue py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                Configurar mi app de Telegram
              </button>
            </div>
          ) : isField ? (
            <form onSubmit={submitField} className="space-y-4">
              {state.error && step !== 'password' && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {state.error}
                </div>
              )}
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  {step === 'phone' ? (
                    <>
                      <Phone className="h-3.5 w-3.5" /> Número de teléfono
                    </>
                  ) : step === 'code' ? (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5" /> Código
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" /> Contraseña
                    </>
                  )}
                </span>
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  type={step === 'password' ? 'password' : 'text'}
                  inputMode={step === 'code' ? 'numeric' : 'text'}
                  placeholder={
                    step === 'phone' ? '+5215512345678' : step === 'code' ? '12345' : '••••••••'
                  }
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-gd-blue focus:ring-2 focus:ring-gd-blue/20"
                />
              </label>
              {step === 'password' && state.error && (
                <p className="text-xs text-slate-500 dark:text-slate-400">Pista: {state.error}</p>
              )}
              <button
                type="submit"
                disabled={busy || !value.trim()}
                className="w-full rounded-xl bg-gd-blue py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {busy ? 'Enviando…' : 'Confirmar'}
              </button>
            </form>
          ) : isWorking ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4 text-slate-500 dark:text-slate-400">
              {step === 'qr' && state.qrDataUrl ? (
                <>
                  <img
                    src={state.qrDataUrl}
                    alt="Código QR de Telegram"
                    className="h-64 w-64 rounded-2xl bg-white p-3 shadow-md"
                  />
                  <p className="max-w-sm text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Abre Telegram en tu <b>móvil</b> → Ajustes → Dispositivos → Vincular
                    dispositivo, y escanea este código. Se renueva solo; esperando
                    confirmación…
                  </p>
                  <Loader2 className="h-5 w-5 animate-spin text-gd-blue" />
                </>
              ) : step === 'qr' ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-gd-blue" />
                  <p className="text-sm">Generando el código QR…</p>
                </>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-gd-blue" />
                  <p className="text-sm">Conectando con Telegram…</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {state.error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {state.error}
                </div>
              )}
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                Para vincular un equipo, Telegram exige que el código se escanee desde una
                app ya iniciada en tu <b>móvil</b>. Si no lo tienes a mano, usa el número de
                teléfono: el código puede llegar a tu Telegram Desktop.
              </p>
              <button
                onClick={() => void start('phone')}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 px-5 py-4 text-left text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 disabled:opacity-60 transition-all"
              >
                <Phone className="h-6 w-6 shrink-0" />
                <span>
                  <span className="block text-sm font-semibold">Iniciar sesión con teléfono</span>
                  <span className="block text-xs text-blue-100">
                    Recibe el código en la app o por SMS
                  </span>
                </span>
              </button>
              <button
                onClick={() => void start('qr')}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 dark:border-white/10 px-5 py-4 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-60 transition-colors"
              >
                <QrCode className="h-6 w-6 shrink-0 text-gd-blue" />
                <span>
                  <span className="block text-sm font-semibold">Vincular con código QR</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Escanéalo desde el móvil donde ya tienes Telegram
                  </span>
                </span>
              </button>

              {canStart &&
                (confirmReset ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-500/25 dark:bg-red-500/10">
                    <p className="text-xs leading-relaxed text-red-700 dark:text-red-300">
                      Se borrarán el api_id y api_hash guardados. Podrás volver a introducirlos
                      cuando quieras. Las cuentas ya conectadas no se eliminan.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => setConfirmReset(false)}
                        disabled={resetting}
                        className="flex-1 rounded-xl bg-white py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={async () => {
                          setResetting(true)
                          try {
                            await window.api.profiles.clearCredentials()
                            setConfirmReset(false)
                            onBack()
                          } finally {
                            setResetting(false)
                          }
                        }}
                        disabled={resetting}
                        className="flex-1 rounded-xl bg-red-600 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {resetting ? 'Borrando…' : 'Borrar credenciales'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="w-full text-center text-[11px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300"
                  >
                    Usar otras credenciales de API
                  </button>
                ))}
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-600">
          Tu sesión se cifra con el usuario de Windows (DPAPI) y nunca se envía a terceros.
        </p>
      </div>
    </div>
  )
}
