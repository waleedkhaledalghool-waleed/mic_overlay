import './overlay.css'

import { micWords } from '../../shared/mode'
import type { OverlayFrame } from '../../shared/types'

/**
 * The overlay's whole renderer. It receives a frame from the main process and writes it into
 * the document - no framework, no state of its own, no timers. Everything it knows comes
 * from the probe, and the main process decides when it is on screen at all.
 */

const pill = document.getElementById('pill') as HTMLDivElement
const label = document.getElementById('label') as HTMLSpanElement
const detail = document.getElementById('detail') as HTMLSpanElement
const meter = document.getElementById('meter') as HTMLSpanElement

/** Levels at which each of the three bars lights. */
const THRESHOLDS = [0.02, 0.09, 0.25]

const bars = Array.from(meter.querySelectorAll('i'))

function render(frame: OverlayFrame): void {
  const { state, mode, overlay } = frame

  pill.dataset.mode = mode
  document.body.dataset.corner = overlay.corner
  document.documentElement.style.setProperty('--opacity', String(overlay.opacity))
  // One zoom on the whole page rather than a scale factor threaded through every rule; the
  // window itself was already sized by the same number.
  document.body.style.zoom = String(overlay.scale)

  const text = micWords(state, mode)
  if (label.textContent !== text.label) label.textContent = text.label
  if (detail.textContent !== text.detail) detail.textContent = text.detail

  const level = mode === 'live' ? state.peak : 0
  bars.forEach((bar, index) => bar.classList.toggle('lit', level >= THRESHOLDS[index]))
}

window.overlay.onRender(render)
