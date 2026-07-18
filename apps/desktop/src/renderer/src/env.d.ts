/// <reference types="vite/client" />
import type { StudioMasterApi } from '@studiomaster/shared'

declare global {
  interface Window {
    studiomaster: StudioMasterApi
  }
}

export {}
