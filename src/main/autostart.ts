import { app } from 'electron'

/**
 * "Start with Windows", which is a Run key entry under the hood. Electron owns the writing;
 * this file only exists to keep the launch arguments in one place, because the flag below is
 * the difference between the app appearing at every login and it starting quietly in the
 * tray the way a background app should.
 */

/** Passed to the copy Windows launches at login, and read in index.ts. */
export const HIDDEN_FLAG = '--hidden'

export function startsWithWindows(): boolean {
  return app.getLoginItemSettings({ args: [HIDDEN_FLAG] }).openAtLogin
}

export function setStartWithWindows(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Explicit rather than default: in development execPath is electron.exe, and an entry
    // pointing at that would launch a bare Electron at every login.
    path: process.execPath,
    args: [HIDDEN_FLAG]
  })
}

/** True when this copy was started by that Run key entry rather than by a person. */
export function startedHidden(): boolean {
  return process.argv.includes(HIDDEN_FLAG)
}
