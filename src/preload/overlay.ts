import { contextBridge, ipcRenderer } from 'electron'

import type { OverlayFrame } from '../shared/types'

/**
 * The overlay only ever receives. It has no controls - the mouse passes straight through it -
 * so there is nothing for it to send back, and no reason to give it a channel to do so.
 */
contextBridge.exposeInMainWorld('overlay', {
  onRender: (listener: (frame: OverlayFrame) => void): void => {
    ipcRenderer.on('overlay:render', (_event, frame: OverlayFrame) => listener(frame))
  }
})
