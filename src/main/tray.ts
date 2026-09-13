import { app, Menu, Tray } from 'electron'
import { join } from 'path'

import { isInferredMute } from '../shared/mode'
import { setStartWithWindows, startsWithWindows } from './autostart'
import { getMicState, micMode, muteRules, setMute } from './mic'
import { refreshOverlay } from './overlay'
import { getSettings, saveSettings } from './settings'
import type { MicMode, MicState } from '../shared/types'

/**
 * The tray icon: the app's only permanent presence, and - as asked for - the switch that
 * turns the overlay on and off from the arrow in the corner of the taskbar.
 *
 * Left click toggles the overlay, because that is the thing people come here to do. The
 * right-click menu carries everything else, including the same toggle as a checkbox, so the
 * state is legible and not just a thing that happens when you click.
 */

let tray: Tray | null = null
let openSettingsWindow: () => void = () => {}

/**
 * The last thing we drew, so the menu is not rebuilt six times a second. The signal level
 * changes constantly and none of it reaches the tray.
 */
let drawn = ''

function iconPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name)
}

function iconFor(mode: MicMode): string {
  if (mode === 'muted') return iconPath('tray-muted.ico')
  if (mode === 'live') return iconPath('tray-live.ico')
  return iconPath('tray-idle.ico')
}

/** What the microphone is doing, in the few words a tooltip gets. */
function summary(state: MicState, mode: MicMode): string {
  if (mode === 'none') return 'No microphone found'
  if (mode === 'muted') {
    return isInferredMute(state, mode) ? 'Microphone muted on the device' : 'Microphone muted'
  }
  if (mode === 'live') {
    const [first, ...rest] = state.apps
    return rest.length > 0
      ? 'Microphone live - ' + first + ' and ' + rest.length + ' more'
      : 'Microphone live - ' + first
  }
  return 'Microphone on, nothing recording'
}

function toggleOverlay(): void {
  const enabled = !getSettings().overlay.enabled
  saveSettings({ overlay: { ...getSettings().overlay, enabled } })
  refreshOverlay()
  updateTray()
}

function buildMenu(state: MicState, mode: MicMode): Menu {
  const overlay = getSettings().overlay

  return Menu.buildFromTemplate([
    { label: summary(state, mode), enabled: false },
    { type: 'separator' },
    {
      label: 'Show the overlay',
      type: 'checkbox',
      checked: overlay.enabled,
      click: toggleOverlay
    },
    {
      label: state.muted ? 'Unmute microphone' : 'Mute microphone',
      enabled: state.present,
      click: () => setMute('toggle')
    },
    {
      label: 'Overlay on the monitor the mouse is on',
      type: 'checkbox',
      checked: overlay.followMouse,
      click: (item) => {
        saveSettings({ overlay: { ...getSettings().overlay, followMouse: item.checked } })
        refreshOverlay()
        updateTray()
      }
    },
    { type: 'separator' },
    { label: 'Settings...', click: () => openSettingsWindow() },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: startsWithWindows(),
      click: (item) => {
        setStartWithWindows(item.checked)
        updateTray()
      }
    },
    { type: 'separator' },
    { label: 'Quit Mic Overlay', click: () => app.quit() }
  ])
}

export function createTray(openSettings: () => void): void {
  openSettingsWindow = openSettings

  tray = new Tray(iconFor('idle'))
  tray.setToolTip('Mic Overlay')
  // The overlay toggle is what the tray is for; everything else is one click further in.
  tray.on('click', toggleOverlay)
  tray.on('double-click', () => openSettingsWindow())

  updateTray()
}

/**
 * Redraws the icon, tooltip and menu, but only when something a person could notice has
 * changed. Called on every report from the probe.
 */
export function updateTray(): void {
  if (!tray || tray.isDestroyed()) return

  const state = getMicState()
  const mode = micMode(state, muteRules())
  const overlay = getSettings().overlay

  const signature = [
    mode,
    state.apps.join('|'),
    overlay.enabled,
    overlay.followMouse,
    startsWithWindows()
  ].join('/')
  if (signature === drawn) return
  drawn = signature

  tray.setImage(iconFor(mode))
  tray.setToolTip(
    'Mic Overlay - ' + summary(state, mode) + (overlay.enabled ? '' : ' (overlay off)')
  )
  tray.setContextMenu(buildMenu(state, mode))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
