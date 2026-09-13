# Mic Overlay

A microphone indicator that sits over your games and apps, in the style of Discord's overlay:
a small translucent pill in a corner of the screen that says whether anything can hear you.
It lives in the notification area - the arrow at the right-hand end of the taskbar - and the
tray icon is the switch that turns the overlay on and off.

Built for a Logitech G435, but it reads the Windows recording device rather than the headset,
so it works with any microphone.

## What it shows

| Pill | Meaning |
| --- | --- |
| **Mic live** (green) | A program has the microphone open and it is not muted |
| **Mic muted** (red) | Muted in Windows, or dead silent for a second while something records |
| **Mic on** (grey) | The microphone works, but nothing is recording |
| **No microphone** (amber) | Windows has no recording device set |

The tray icon carries the same three colours, so the state is readable without the overlay on
at all. Clicking it toggles the overlay; right-clicking gives the menu, including mute and
**Start with Windows**.

## How it knows

Three things Windows keeps in different places, all read by `micprobe.exe`:

- **Muted, and the signal level** - the Core Audio endpoint for the default recording device
  (`IAudioEndpointVolume`, `IAudioMeterInformation`). This is the same mute the sound settings
  slider shows, and the one apps see.
- **Muted on the headset** - a G435, and most wireless headsets, mute inside the headset and
  never tell Windows, so the endpoint above keeps saying "not muted". What does change is the
  level: a live microphone never reads exactly zero, because a real capsule always has a noise
  floor, while a muted one is digital silence. A second of flat zero while a program is
  recording is reported as muted. How long that silence has to last is a slider in the
  settings window, along with the switch to stop trusting it at all.
- **What is recording** - the Capability Access Manager's log under
  `...\CapabilityAccessManager\ConsentStore\microphone`, where Windows leaves a stop time of
  zero for as long as a program still holds the microphone. That is where names like
  "Discord" come from.

None of it is reachable from Node, so it all lives in a small C# helper that the app starts once
and reads a line of JSON from. Muting from the tray goes back the same way.

## Building

Nothing to install beyond Node: the C# compiler is the one inside `C:\Windows\Microsoft.NET`,
and the icons are drawn by `tools/make-icon.mjs`.

```
npm install
npm run dev      # run it
build.bat        # icons, probe, bundle, package, and compile the installer
```

`build.bat` needs [Inno Setup 6](https://jrsoftware.org/isdl.php) for its last step; the four
before it work without it and leave a runnable app in `release\win-unpacked`.

If `npm run dev` stops with `Error: Electron uninstall`, npm skipped Electron's download step -
`node node_modules/electron/install.js` fetches the binary and fixes it.

## Layout

```
native/MicProbe.cs        the Windows side: Core Audio and the consent store
src/main/mic.ts           owns the probe process, parses its output
src/main/overlay.ts       the click-through, always-on-top pill window
src/main/tray.ts          the tray icon, its menu, and the overlay switch
src/renderer/overlay/     the pill itself - plain DOM, no framework
src/renderer/src/         the settings window (React)
src/shared/               the types and the state names both sides use
```

## The mute hotkey

One key or one mouse button, bound by pressing it: click **Set hotkey**, press what you want,
let go. Pressing it afterwards toggles the Windows mute from anywhere, including inside a game.

Mouse buttons are why this is not Electron's own `globalShortcut`, which only sees the
keyboard. `micprobe.exe` installs a low-level keyboard and mouse hook instead, with two limits
worth stating plainly:

- The hook is not installed until a hotkey is set or recorded. Set none and none exists.
- It reports two things and nothing else: the one key being bound while recording, and the
  fact that the bound key was pressed afterwards. Every key and button is passed straight on
  to whatever had focus, so binding one does not take it away from the game.

Left and right click cannot be bound - they are needed everywhere else. A side button
(Mouse 4 or 5) is the usual choice; middle click works but is also a grenade key in CS2 and a
tab-closer in a browser.

## Staying on top

The overlay re-claims the top of the z-order once a second while it is visible, which is what
keeps it above a borderless-fullscreen game rather than behind it after the first alt-tab.
The same tick moves it between monitors when **Wherever the mouse is** is chosen, since during
a game the pointer is inside the game.

The one case that cannot work: a game in **true exclusive fullscreen** takes the screen away
from the desktop compositor, and nothing drawn as an ordinary window - this overlay, Steam's,
the Windows volume popup - can appear over it. In CS2 that is Video Settings, Display Mode:
**Fullscreen Windowed** instead of Fullscreen. Discord gets around it by injecting a DLL into
the game's renderer; this app deliberately does not.
