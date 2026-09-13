import type {
  AppContext,
  HotkeyCaptureResult,
  MicState,
  OverlayFrame,
  Settings
} from '../shared/types'

export interface AppApi {
  initialDark: boolean
  getContext: () => Promise<AppContext>
  setStartWithWindows: (enabled: boolean) => Promise<boolean>
  hideWindow: () => Promise<void>
  mic: {
    get: () => Promise<MicState>
    setMute: (request: 'mute' | 'unmute' | 'toggle') => Promise<void>
    onState: (listener: (state: MicState) => void) => () => void
  }
  settings: {
    get: () => Promise<Settings>
    set: (changes: Partial<Settings>) => Promise<Settings>
    onChanged: (listener: (settings: Settings) => void) => () => void
  }
  hotkey: {
    capture: () => Promise<void>
    cancel: () => Promise<void>
    clear: () => Promise<Settings>
    onCapture: (listener: (result: HotkeyCaptureResult) => void) => () => void
  }
}

export interface OverlayApi {
  onRender: (listener: (frame: OverlayFrame) => void) => void
}

declare global {
  interface Window {
    /** Present in the settings window only. */
    api: AppApi
    /** Present in the overlay window only. */
    overlay: OverlayApi
  }
}
