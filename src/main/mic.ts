import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface, type Interface } from 'readline'
import { join } from 'path'

import { getSettings } from './settings'
import type { Hotkey, MicState } from '../shared/types'
import type { MuteRules } from '../shared/mode'

/**
 * Owns micprobe.exe: keeps one running, turns its output into MicState, and forwards mute
 * commands to it. Everything Windows-specific lives in the probe, so this file only has to
 * care about the process staying alive.
 */

/** What we report before the probe has said anything, and after it has gone away. */
const UNKNOWN: MicState = {
  present: false,
  muted: false,
  peak: 0,
  silentMs: -1,
  device: null,
  id: null,
  apps: []
}

/** First retry delay after the probe dies. Doubles up to RESTART_MAX_MS. */
const RESTART_MS = 1_000
const RESTART_MAX_MS = 30_000

type Listener = (state: MicState) => void

/**
 * What the probe's hook has to say. Only ever these: the binding being recorded, and the
 * bound key having been pressed.
 */
export type HotkeyEvent =
  | { type: 'hotkey' }
  | { type: 'captured'; hotkey: Hotkey }
  | { type: 'cancelled' }
  | { type: 'rejected' }

type HotkeyListener = (event: HotkeyEvent) => void

let child: ChildProcessWithoutNullStreams | null = null
let lines: Interface | null = null
let restartTimer: NodeJS.Timeout | null = null
let restartDelay = RESTART_MS
let quitting = false

let current: MicState = UNKNOWN
const listeners = new Set<Listener>()
const hotkeyListeners = new Set<HotkeyListener>()

function probePath(): string {
  // Packaged, electron-builder drops the exe straight into resources/ beside app.asar.
  return app.isPackaged
    ? join(process.resourcesPath, 'micprobe.exe')
    : join(app.getAppPath(), 'resources', 'micprobe.exe')
}

export function getMicState(): MicState {
  return current
}

export function isProbeRunning(): boolean {
  return child !== null
}

export function onMicState(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Re-exported so the rest of the main process can take its state and its meaning from the
// same import, while the meaning itself stays shared with the two windows.
export { micMode } from '../shared/mode'

/** What micMode needs from settings, resolved in the one place that owns them. */
export function muteRules(): MuteRules {
  const microphone = getSettings().microphone
  return {
    silenceAsMuted: microphone.silenceAsMuted,
    silenceMs: Math.round(microphone.silenceSeconds * 1000)
  }
}

export function onHotkeyEvent(listener: HotkeyListener): () => void {
  hotkeyListeners.add(listener)
  return () => hotkeyListeners.delete(listener)
}

/** Start recording the next key or button pressed anywhere. */
export function captureHotkey(): void {
  child?.stdin.write('capture\n')
}

export function cancelCapture(): void {
  child?.stdin.write('cancel\n')
}

/**
 * Tell the probe what to listen for. Null installs no hook at all - the probe only hooks the
 * keyboard and mouse once there is something to listen for.
 */
export function applyHotkey(hotkey: Hotkey | null): void {
  if (!child) return
  child.stdin.write(hotkey ? 'bind ' + hotkey.kind + ':' + hotkey.code + '\n' : 'unbind\n')
}

function publish(next: MicState): void {
  current = next
  for (const listener of listeners) listener(next)
}

/** An event line, or null when this is an ordinary state line. */
function parseEvent(raw: Record<string, unknown>): HotkeyEvent | null {
  switch (raw.event) {
    case 'hotkey':
      return { type: 'hotkey' }
    case 'capture-cancelled':
      return { type: 'cancelled' }
    case 'capture-rejected':
      return { type: 'rejected' }
    case 'captured':
      if (
        (raw.kind !== 'key' && raw.kind !== 'mouse') ||
        typeof raw.code !== 'number' ||
        typeof raw.name !== 'string'
      ) {
        return null
      }
      return { type: 'captured', hotkey: { kind: raw.kind, code: raw.code, name: raw.name } }
    default:
      return null
  }
}

/** Discards anything that is not the shape we asked for, rather than trusting the pipe. */
function parse(line: string): MicState | null {
  let raw: Partial<MicState>
  try {
    raw = JSON.parse(line) as Partial<MicState>
  } catch {
    return null
  }
  if (typeof raw.present !== 'boolean') return null

  return {
    present: raw.present,
    muted: raw.muted === true,
    peak: typeof raw.peak === 'number' && Number.isFinite(raw.peak) ? raw.peak : 0,
    silentMs: typeof raw.silentMs === 'number' && Number.isFinite(raw.silentMs) ? raw.silentMs : -1,
    device: typeof raw.device === 'string' ? raw.device : null,
    id: typeof raw.id === 'string' ? raw.id : null,
    apps: Array.isArray(raw.apps) ? raw.apps.filter((name) => typeof name === 'string') : []
  }
}

export function startProbe(): void {
  if (child || quitting) return

  let spawned: ChildProcessWithoutNullStreams
  try {
    spawned = spawn(probePath(), [], { windowsHide: true })
  } catch {
    scheduleRestart()
    return
  }

  child = spawned
  lines = createInterface({ input: spawned.stdout })

  lines.on('line', (line) => {
    // A first successful report means whatever killed the last probe is over.
    restartDelay = RESTART_MS

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    if ('event' in raw) {
      const event = parseEvent(raw)
      if (event) for (const listener of hotkeyListeners) listener(event)
      return
    }

    const state = parse(line)
    if (state) publish(state)
  })

  // A probe that had to be restarted has no hook installed and no idea what was bound.
  applyHotkey(getSettings().hotkey)

  // Nothing is meant to arrive here, and a probe writing errors is one we want restarted
  // rather than one we want to read.
  spawned.stderr.resume()

  spawned.on('error', () => handleExit(spawned))
  spawned.on('exit', () => handleExit(spawned))
}

function handleExit(spawned: ChildProcessWithoutNullStreams): void {
  if (child !== spawned) return

  lines?.close()
  lines = null
  child = null
  publish(UNKNOWN)
  scheduleRestart()
}

/**
 * The probe is not meant to exit while the app is up, so if it does, something is wrong -
 * a device driver crash, an antivirus quarantine. Back off rather than spawn in a tight
 * loop, but keep trying: the machine may well recover.
 */
function scheduleRestart(): void {
  if (quitting || restartTimer) return

  restartTimer = setTimeout(() => {
    restartTimer = null
    startProbe()
  }, restartDelay)

  restartDelay = Math.min(restartDelay * 2, RESTART_MAX_MS)
}

export function setMute(request: 'mute' | 'unmute' | 'toggle'): void {
  // No local echo of the new state: the probe reads the endpoint back within 150 ms, and
  // guessing here is how an overlay ends up showing the opposite of the truth when the
  // call fails.
  child?.stdin.write(request + '\n')
}

export function stopProbe(): void {
  quitting = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  const running = child
  child = null
  lines?.close()
  lines = null

  if (!running) return
  // Ask first - it leaves the COM objects released cleanly - then insist.
  running.stdin.write('quit\n')
  setTimeout(() => running.kill(), 500).unref()
}
