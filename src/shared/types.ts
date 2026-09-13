/** Shapes that cross the IPC boundary, so main and both renderers agree on one definition. */

/** What the probe reports about the default recording device, plus whether it is reporting. */
export interface MicState {
  /** False when the probe has not answered yet, or when there is no recording device. */
  present: boolean
  /** The Windows endpoint mute - the same switch the sound settings slider shows. */
  muted: boolean
  /** Signal level, 0 to 1. Only moves while something is actually recording. */
  peak: number
  /**
   * How long the level has been flat zero, in milliseconds, or -1 when there is no meter to
   * judge by. A headset that mutes in its own hardware never tells Windows, so this is the
   * only evidence there is that the microphone has gone dead. It stops counting at 10s -
   * past that the answer is the same whatever the threshold.
   */
  silentMs: number
  /** e.g. "Microphone (G435 Wireless Gaming Headset)". Null before the first report. */
  device: string | null
  id: string | null
  /** Programs currently holding the microphone open, e.g. ["Discord"]. */
  apps: string[]
}

/**
 * The four states the overlay draws, derived from MicState in one place so the tray icon,
 * the overlay and the settings window can never disagree about what is going on.
 */
export type MicMode = 'live' | 'muted' | 'idle' | 'none'

export type Corner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

export interface OverlaySettings {
  /** The tray switch. False hides the overlay without stopping the app. */
  enabled: boolean
  corner: Corner
  /** 0.3 to 1. The pill is drawn over games, so it is meant to be seen through. */
  opacity: number
  /** 0.8 to 1.5, multiplying every dimension of the pill. */
  scale: number
  /** Hide the pill while nothing is recording, the way Discord's only appears in a call. */
  onlyWhenInUse: boolean
  /** Gap between the pill and the screen edge, in pixels at scale 1. */
  margin: number
  /** Which monitor to sit on. Null follows the primary display. */
  displayId: number | null
  /**
   * Put the pill on whichever monitor the mouse is on, which during a game is the monitor
   * the game is on. Overrides displayId.
   */
  followMouse: boolean
}

/**
 * One key or one mouse button, watched system-wide. No modifiers: this is meant to be hit
 * mid-game with whatever finger is free, not typed.
 */
export interface Hotkey {
  kind: 'key' | 'mouse'
  /** A virtual-key code, or a mouse button number where 4 and 5 are the side buttons. */
  code: number
  /** What to print: "F9", "Mouse 4". Windows' own name, in the keyboard's own layout. */
  name: string
}

export interface Settings {
  appearance: { dark: boolean }
  overlay: OverlaySettings
  microphone: {
    /**
     * Treat a dead signal as muted. On for headsets that mute in hardware; off for anyone
     * whose microphone can legitimately report digital silence.
     */
    silenceAsMuted: boolean
    /** How long that silence has to last first. 0.5 to 5 seconds. */
    silenceSeconds: number
  }
  /** Toggles the Windows mute from anywhere, including inside a game. Null when unset. */
  hotkey: Hotkey | null
}

/** What the settings window hears back after asking to record a hotkey. */
export interface HotkeyCaptureResult {
  status: 'captured' | 'cancelled' | 'rejected' | 'timeout'
  hotkey?: Hotkey
}

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  width: number
  height: number
}

export interface AppContext {
  appVersion: string
  displays: DisplayInfo[]
  startWithWindows: boolean
  /** False when micprobe.exe could not be started - everything else is then unknowable. */
  probeRunning: boolean
}

/** One push from the main process to the overlay window: everything it needs to draw. */
export interface OverlayFrame {
  state: MicState
  mode: MicMode
  overlay: OverlaySettings
}
