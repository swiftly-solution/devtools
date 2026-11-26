import type { Resolved, Symbolizer } from './types.ts'

const MAGIC = 'Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0'
const PROC_RECORDS = new Set([0x1110, 0x110f, 0x1147, 0x1146])
const DEBUG_S_LINES = 0xf2
const DEBUG_S_FILECHKSMS = 0xf4

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)
const align4 = (n: number) => (n + 3) & ~3

function cstr(b: Uint8Array, at: number) {
  let end = at
  while (end < b.length && b[end] !== 0) end++
  return new TextDecoder().decode(b.subarray(at, end))
}

class Msf {
  private buf: Uint8Array
  private blockSize: number
  private blocks: number[][] = []
  private sizes: number[] = []

  constructor(buf: Uint8Array) {
    this.buf = buf
    if (new TextDecoder('latin1').decode(buf.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('Not an MSVC PDB (MSF 7.00) file.')
    const h = dv(buf)
    this.blockSize = h.getUint32(32, true)
    const dirBytes = h.getUint32(44, true)
    const mapAddr = h.getUint32(52, true)
    const dirBlockCount = Math.ceil(dirBytes / this.blockSize)
    const mapView = dv(buf.subarray(mapAddr * this.blockSize))
    const dirBlocks = Array.from({ length: dirBlockCount }, (_, i) => mapView.getUint32(i * 4, true))
    const dir = this.read(dirBlocks, dirBytes)
    const d = dv(dir)
    const count = d.getUint32(0, true)
    let p = 4 + count * 4
    for (let i = 0; i < count; i++) {
      const raw = d.getUint32(4 + i * 4, true)
      const size = raw === 0xffffffff ? 0 : raw
      const n = Math.ceil(size / this.blockSize)
      this.sizes.push(size)
      this.blocks.push(Array.from({ length: n }, (_, j) => d.getUint32(p + j * 4, true)))
      p += n * 4
    }
  }

  private read(blocks: number[], size: number) {
    const out = new Uint8Array(size)
    blocks.forEach((blk, i) => {
      const from = blk * this.blockSize
      out.set(this.buf.subarray(from, Math.min(from + this.blockSize, from + size - i * this.blockSize)), i * this.blockSize)
    })
    return out
  }

  stream(i: number) {
    return this.read(this.blocks[i] ?? [], this.sizes[i] ?? 0)
  }
}

interface Module {
  stream: number
  symSize: number
  c11Size: number
  c13Size: number
}

interface Proc {
  seg: number
  off: number
  len: number
  name: string
}

interface LineBlock {
  fileOff: number
  entries: [number, number][]
}

interface LineSection {
  seg: number
  off: number
  size: number
  blocks: LineBlock[]
}

interface ParsedModule {
  procs: Proc[]
  lines: LineSection[]
  fileNames: Map<number, number>
}

export function parsePdb(data: Uint8Array): Symbolizer {
  const msf = new Msf(data)

  const names = namedStream(msf, '/names')
  const dbi = msf.stream(3)
  const h = dv(dbi)
  const modInfoSize = h.getInt32(24, true)
  const secContribSize = h.getInt32(28, true)
  const secMapSize = h.getInt32(32, true)
  const sourceInfoSize = h.getInt32(36, true)
  const typeServerSize = h.getInt32(40, true)
  const ecSize = h.getInt32(52, true)

  const modStart = 64
  const secContribStart = modStart + modInfoSize
  const dbgHeaderStart = secContribStart + secContribSize + secMapSize + sourceInfoSize + typeServerSize + ecSize

  const modules: Module[] = []
  for (let p = modStart; p < modStart + modInfoSize; ) {
    modules.push({
      stream: h.getUint16(p + 34, true),
      symSize: h.getUint32(p + 36, true),
      c11Size: h.getUint32(p + 40, true),
      c13Size: h.getUint32(p + 44, true),
    })
    p += 64
    p = align4(p + cstr(dbi, p).length + 1)
    p = align4(p + cstr(dbi, p).length + 1)
  }

  const sectionStream = h.getUint16(dbgHeaderStart + 5 * 2, true)
  const sh = dv(msf.stream(sectionStream))
  const sections = Array.from({ length: sh.byteLength / 40 }, (_, i) => ({
    va: sh.getUint32(i * 40 + 12, true),
    size: Math.max(sh.getUint32(i * 40 + 8, true), sh.getUint32(i * 40 + 16, true)),
  }))

  const entrySize = h.getUint32(secContribStart, true) === 0xf13151e4 ? 32 : 28
  const contribs: { seg: number; off: number; size: number; mod: number }[] = []
  for (let p = secContribStart + 4; p + entrySize <= secContribStart + secContribSize; p += entrySize) {
    const size = h.getInt32(p + 8, true)
    if (size > 0) contribs.push({ seg: h.getUint16(p, true), off: h.getInt32(p + 4, true), size, mod: h.getUint16(p + 16, true) })
  }
  contribs.sort((a, b) => a.seg - b.seg || a.off - b.off)

  function findModule(seg: number, off: number) {
    let lo = 0
    let hi = contribs.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const c = contribs[mid]
      if (c.seg < seg || (c.seg === seg && c.off + c.size <= off)) lo = mid + 1
      else if (c.seg > seg || c.off > off) hi = mid - 1
      else return c.mod
    }
    return -1
  }

  const cache = new Map<number, ParsedModule>()
  function parseModule(index: number): ParsedModule {
    const hit = cache.get(index)
    if (hit) return hit
    const m = modules[index]
    const out: ParsedModule = { procs: [], lines: [], fileNames: new Map() }
    cache.set(index, out)
    if (!m || m.stream === 0xffff) return out
    const s = msf.stream(m.stream)
    const v = dv(s)

    for (let p = 4; p + 4 <= m.symSize; ) {
      const len = v.getUint16(p, true)
      if (len < 2) break
      if (PROC_RECORDS.has(v.getUint16(p + 2, true))) {
        out.procs.push({ len: v.getUint32(p + 16, true), off: v.getUint32(p + 32, true), seg: v.getUint16(p + 36, true), name: cstr(s, p + 39) })
      }
      p += 2 + len
    }

    const c13End = m.symSize + m.c11Size + m.c13Size
    const subsections: { kind: number; at: number; len: number }[] = []
    for (let p = m.symSize + m.c11Size; p + 8 <= c13End; ) {
      const len = v.getUint32(p + 4, true)
      subsections.push({ kind: v.getUint32(p, true) & 0x7fffffff, at: p + 8, len })
      p += 8 + align4(len)
    }
    for (const sub of subsections) {
      if (sub.kind === DEBUG_S_FILECHKSMS) {
        for (let p = 0; p + 8 <= sub.len; ) {
          out.fileNames.set(p, v.getUint32(sub.at + p, true))
          p = align4(p + 6 + v.getUint8(sub.at + p + 4))
        }
      }
    }
    for (const sub of subsections) {
      if (sub.kind !== DEBUG_S_LINES) continue
      const hasColumns = (v.getUint16(sub.at + 6, true) & 1) !== 0
      const section: LineSection = { off: v.getUint32(sub.at, true), seg: v.getUint16(sub.at + 4, true), size: v.getUint32(sub.at + 8, true), blocks: [] }
      for (let p = sub.at + 12; p + 12 <= sub.at + sub.len; ) {
        const count = v.getUint32(p + 4, true)
        const entries: [number, number][] = []
        for (let i = 0; i < count; i++) entries.push([v.getUint32(p + 12 + i * 8, true), v.getUint32(p + 16 + i * 8, true) & 0xffffff])
        section.blocks.push({ fileOff: v.getUint32(p, true), entries })
        p += 12 + count * (hasColumns ? 12 : 8)
      }
      out.lines.push(section)
    }
    return out
  }

  return {
    kind: 'pdb',
    lookup(rva) {
      const i = sections.findIndex((s) => rva >= s.va && rva < s.va + s.size)
      if (i < 0) return null
      const seg = i + 1
      const off = rva - sections[i].va
      const mod = findModule(seg, off)
      if (mod < 0) return null
      const parsed = parseModule(mod)
      const proc = parsed.procs.find((p) => p.seg === seg && off >= p.off && off < p.off + p.len)
      if (!proc) return null
      const result: Resolved = { name: proc.name }

      let bestOff = -1
      for (const sec of parsed.lines) {
        if (sec.seg !== seg || off < sec.off || off >= sec.off + sec.size) continue
        for (const block of sec.blocks) {
          for (const [entryOff, line] of block.entries) {
            if (sec.off + entryOff <= off && sec.off + entryOff >= bestOff) {
              bestOff = sec.off + entryOff
              const nameOff = parsed.fileNames.get(block.fileOff)
              result.line = line
              result.file = nameOff === undefined ? undefined : cstr(names, 12 + nameOff)
            }
          }
        }
      }
      return result
    },
  }
}

function namedStream(msf: Msf, name: string) {
  const info = msf.stream(1)
  const v = dv(info)
  const strSize = v.getUint32(28, true)
  const strings = info.subarray(32, 32 + strSize)
  let p = 32 + strSize
  const size = v.getUint32(p, true)
  p += 8
  const presentWords = v.getUint32(p, true)
  p += 4 + presentWords * 4
  const deletedWords = v.getUint32(p, true)
  p += 4 + deletedWords * 4
  for (let i = 0; i < size; i++, p += 8) {
    if (cstr(strings, v.getUint32(p, true)) === name) return msf.stream(v.getUint32(p + 4, true))
  }
  return new Uint8Array(0)
}
