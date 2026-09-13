/**
 * Draws the app icon and the three tray icons: a rounded tile carrying a white microphone,
 * in a colour that says what the microphone is doing.
 *
 * Written by hand rather than pulled from a design tool so the icons are reproducible from
 * the repo alone - `node tools/make-icon.mjs` regenerates them byte for byte. No image
 * library is involved: the rasteriser below is a few dozen lines, PNG is a documented
 * container, and zlib ships with Node.
 *
 * The tray icon is a filled tile rather than a bare glyph on purpose. A white microphone is
 * invisible on a light taskbar and a dark one is invisible on a dark taskbar; a coloured
 * tile reads on both, and carries the state in the one glance the tray ever gets.
 */
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = join(HERE, '..', 'build')
const RESOURCES = join(HERE, '..', 'resources')

const GLYPH = [0xff, 0xff, 0xff]

/**
 * Each icon and what its colour means. The tray shades are lighter than the settings
 * window's equivalents: a 16 px tile has a few dozen pixels to make its point with.
 */
const ICONS = [
  { file: join(BUILD, 'icon.ico'), tile: [0x1f, 0x5f, 0x8b], muted: false, sizes: null },
  { file: join(RESOURCES, 'tray-live.ico'), tile: [0x2f, 0xa8, 0x60], muted: false, sizes: null },
  { file: join(RESOURCES, 'tray-muted.ico'), tile: [0xd9, 0x3b, 0x35], muted: true, sizes: null },
  { file: join(RESOURCES, 'tray-idle.ico'), tile: [0x5b, 0x63, 0x6f], muted: false, sizes: null }
]

/** Every size Windows picks from: the tray takes 16 to 24, the desktop 48, the Store 256. */
const SIZES = [16, 20, 24, 32, 48, 64, 128, 256]

/** Samples per axis. 4 means 16 colour decisions per pixel - enough to hide the stair-stepping. */
const SS = 4

/* --- geometry, all in units of the icon's edge length ---------------------- */

const CORNER = 0.2

/** The capsule: a line segment thickened into a rounded bar. */
const CAPSULE_TOP = 0.295
const CAPSULE_BOTTOM = 0.455
const CAPSULE_RADIUS = 0.105

/** The cradle under it, drawn as the lower half of a ring. */
const ARC_CENTRE_Y = 0.46
const ARC_RADIUS = 0.235
const ARC_HALF_THICKNESS = 0.042

const STEM_HALF_WIDTH = 0.038
const STEM_BOTTOM = 0.8
const FOOT_HALF_WIDTH = 0.145
const FOOT_BOTTOM = 0.845

/** The muted slash, and the gap it is cut out of the glyph with. */
const SLASH_HALF_THICKNESS = 0.045
const SLASH_HALF_LENGTH = 0.45
const GAP_HALF_THICKNESS = 0.095
const GAP_HALF_LENGTH = 0.48

const ROOT_2 = Math.SQRT2

/** Signed distance to a rounded square centred in the unit canvas. Negative is inside. */
function roundedSquare(x, y) {
  const half = 0.5 - CORNER
  const qx = Math.abs(x - 0.5) - half
  const qy = Math.abs(y - 0.5) - half
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - CORNER
}

function inMicrophone(x, y) {
  const dx = x - 0.5

  // Capsule: distance to the vertical segment it is built from.
  const clamped = Math.min(Math.max(y, CAPSULE_TOP), CAPSULE_BOTTOM)
  if (Math.hypot(dx, y - clamped) <= CAPSULE_RADIUS) return true

  // Cradle: the ring, kept to the half below its centre.
  const radius = Math.hypot(dx, y - ARC_CENTRE_Y)
  if (y >= ARC_CENTRE_Y && Math.abs(radius - ARC_RADIUS) <= ARC_HALF_THICKNESS) return true

  // Stem, from where the cradle bottoms out down to the foot.
  if (Math.abs(dx) <= STEM_HALF_WIDTH && y >= ARC_CENTRE_Y && y <= STEM_BOTTOM) return true

  return Math.abs(dx) <= FOOT_HALF_WIDTH && y >= STEM_BOTTOM && y <= FOOT_BOTTOM
}

/** Distance from the 45-degree line through the centre, and position along it. */
function slashCoords(x, y) {
  return {
    across: Math.abs(x - y) / ROOT_2,
    along: (x - 0.5 + (y - 0.5)) / ROOT_2
  }
}

function inGlyph(x, y, muted) {
  if (!muted) return inMicrophone(x, y)

  const { across, along } = slashCoords(x, y)
  if (across <= SLASH_HALF_THICKNESS && Math.abs(along) <= SLASH_HALF_LENGTH) return true
  // The gap keeps the bar readable where it crosses the microphone, the way a "no" sign
  // stays legible over whatever it is cancelling.
  if (across <= GAP_HALF_THICKNESS && Math.abs(along) <= GAP_HALF_LENGTH) return false

  return inMicrophone(x, y)
}

/** One size, rasterised to a raw RGBA buffer. */
function render(size, tile, muted) {
  const pixels = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size

          let colour = null
          if (roundedSquare(x, y) <= 0) colour = inGlyph(x, y, muted) ? GLYPH : tile

          if (colour) {
            r += colour[0]
            g += colour[1]
            b += colour[2]
            a += 255
          }
        }
      }

      const samples = SS * SS
      const offset = (py * size + px) * 4
      // Colour is averaged over the covered samples only; averaging over all of them would
      // drag edge pixels toward black, which is the classic dark-fringe artefact.
      const covered = a / 255
      if (covered > 0) {
        pixels[offset] = Math.round(r / covered)
        pixels[offset + 1] = Math.round(g / covered)
        pixels[offset + 2] = Math.round(b / covered)
      }
      pixels[offset + 3] = Math.round(a / samples)
    }
  }

  return pixels
}

/* --- PNG container --------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function toPng(pixels, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  // Bytes 10-12 stay zero: deflate, the standard filter set, no interlacing.

  // Each scanline carries a leading filter byte. Filter 0 (none) keeps this readable, and the
  // icon is flat colour, so the compressor loses nothing worth chasing.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* --- ICO container --------------------------------------------------------- */

function toIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(entries.length, 4)

  const DIR_ENTRY = 16
  let offset = header.length + entries.length * DIR_ENTRY

  const directory = []
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(DIR_ENTRY)
    // 256 does not fit a byte and is encoded as 0 - the format's one wrinkle.
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette size, meaningless for 32-bit
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    directory.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.png)])
}

mkdirSync(BUILD, { recursive: true })
mkdirSync(RESOURCES, { recursive: true })

for (const icon of ICONS) {
  const sizes = icon.sizes ?? SIZES
  const entries = sizes.map((size) => ({
    size,
    png: toPng(render(size, icon.tile, icon.muted), size)
  }))
  writeFileSync(icon.file, toIco(entries))
  console.log('Wrote ' + icon.file)
}
