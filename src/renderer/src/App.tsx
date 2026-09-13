import { useCallback, useEffect, useState } from 'react'

import { isInferredMute, micMode, micWords } from '../../shared/mode'
import type {
  AppContext,
  Corner,
  HotkeyCaptureResult,
  MicMode,
  MicState,
  OverlaySettings,
  Settings
} from '../../shared/types'

/** What the hotkey panel says once a recording has ended, and why. */
const CAPTURE_MESSAGES: Record<HotkeyCaptureResult['status'], string> = {
  captured: '',
  cancelled: 'Nothing was recorded.',
  rejected: 'Left and right click are needed everywhere else - try a side button or a key.',
  timeout: 'Nothing was pressed, so the hotkey is unchanged.'
}

/** What we show until the first report arrives - a moment at most, but it must render. */
const UNKNOWN: MicState = {
  present: false,
  muted: false,
  peak: 0,
  silentMs: -1,
  device: null,
  id: null,
  apps: []
}

const CORNERS: { value: Corner; label: string }[] = [
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' }
]

function stateLabel(mode: MicMode): string {
  switch (mode) {
    case 'live':
      return 'Live'
    case 'muted':
      return 'Muted'
    case 'none':
      return 'No microphone'
    default:
      return 'Open, idle'
  }
}

/**
 * The same microphone as the overlay's, at settings-window size. The mask cuts the slash
 * out of the glyph instead of drawing over it, so the two icons are the same drawing.
 */
function MicGlyph({ muted }: { muted: boolean }): React.JSX.Element {
  const body = (
    <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8.5 21h7" />
    </>
  )

  if (!muted) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {body}
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <mask id="preview-slash">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        <line
          x1="3.2"
          y1="3.2"
          x2="20.8"
          y2="20.8"
          stroke="black"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </mask>
      <g mask="url(#preview-slash)">{body}</g>
      <line x1="3.8" y1="3.8" x2="20.2" y2="20.2" />
    </svg>
  )
}

export default function App(): React.JSX.Element {
  const [dark, setDark] = useState(window.api.initialDark)
  const [context, setContext] = useState<AppContext | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<MicState>(UNKNOWN)
  const [startWithWindows, setStartWithWindows] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureNote, setCaptureNote] = useState<string | null>(null)

  // One round trip for everything that does not change, then a subscription for the one
  // thing that does. The window never polls: the probe already pushes.
  useEffect(() => {
    void (async () => {
      const [loadedContext, loadedSettings, loadedState] = await Promise.all([
        window.api.getContext(),
        window.api.settings.get(),
        window.api.mic.get()
      ])
      setContext(loadedContext)
      setSettings(loadedSettings)
      setState(loadedState)
      setDark(loadedSettings.appearance.dark)
      setStartWithWindows(loadedContext.startWithWindows)
    })()

    const stopState = window.api.mic.onState(setState)
    // The tray can change the same settings this window is showing, and a recorded hotkey
    // arrives from the main process rather than from anything clicked in here.
    const stopSettings = window.api.settings.onChanged(setSettings)
    const stopCapture = window.api.hotkey.onCapture((result) => {
      // A rejected press leaves the recording running, so the panel stays in its waiting
      // state and only the explanation under it changes.
      if (result.status !== 'rejected') setCapturing(false)
      setCaptureNote(CAPTURE_MESSAGES[result.status] || null)
    })

    return () => {
      stopState()
      stopSettings()
      stopCapture()
    }
  }, [])

  const save = useCallback(async (changes: Partial<Settings>) => {
    // The main process is the owner: it normalises, writes and redraws, and what it returns
    // is what actually took effect.
    setSettings(await window.api.settings.set(changes))
  }, [])

  const overlay = settings?.overlay ?? null

  const setOverlay = useCallback(
    (changes: Partial<OverlaySettings>) => {
      if (!overlay) return
      void save({ overlay: { ...overlay, ...changes } })
    },
    [overlay, save]
  )

  async function toggleTheme(): Promise<void> {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : ''
    await save({ appearance: { dark: next } })
  }

  const mode = micMode(state, {
    silenceAsMuted: settings?.microphone.silenceAsMuted ?? true,
    silenceMs: Math.round((settings?.microphone.silenceSeconds ?? 1) * 1000)
  })
  const words = micWords(state, mode)

  return (
    <div className="app">
      <div className="window-titlebar">
        <span className="window-titlebar-title">Mic Overlay</span>
      </div>

      <main className="page">
        <header className="page-header">
          <div>
            <h1>Microphone</h1>
            <p>An on-screen light for whether anything can hear you.</p>
          </div>
          <button
            className="icon-button"
            onClick={() => void toggleTheme()}
            title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {dark ? 'Light' : 'Dark'}
          </button>
        </header>

        {context && !context.probeRunning && (
          <div className="notice error">
            The helper that reads the microphone is not running, so everything below is a
            guess. It lives beside the app as <strong>micprobe.exe</strong> - if antivirus
            quarantined it, restoring it and reopening this app is enough.
          </div>
        )}

        <section className="hero">
          <span className={'state-pill is-' + mode}>
            <span className="state-dot" />
            {stateLabel(mode)}
          </span>

          <h2>{state.device ?? 'Looking for a microphone...'}</h2>
          <p className="hero-sub">
            {mode === 'live'
              ? 'Recording now: ' + state.apps.join(', ')
              : mode === 'muted'
                ? isInferredMute(state, mode)
                  ? 'No signal at all - muted on the headset, not in Windows'
                  : 'Muted in Windows, so nothing can hear you'
                : mode === 'none'
                  ? 'Windows has no recording device set'
                  : 'Open and working, but nothing is recording'}
          </p>

          <div className="hero-actions">
            <button
              className={state.muted ? 'primary' : 'danger'}
              disabled={!state.present}
              onClick={() => void window.api.mic.setMute('toggle')}
            >
              {state.muted ? 'Unmute microphone' : 'Mute microphone'}
            </button>
            <button disabled={!overlay} onClick={() => setOverlay({ enabled: !overlay?.enabled })}>
              {overlay?.enabled ? 'Hide the overlay' : 'Show the overlay'}
            </button>
          </div>
        </section>

        {overlay && (
          <>
            <section className="panel">
              <div className="switch-row">
                <div className="switch-text">
                  <strong>Show the overlay</strong>
                  <p>
                    The same switch as the tray icon in the corner of the taskbar - click that
                    icon to turn the overlay on and off without opening this window.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={overlay.enabled}
                  aria-label="Show the overlay"
                  className={'switch' + (overlay.enabled ? ' is-on' : '')}
                  onClick={() => setOverlay({ enabled: !overlay.enabled })}
                >
                  <span className="switch-knob" />
                </button>
              </div>

              <div className="switch-row">
                <div className="switch-text">
                  <strong>Only while something is recording</strong>
                  <p>
                    Keeps the screen clear until a program actually opens the microphone, the
                    way a call indicator only appears during a call.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={overlay.onlyWhenInUse}
                  aria-label="Only while something is recording"
                  className={'switch' + (overlay.onlyWhenInUse ? ' is-on' : '')}
                  onClick={() => setOverlay({ onlyWhenInUse: !overlay.onlyWhenInUse })}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </section>

            <section className="panel">
              <div className="switch-row">
                <div className="switch-text">
                  <strong>Treat a dead signal as muted</strong>
                  <p>
                    A headset that mutes with its own button never tells Windows, so the only
                    sign is the level going to a flat zero. With this on, a second of complete
                    silence while something is recording shows as muted.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={settings?.microphone.silenceAsMuted ?? true}
                  aria-label="Treat a dead signal as muted"
                  className={'switch' + (settings?.microphone.silenceAsMuted ? ' is-on' : '')}
                  onClick={() =>
                    void save({
                      microphone: {
                        silenceAsMuted: !settings?.microphone.silenceAsMuted,
                        silenceSeconds: settings?.microphone.silenceSeconds ?? 1
                      }
                    })
                  }
                >
                  <span className="switch-knob" />
                </button>
              </div>

              {settings?.microphone.silenceAsMuted && (
                <label className="field">
                  <span>Silence before it counts</span>
                  <span className="field-value">
                    <input
                      type="range"
                      min={0.5}
                      max={5}
                      step={0.5}
                      value={settings.microphone.silenceSeconds}
                      onChange={(event) =>
                        void save({
                          microphone: {
                            silenceAsMuted: true,
                            silenceSeconds: Number(event.target.value)
                          }
                        })
                      }
                    />
                    <span className="field-number">
                      {settings.microphone.silenceSeconds.toFixed(1) + 's'}
                    </span>
                  </span>
                </label>
              )}
            </section>

            <section className="panel">
              <h3>Mute hotkey</h3>
              <p>
                One key or mouse button that mutes and unmutes in Windows from anywhere,
                including inside a game. A headset that mutes with its own button never tells
                Windows anything, so this is the mute the overlay can be certain about.
              </p>

              <div className="field">
                <span>Hotkey</span>
                <span className="field-value">
                  <span className="hotkey-chip">
                    {capturing ? 'Press a key or button...' : (settings?.hotkey?.name ?? 'Not set')}
                  </span>
                  <button
                    onClick={() => {
                      if (capturing) {
                        void window.api.hotkey.cancel()
                        return
                      }
                      setCaptureNote(null)
                      setCapturing(true)
                      void window.api.hotkey.capture()
                    }}
                  >
                    {capturing ? 'Cancel' : settings?.hotkey ? 'Change' : 'Set hotkey'}
                  </button>
                  <button
                    disabled={!settings?.hotkey || capturing}
                    onClick={() =>
                      void window.api.hotkey.clear().then((next) => {
                        setSettings(next)
                        setCaptureNote(null)
                      })
                    }
                  >
                    Clear
                  </button>
                </span>
              </div>

              {capturing && (
                <p className="warn-text">
                  Press the key or button you want, then let go - whatever you release is what
                  gets bound. Escape cancels. Left and right click stay reserved for normal use.
                </p>
              )}
              {!capturing && captureNote && <p className="warn-text">{captureNote}</p>}
              {!capturing && !captureNote && settings?.hotkey && (
                <p>
                  Windows watches for this one key only, and passes it straight on to whatever
                  is in front - binding it does not take it away from the game.
                </p>
              )}
            </section>

            <section className="panel">
              <h3>Where it sits</h3>

              <div className="preview" data-corner={overlay.corner}>
                <span
                  className={'preview-pill is-' + mode}
                  style={{ opacity: overlay.opacity, transform: 'scale(' + overlay.scale + ')' }}
                >
                  <MicGlyph muted={mode === 'muted'} />
                  <span className="preview-text">
                    <span className="preview-label">{words.label}</span>
                    <span className="preview-detail">{words.detail}</span>
                  </span>
                </span>
              </div>

              <label className="field">
                <span>Corner</span>
                <select
                  value={overlay.corner}
                  onChange={(event) => setOverlay({ corner: event.target.value as Corner })}
                >
                  {CORNERS.map((corner) => (
                    <option key={corner.value} value={corner.value}>
                      {corner.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* One monitor needs no question asking about it. */}
              {(context?.displays.length ?? 0) > 1 && (
                <>
                  <label className="field">
                    <span>Monitor</span>
                    <select
                      value={overlay.followMouse ? 'mouse' : (overlay.displayId ?? '')}
                      onChange={(event) =>
                        setOverlay(
                          event.target.value === 'mouse'
                            ? { followMouse: true }
                            : {
                                followMouse: false,
                                displayId:
                                  event.target.value === '' ? null : Number(event.target.value)
                              }
                        )
                      }
                    >
                      <option value="mouse">Wherever the mouse is</option>
                      <option value="">Main monitor</option>
                      {context?.displays.map((display) => (
                        <option key={display.id} value={display.id}>
                          {display.label + ' (' + display.width + ' x ' + display.height + ')'}
                        </option>
                      ))}
                    </select>
                  </label>
                  {overlay.followMouse && (
                    <p>
                      The pill moves to whichever monitor the pointer is on. While a game has
                      the pointer, that is the monitor the game is on.
                    </p>
                  )}
                </>
              )}

              <label className="field">
                <span>Transparency</span>
                <span className="field-value">
                  <input
                    type="range"
                    min={0.3}
                    max={1}
                    step={0.05}
                    value={overlay.opacity}
                    onChange={(event) => setOverlay({ opacity: Number(event.target.value) })}
                  />
                  <span className="field-number">{Math.round(overlay.opacity * 100) + '%'}</span>
                </span>
              </label>

              <label className="field">
                <span>Size</span>
                <span className="field-value">
                  <input
                    type="range"
                    min={0.8}
                    max={1.5}
                    step={0.05}
                    value={overlay.scale}
                    onChange={(event) => setOverlay({ scale: Number(event.target.value) })}
                  />
                  <span className="field-number">{Math.round(overlay.scale * 100) + '%'}</span>
                </span>
              </label>

              <label className="field">
                <span>Gap from the edge</span>
                <span className="field-value">
                  <input
                    type="range"
                    min={0}
                    max={120}
                    step={4}
                    value={overlay.margin}
                    onChange={(event) => setOverlay({ margin: Number(event.target.value) })}
                  />
                  <span className="field-number">{overlay.margin + 'px'}</span>
                </span>
              </label>

              <p>
                The overlay re-claims the top of the screen every second, which keeps it over
                borderless-windowed games. A game set to <strong>true exclusive fullscreen</strong>{' '}
                takes the screen away from the desktop altogether, and nothing drawn as a window -
                this, Steam&apos;s overlay, the Windows volume popup - can appear over it. In CS2
                that is Video Settings, Display Mode: choose <strong>Fullscreen Windowed</strong>.
              </p>
            </section>
          </>
        )}

        <section className="panel">
          <div className="switch-row">
            <div className="switch-text">
              <strong>Start with Windows</strong>
              <p>
                Opens straight into the tray at login, with no window - which is the point of a
                background app.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={startWithWindows}
              aria-label="Start with Windows"
              className={'switch' + (startWithWindows ? ' is-on' : '')}
              onClick={() =>
                void window.api
                  .setStartWithWindows(!startWithWindows)
                  .then((enabled) => setStartWithWindows(enabled))
              }
            >
              <span className="switch-knob" />
            </button>
          </div>
        </section>

        <section className="panel">
          <h3>Details</h3>
          <dl className="details">
            <dt>Recording device</dt>
            <dd>{state.device ?? '-'}</dd>
            <dt>Using the microphone</dt>
            <dd>{state.apps.length > 0 ? state.apps.join(', ') : 'Nothing'}</dd>
            <dt>Signal level</dt>
            <dd>{Math.round(state.peak * 100) + '%'}</dd>
            <dt>Silent for</dt>
            <dd>
              {state.silentMs < 0
                ? 'Not measurable'
                : state.silentMs >= 10000
                  ? 'Over 10s'
                  : (state.silentMs / 1000).toFixed(2) + 's'}
            </dd>
            <dt>Endpoint</dt>
            <dd>{state.id ?? '-'}</dd>
          </dl>
        </section>

        <footer className="page-footer">
          <span>Mic Overlay {context?.appVersion ?? ''} - closing this window leaves it running</span>
          <button onClick={() => void window.api.hideWindow()}>Hide to tray</button>
        </footer>
      </main>
    </div>
  )
}
