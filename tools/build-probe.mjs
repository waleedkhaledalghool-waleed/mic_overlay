/**
 * Compiles native/MicProbe.cs to resources/micprobe.exe.
 *
 * The compiler used is the one inside C:\Windows\Microsoft.NET - part of the .NET Framework
 * that every Windows 10 and 11 install already carries. Nothing has to be installed to build
 * this repo, and the result is a ~15 KB exe that runs on the same framework.
 *
 * Re-running is cheap and skipped when the exe is already newer than the source, so `npm run
 * dev` can depend on it without adding a second to every start.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, '..', 'native', 'MicProbe.cs')
const OUT = join(HERE, '..', 'resources', 'micprobe.exe')

/** 64-bit first: the app is 64-bit, and a 32-bit probe reads a redirected registry view. */
const COMPILERS = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
]

function isUpToDate() {
  if (!existsSync(OUT)) return false
  return statSync(OUT).mtimeMs >= statSync(SOURCE).mtimeMs
}

if (isUpToDate()) {
  console.log('micprobe.exe is up to date')
  process.exit(0)
}

const csc = COMPILERS.find((path) => existsSync(path))
if (!csc) {
  console.error('No C# compiler found under C:\\Windows\\Microsoft.NET.')
  console.error('Enable the .NET Framework 4 feature in "Turn Windows features on or off".')
  process.exit(1)
}

mkdirSync(dirname(OUT), { recursive: true })

execFileSync(
  csc,
  [
    '/nologo',
    // A console subsystem with no console: the app owns this process and pipes its
    // streams, and /target:winexe would leave nowhere to write them.
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    '/out:' + OUT,
    SOURCE
  ],
  { stdio: 'inherit' }
)

console.log('Wrote ' + OUT)
