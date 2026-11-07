import type { TgApi } from '@shared/api'

declare global {
  interface Window {
    api: TgApi
  }
}

export {}
