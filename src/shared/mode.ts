import type { MicMode, MicState } from './types'

/** Names the pill lists before it starts counting instead. */
const NAMED_APPS = 2

/**
 * The one place MicState turns into a state anyone draws, shared by the main process and
 * both windows so the tray icon, the overlay and the settings window can never disagree
 * about what the microphone is doing.
 *
 * Mute wins over everything: a muted microphone is the fact this app exists to show,
 * whether or not a program is recording at the time.
 */
/** The two settings that decide when a silent microphone counts as a muted one. */
export interface MuteRules {
  silenceAsMuted: boolean
  silenceMs: number
}

export function micMode(state: MicState, rules: MuteRules): MicMode {
  if (!state.present) return 'none'
  if (state.muted) return 'muted'
  // Only meaningful while something is recording: with nothing streaming, the meter reads
  // zero on a perfectly good microphone.
  if (state.apps.length === 0) return 'idle'

  // -1 is "no meter, no evidence" - not "silent for -1 ms".
  const dead = state.silentMs >= 0 && state.silentMs >= rules.silenceMs
  return rules.silenceAsMuted && dead ? 'muted' : 'live'
}

/** True when we are calling it muted on the evidence of a dead level, not on Windows saying so. */
export function isInferredMute(state: MicState, mode: MicMode): boolean {
  return mode === 'muted' && !state.muted
}

/**
 * The two lines the pill shows. Shared with the settings window, whose preview would
 * otherwise drift into showing wording the overlay never uses.
 */
export function micWords(state: MicState, mode: MicMode): { label: string; detail: string } {
  if (mode === 'none') {
    return { label: 'No microphone', detail: 'Nothing is set as a recording device' }
  }
  if (mode === 'muted') {
    // Which of the two mutes it is changes what the person has to do about it, so the
    // second line says which.
    if (isInferredMute(state, mode)) {
      return { label: 'Mic muted', detail: 'No signal - muted on the device itself' }
    }
    return {
      label: 'Mic muted',
      // Being muted matters most while something is trying to hear you, so say what.
      detail: state.apps.length > 0 ? listApps(state.apps) + ' cannot hear you' : 'Muted in Windows'
    }
  }
  if (mode === 'live') {
    return { label: 'Mic live', detail: listApps(state.apps) }
  }
  return { label: 'Mic on', detail: 'Nothing is recording' }
}

/**
 * Two names, then a count. A browser with several tabs recording can put half a dozen
 * entries in that list, and the pill is a fixed width sitting over someone's game.
 */
function listApps(apps: string[]): string {
  if (apps.length <= NAMED_APPS) return apps.join(', ')
  return apps.slice(0, NAMED_APPS).join(', ') + ' +' + (apps.length - NAMED_APPS)
}
