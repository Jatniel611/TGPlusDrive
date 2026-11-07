import { useEffect, useState } from 'react'
import type { AuthState, DriveState, Profile, UploadProgress } from '@shared/types'
import { Onboarding } from './components/Onboarding'
import { AuthScreen } from './components/AuthScreen'
import { CredentialsScreen } from './components/CredentialsScreen'
import { Drive } from './components/Drive'
import { Logo } from './components/Logo'

type Screen = 'loading' | 'onboarding' | 'auth' | 'credentials' | 'drive'

// Sonido de finalización generado con Web Audio (sin archivos externos).
let audioCtx: AudioContext | null = null
function playDoneSound(): void {
  try {
    if (typeof window === 'undefined') return
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!audioCtx) audioCtx = new Ctor()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const notes = [880, 1174.66]
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const start = now + index * 0.12
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, start)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.2)
    })
  } catch {
    /* silencio si el audio no está disponible */
  }
}

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('loading')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [active, setActive] = useState<DriveState | null>(null)
  const [auth, setAuth] = useState<AuthState>({ step: 'idle' })
  const [progress, setProgress] = useState<UploadProgress[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedCreds, setSavedCreds] = useState<{ apiId: string; apiHash: string } | null>(null)
  const [transfersOpen, setTransfersOpen] = useState(false)

  useEffect(() => {
    void window.api.profiles.credentials().then(setSavedCreds).catch(() => undefined)
    void window.api.drive.bootstrap().then(async (boot) => {
      setProfiles(boot.profiles)
      if (boot.active) {
        setActive(boot.active)
        setScreen('drive')
        return
      }
      const last = boot.profiles[0]
      if (last) {
        try {
          const state = await window.api.profiles.activate(last.id)
          setActive(state)
          setScreen('drive')
          return
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
      setScreen('onboarding')
    })

    const offChanged = window.api.events.onChanged((state) => {
      if (state) {
        setActive(state)
        setScreen('drive')
      }
    })

    const offProgress = window.api.events.onProgress((item) => {
      setProgress((prev) => {
        const index = prev.findIndex((entry) => entry.id === item.id)
        if (index >= 0) {
          const copy = [...prev]
          copy[index] = item
          return copy
        }
        return [...prev, item]
      })
      if (item.status === 'done') playDoneSound()
      if (item.status !== 'uploading' && item.status !== 'paused') {
        window.setTimeout(() => {
          setProgress((prev) => prev.filter((entry) => entry.id !== item.id))
        }, 6000)
      }
    })

    const offAuth = window.api.auth.onState((state) => {
      setAuth(state)
      if (state.step === 'ready') {
        void window.api.drive.state().then((current) => {
          if (current) {
            setActive(current)
            setScreen('drive')
          }
        })
        void window.api.profiles.list().then(setProfiles)
      }
    })

    return () => {
      offChanged()
      offProgress()
      offAuth()
    }
  }, [])

  useEffect(() => {
    if (screen !== 'auth') return
    void window.api.profiles.credentials().then(setSavedCreds).catch(() => undefined)
  }, [screen])

  const activate = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const state = await window.api.profiles.activate(id)
      setActive(state)
      setProfiles(await window.api.profiles.list())
      setScreen('drive')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setProfiles(await window.api.profiles.list())
      if (message.toLowerCase().includes('sesión') || message.toLowerCase().includes('session')) {
        setAuth({ step: 'idle' })
        setScreen('auth')
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    const list = await window.api.profiles.remove(id)
    setProfiles(list)
    if (active?.profile.id === id) {
      setActive(null)
      setScreen('onboarding')
    }
  }

  const logout = async (): Promise<void> => {
    if (!active) return
    const id = active.profile.id
    const list = await window.api.profiles.logout(id)
    setProfiles(list)
    setActive(null)
    setScreen('onboarding')
  }

  const startAuth = async (
    creds: { apiId: string; apiHash: string },
    method: 'phone' | 'qr' | 'desktop'
  ): Promise<void> => {
    setAuth({ step: 'connecting', method })
    await window.api.auth.start({ ...creds, method })
  }

  const provideAuth = async (
    field: 'phone' | 'code' | 'password',
    value: string
  ): Promise<void> => {
    await window.api.auth.provide(field, value)
  }

  const cancelAuth = async (): Promise<void> => {
    await window.api.auth.cancel()
    setAuth({ step: 'idle' })
  }

  if (screen === 'loading') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gd-bg dark:bg-[#12141a]">
        <Logo className="h-24 w-24 drop-shadow-xl" />
        <p className="text-sm text-slate-500">Cargando TGPlusDrive…</p>
      </div>
    )
  }

  if (screen === 'credentials') {
    return (
      <CredentialsScreen
        onBack={() => {
          setError(null)
          setScreen('auth')
        }}
        onSubmit={async (creds) => {
          const res = await window.api.auth.saveCredentials(creds)
          if (!res.ok) throw new Error(res.error || 'No se pudieron guardar los datos')
          setSavedCreds(creds)
          setScreen('auth')
        }}
      />
    )
  }

  if (screen === 'auth') {
    const saved = profiles.find((profile) => profile.apiId && profile.apiHash)
    const defaultCredentials =
      savedCreds ??
      (saved ? { apiId: String(saved.apiId), apiHash: String(saved.apiHash) } : undefined)
    return (
      <AuthScreen
        state={auth}
        defaultCredentials={defaultCredentials}
        onStart={startAuth}
        onProvide={provideAuth}
        onCancel={cancelAuth}
        onConfigure={() => setScreen('credentials')}
        onBack={() => {
          setAuth({ step: 'idle' })
          setScreen(active ? 'drive' : 'onboarding')
        }}
      />
    )
  }

  if (screen === 'drive' && active) {
    return (
      <>
        <Drive
          key={active.profile.id}
          state={active}
          transfers={progress}
          transfersOpen={transfersOpen}
          onToggleTransfers={() => setTransfersOpen((value) => !value)}
          onClearTransfers={() => setProgress([])}
          onCancelTransfer={(id, kind) => {
            if (kind === 'upload') void window.api.drive.cancelUpload(id)
            else void window.api.drive.cancelDownload(id)
          }}
          onExit={() => setScreen('onboarding')}
          onLogout={logout}
          onAddAccount={() => {
            setError(null)
            setAuth({ step: 'idle' })
            setScreen('auth')
          }}
        />
      </>
    )
  }

  return (
    <Onboarding
      profiles={profiles}
      error={error}
      busy={busy}
      onActivate={(id) => void activate(id)}
      onConnect={() => {
        setError(null)
        setAuth({ step: 'idle' })
        setScreen('auth')
      }}
      onRemove={(id) => void remove(id)}
    />
  )
}
