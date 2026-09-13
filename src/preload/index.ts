import { contextBridge, ipcRenderer } from 'electron'

import type { AppContext, HotkeyCaptureResult, MicState, Settings } from '../shared/types'

/** Read synchronously so the very first painted frame already uses the saved palette. */
const initialDark = process.argv.includes('--app-dark=1')

const api = {
  initialDark,

  getContext: (): Promise<AppContext> => ipcRenderer.invoke('app:context'),
  setStartWithWindows: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('app:setStartWithWindows', enabled),
  /** Leaves the app running in the tray, which is where it does its work. */
  hideWindow: (): Promise<void> => ipcRenderer.invoke('app:hideWindow'),

  mic: {
    get: (): Promise<MicState> => ipcRenderer.invoke('mic:get'),
    setMute: (request: 'mute' | 'unmute' | 'toggle'): Promise<void> =>
      ipcRenderer.invoke('mic:setMute', request),
    /** Returns the unsubscribe, so a re-render cannot stack a second listener. */
    onState: (listener: (state: MicState) => void): (() => void) => {
      const handler = (_event: unknown, state: MicState): void => listener(state)
      ipcRenderer.on('mic:state', handler)
      return () => ipcRenderer.off('mic:state', handler)
    }
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (changes: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke('settings:set', changes),
    /** Fires when anything else - the tray, a recorded hotkey - changes them. */
    onChanged: (listener: (settings: Settings) => void): (() => void) => {
      const handler = (_event: unknown, settings: Settings): void => listener(settings)
      ipcRenderer.on('settings:changed', handler)
      return () => ipcRenderer.off('settings:changed', handler)
    }
  },

  hotkey: {
    /** Record the next key or button pressed anywhere. The answer arrives on onCapture. */
    capture: (): Promise<void> => ipcRenderer.invoke('hotkey:capture'),
    cancel: (): Promise<void> => ipcRenderer.invoke('hotkey:cancel'),
    clear: (): Promise<Settings> => ipcRenderer.invoke('hotkey:clear'),
    onCapture: (listener: (result: HotkeyCaptureResult) => void): (() => void) => {
      const handler = (_event: unknown, result: HotkeyCaptureResult): void => listener(result)
      ipcRenderer.on('hotkey:capture-result', handler)
      return () => ipcRenderer.off('hotkey:capture-result', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
