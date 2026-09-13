import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

import { getMicState, micMode, muteRules } from './mic'
import { getSettings } from './settings'
import type { MicState, OverlaySettings } from '../shared/types'

/**
 * The pill that sits over everything else. It is a click-through, transparent, always-on-top
 * window: the mouse passes straight through it into whatever is underneath, so it can be
 * left on during a game without being in the way.
 *
 * It is created once and then only shown and hidden. Building a transparent always-on-top
 * window takes long enough to be visible, and the overlay is switched often enough - every
 * time a call starts, with "only while recording" on - that the delay would show.
 */

/** The pill's own size at scale 1, plus room for its shadow. Must match overlay.css. */
const BASE_WIDTH = 380
const BASE_HEIGHT = 84

/**
 * Games, other overlays and anything else marked always-on-top are all fighting over the same
 * top of the z-order, and the last one to claim it wins. Claiming it once a second is what
 * keeps the pill above a borderless-fullscreen game instead of behind it after the first
 * alt-tab. None of these calls activate the window, so the game keeps the keyboard.
 *
 * This is also when a follow-the-mouse overlay moves to the monitor the game is on.
 */
const RAISE_EVERY_MS = 1_000

let win: BrowserWindow | null = null
let raiseTimer: NodeJS.Timeout | null = null

function overlaySettings(): OverlaySettings {
  return getSettings().overlay
}

function size(overlay: OverlaySettings): { width: number; height: number } {
  return {
    width: Math.round(BASE_WIDTH * overlay.scale),
    height: Math.round(BASE_HEIGHT * overlay.scale)
  }
}

/**
 * The work area rather than the full screen bounds, so on the desktop the pill clears the
 * taskbar. A fullscreen game covers the taskbar anyway, and the two areas are then the same.
 */
function place(overlay: OverlaySettings): Electron.Rectangle {
  const displays = screen.getAllDisplays()

  // The mouse is inside the game window while someone is playing, so following it puts the
  // pill on the monitor being played on without asking anyone which one that is.
  const display = overlay.followMouse
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : (displays.find((candidate) => candidate.id === overlay.displayId) ??
      screen.getPrimaryDisplay())

  const area = display.workArea
  const { width, height } = size(overlay)
  const margin = overlay.margin

  const left = overlay.corner === 'top-left' || overlay.corner === 'bottom-left'
  const top = overlay.corner === 'top-left' || overlay.corner === 'top-right'

  return {
    x: left ? area.x + margin : area.x + area.width - width - margin,
    y: top ? area.y + margin : area.y + area.height - height - margin,
    width,
    height
  }
}

/** True when the overlay should be on screen for this state and these settings. */
function shouldShow(state: MicState): boolean {
  const overlay = overlaySettings()
  if (!overlay.enabled) return false
  if (!overlay.onlyWhenInUse) return true
  // "Only while recording" still shows a muted mic that a program is holding open - that is
  // exactly the moment someone needs to be told.
  return state.apps.length > 0
}

function createWindow(): BrowserWindow {
  const overlay = overlaySettings()
  const bounds = place(overlay)

  const created = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never takes focus: clicking a game while this is on screen must not pull the caret or
    // the keyboard away from it.
    focusable: false,
    acceptFirstMouse: false,
    // "toolbar" keeps it out of the Alt-Tab list on Windows.
    type: 'toolbar',
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Above normal windows and above most fullscreen games. Exclusive-fullscreen games bypass
  // the desktop compositor altogether and nothing drawn this way can appear over them; see
  // the note in the settings window.
  created.setAlwaysOnTop(true, 'screen-saver')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // The whole point: the mouse goes through to the game underneath.
  created.setIgnoreMouseEvents(true)

  if (process.env['ELECTRON_RENDERER_URL']) {
    created.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/overlay.html')
  } else {
    created.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  // Anything sent before the page exists is dropped, and the window is created in the middle
  // of a refresh - so ask for one more as soon as there is something to receive it.
  created.webContents.on('did-finish-load', () => refreshOverlay())

  created.on('closed', () => {
    if (win === created) win = null
  })

  return created
}

/** Pushes the current state and appearance into the pill, and shows or hides the window. */
export function refreshOverlay(): void {
  const state = getMicState()
  const overlay = overlaySettings()

  if (!overlay.enabled) {
    hideOverlay()
    return
  }

  if (!win || win.isDestroyed()) win = createWindow()

  win.setBounds(place(overlay))
  win.webContents.send('overlay:render', {
    state,
    mode: micMode(state, muteRules()),
    overlay
  })

  if (shouldShow(state)) {
    // showInactive, not show: show would focus the overlay and minimise a fullscreen game.
    if (!win.isVisible()) win.showInactive()
    startRaising()
  } else if (win.isVisible()) {
    win.hide()
    stopRaising()
  }
}

function startRaising(): void {
  if (raiseTimer) return

  raiseTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return

    const overlay = overlaySettings()
    if (overlay.followMouse) {
      // Only when it actually moved: setBounds on a window that is already there still costs
      // a SetWindowPos, and this runs every second forever.
      const next = place(overlay)
      const current = win.getBounds()
      if (next.x !== current.x || next.y !== current.y) win.setBounds(next)
    }

    // Both, and in this order: the first re-arms the topmost flag that a fullscreen game can
    // strip, the second re-stacks us at the top of the windows that still have it.
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }, RAISE_EVERY_MS)
}

function stopRaising(): void {
  if (!raiseTimer) return
  clearInterval(raiseTimer)
  raiseTimer = null
}

export function hideOverlay(): void {
  stopRaising()
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

export function destroyOverlay(): void {
  stopRaising()
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

/** Monitors can be added, removed or rearranged under a running overlay. */
export function watchDisplays(): void {
  screen.on('display-added', refreshOverlay)
  screen.on('display-removed', refreshOverlay)
  screen.on('display-metrics-changed', refreshOverlay)
}
