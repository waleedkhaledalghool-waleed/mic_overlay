import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { join } from 'path'

import { setStartWithWindows, startedHidden, startsWithWindows } from './autostart'
import {
  applyHotkey,
  cancelCapture,
  captureHotkey,
  getMicState,
  isProbeRunning,
  onHotkeyEvent,
  onMicState,
  setMute,
  startProbe,
  stopProbe
} from './mic'
import { destroyOverlay, refreshOverlay, watchDisplays } from './overlay'
import { getSettings, loadSettings, onSettingsChanged, saveSettings, type Settings } from './settings'
import { createTray, destroyTray, updateTray } from './tray'
import type { AppContext, DisplayInfo, HotkeyCaptureResult } from '../shared/types'

/**
 * A tray app with two windows: the overlay that sits over everything, and this settings
 * window, which is ordinary and closable. Neither closing is a reason to quit - the app's
 * whole job happens while no window is open.
 */

let settingsWindow: BrowserWindow | null = null

/** Must match `.window-titlebar`'s height in styles.css, or a seam appears under the buttons. */
const TITLE_BAR_HEIGHT = 36

function titleBarColors(dark: boolean): { color: string; symbolColor: string; height: number } {
  return {
    // The renderer's --titlebar-bg. Matching the overlay exactly makes the native Windows
    // controls look like part of the app's own strip.
    color: dark ? '#101216' : '#e9ecef',
    symbolColor: dark ? '#e7e9ec' : '#1b1d21',
    height: TITLE_BAR_HEIGHT
  }
}

function applyWindowTheme(dark: boolean): void {
  // Set Chromium's native surfaces too, so scrollbars, dialogs and context menus stay in step
  // with the palette chosen inside the app.
  nativeTheme.themeSource = dark ? 'dark' : 'light'

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setTitleBarOverlay(titleBarColors(dark))
    settingsWindow.setBackgroundColor(dark ? '#14161a' : '#f4f5f7')
  }
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const dark = getSettings().appearance.dark
  const win = new BrowserWindow({
    width: 620,
    height: 780,
    minWidth: 520,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'Mic Overlay',
    // The page paints the strip behind the buttons; Windows still owns the real minimise,
    // maximise/restore and close controls, along with snapping and the resize borders.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(dark),
    backgroundColor: dark ? '#14161a' : '#f4f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Lets the renderer stamp the saved theme before React's first render, instead of
      // flashing the default light palette while it waits for an async round trip.
      additionalArguments: ['--app-dark=' + (dark ? '1' : '0')]
    }
  })

  settingsWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function displays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id

  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    // Windows does not always give a monitor a name; a number beats an empty dropdown entry.
    label: display.label || 'Display ' + (index + 1),
    primary: display.id === primary,
    width: display.size.width,
    height: display.size.height
  }))
}

/** Nothing to record forever: a recording nobody finishes has to end by itself. */
const CAPTURE_TIMEOUT_MS = 15_000

let captureTimer: NodeJS.Timeout | null = null

function sendToSettings(channel: string, payload: unknown): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload)
  }
}

function endCapture(result: HotkeyCaptureResult): void {
  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }
  sendToSettings('hotkey:capture-result', result)
}

/**
 * One instance only. A second copy would put a second icon in the tray and fight the first
 * one over the overlay window's position, so hand the click to the copy already running.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openSettings())

  app.whenReady().then(() => {
    const initial = loadSettings()
    applyWindowTheme(initial.appearance.dark)

    ipcMain.handle(
      'app:context',
      (): AppContext => ({
        appVersion: app.getVersion(),
        displays: displays(),
        startWithWindows: startsWithWindows(),
        probeRunning: isProbeRunning()
      })
    )
    ipcMain.handle('app:setStartWithWindows', (_event, enabled: boolean) => {
      setStartWithWindows(enabled === true)
      updateTray()
      return startsWithWindows()
    })
    ipcMain.handle('app:hideWindow', () => settingsWindow?.hide())

    ipcMain.handle('mic:get', () => getMicState())
    ipcMain.handle('mic:setMute', (_event, request: 'mute' | 'unmute' | 'toggle') => {
      setMute(request === 'mute' || request === 'unmute' ? request : 'toggle')
    })

    ipcMain.handle('hotkey:capture', () => {
      captureHotkey()
      if (captureTimer) clearTimeout(captureTimer)
      captureTimer = setTimeout(() => {
        cancelCapture()
        endCapture({ status: 'timeout' })
      }, CAPTURE_TIMEOUT_MS)
    })
    ipcMain.handle('hotkey:cancel', () => {
      cancelCapture()
      endCapture({ status: 'cancelled' })
    })
    ipcMain.handle('hotkey:clear', (): Settings => {
      const next = saveSettings({ hotkey: null })
      applyHotkey(null)
      return next
    })

    ipcMain.handle('settings:get', (): Settings => getSettings())
    ipcMain.handle('settings:set', (_event, changes: Partial<Settings>): Settings => {
      const next = saveSettings(changes)
      if (changes.appearance) applyWindowTheme(next.appearance.dark)
      // Cheap, and it means every path that can change the overlay - this window, the tray,
      // a monitor being unplugged - ends in the same call.
      refreshOverlay()
      updateTray()
      return next
    })

    // The hook reports only these. A press toggles the Windows mute, which the probe reads
    // back within 150 ms, so the overlay turns red off the same evidence as everything else
    // rather than off the keypress.
    onHotkeyEvent((event) => {
      switch (event.type) {
        case 'hotkey':
          setMute('toggle')
          break
        case 'captured':
          saveSettings({ hotkey: event.hotkey })
          applyHotkey(event.hotkey)
          endCapture({ status: 'captured', hotkey: event.hotkey })
          break
        case 'rejected':
          // Recording is still running - they can press something else.
          sendToSettings('hotkey:capture-result', { status: 'rejected' })
          break
        case 'cancelled':
          endCapture({ status: 'cancelled' })
          break
      }
    })

    // Anything that changes settings behind the settings window's back - the tray menu, a
    // hotkey being recorded - still has to reach it.
    onSettingsChanged((next) => sendToSettings('settings:changed', next))

    // Every report from the probe lands here and fans out: the overlay redraws, the tray
    // decides whether anything it shows has changed, and the settings window follows along
    // if it happens to be open.
    onMicState((state) => {
      refreshOverlay()
      updateTray()
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('mic:state', state)
      }
    })

    startProbe()
    createTray(openSettings)
    watchDisplays()
    refreshOverlay()

    // Launched by the Run key entry, this copy belongs in the tray and nowhere else.
    if (!startedHidden()) openSettings()

    app.on('activate', () => openSettings())
  })
}

// A tray app outlives its windows; closing the settings window is not a reason to quit, and
// the overlay is hidden rather than closed.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  stopProbe()
  destroyOverlay()
  destroyTray()
})
