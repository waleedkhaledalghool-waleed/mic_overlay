import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import type { Corner, OverlaySettings, Settings } from '../shared/types'

export type { Settings }

type Listener = (settings: Settings) => void

const listeners = new Set<Listener>()

/**
 * Anything that changes settings without the settings window asking - the tray menu, a
 * hotkey being recorded - still has to reach that window if it happens to be open.
 */
export function onSettingsChanged(listener: Listener): void {
  listeners.add(listener)
}

const CORNERS: Corner[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left']

const DEFAULTS: Settings = {
  appearance: { dark: true },
  overlay: {
    enabled: true,
    corner: 'top-right',
    opacity: 0.85,
    scale: 1,
    onlyWhenInUse: false,
    margin: 16,
    displayId: null,
    followMouse: false
  },
  microphone: { silenceAsMuted: true, silenceSeconds: 1 },
  hotkey: null
}

/**
 * Under %APPDATA%, not beside the executable: the app installs into Program Files, which a
 * standard user cannot write to, and these preferences belong to the person rather than the
 * machine.
 */
function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: Settings | null = null

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

/**
 * Every field is re-derived rather than merged, because this file is plain JSON in a folder
 * the user can open. A hand-edited opacity of 40 would otherwise make the overlay invisible
 * with no way back except deleting the file.
 */
function normalise(stored: Partial<Settings>): Settings {
  const overlay = (stored.overlay ?? {}) as Partial<OverlaySettings>

  return {
    appearance: {
      dark:
        typeof stored.appearance?.dark === 'boolean'
          ? stored.appearance.dark
          : DEFAULTS.appearance.dark
    },
    overlay: {
      enabled: overlay.enabled !== false,
      corner: CORNERS.includes(overlay.corner as Corner)
        ? (overlay.corner as Corner)
        : DEFAULTS.overlay.corner,
      opacity: clamp(overlay.opacity, 0.3, 1, DEFAULTS.overlay.opacity),
      scale: clamp(overlay.scale, 0.8, 1.5, DEFAULTS.overlay.scale),
      onlyWhenInUse: overlay.onlyWhenInUse === true,
      margin: Math.round(clamp(overlay.margin, 0, 200, DEFAULTS.overlay.margin)),
      displayId:
        typeof overlay.displayId === 'number' && Number.isFinite(overlay.displayId)
          ? overlay.displayId
          : null,
      followMouse: overlay.followMouse === true
    },
    microphone: {
      silenceAsMuted: stored.microphone?.silenceAsMuted !== false,
      silenceSeconds: clamp(
        stored.microphone?.silenceSeconds,
        0.5,
        5,
        DEFAULTS.microphone.silenceSeconds
      )
    },
    hotkey: normaliseHotkey(stored.hotkey)
  }
}

/** A hand-edited or half-written binding is dropped rather than wired to a random key. */
function normaliseHotkey(stored: Settings['hotkey'] | undefined): Settings['hotkey'] {
  if (!stored || (stored.kind !== 'key' && stored.kind !== 'mouse')) return null
  if (typeof stored.code !== 'number' || !Number.isFinite(stored.code)) return null
  return {
    kind: stored.kind,
    code: Math.round(stored.code),
    name: typeof stored.name === 'string' && stored.name ? stored.name : 'Unknown key'
  }
}

export function loadSettings(): Settings {
  if (cache) return cache

  let stored: Partial<Settings> = {}
  try {
    const file = settingsFile()
    if (existsSync(file)) stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>
  } catch {
    // A corrupt or half-written file is not worth blocking startup over - fall back to
    // defaults and let the next save replace it.
    stored = {}
  }

  cache = normalise(stored)
  return cache
}

export function getSettings(): Settings {
  return cache ?? loadSettings()
}

/** A shallow merge one level deep, so a caller can change one overlay field on its own. */
export function saveSettings(changes: Partial<Settings>): Settings {
  const current = getSettings()
  const next = normalise({
    appearance: { ...current.appearance, ...changes.appearance },
    overlay: { ...current.overlay, ...changes.overlay },
    microphone: { ...current.microphone, ...changes.microphone },
    // Not merged: null is a real value here, and a merge would make clearing impossible.
    hotkey: 'hotkey' in changes ? changes.hotkey : current.hotkey
  })

  cache = next
  try {
    const file = settingsFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // Keep the in-memory change even if the disk write fails; the overlay should not stop
    // responding because the profile folder is read-only.
  }
  for (const listener of listeners) listener(next)
  return next
}
