import { lookupLine, parseDebugLine } from './dwarf.ts'
import type { Symbolizer } from './types.ts'

const STT_FUNC = 2

export function parseElf(data: Uint8Array, demangle: (name: string) => string = (n) => n): Symbolizer {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (v.getUint32(0, false) !== 0x7f454c46 || data[4] !== 2 || data[5] !== 1) throw new Error('Not a 64-bit little-endian ELF file.')

  const shoff = Number(v.getBigUint64(0x28, true))
  const shentsize = v.getUint16(0x3a, true)
  const shnum = v.getUint16(0x3c, true)
  const shstrndx = v.getUint16(0x3e, true)
  const sec = (i: number) => {
    const o = shoff + i * shentsize
    return { name: v.getUint32(o, true), type: v.getUint32(o + 4, true), offset: Number(v.getBigUint64(o + 24, true)), size: Number(v.getBigUint64(o + 32, true)), link: v.getUint32(o + 40, true) }
  }
  const sections = Array.from({ length: shnum }, (_, i) => sec(i))
  const cstr = (at: number) => {
    let end = at
    while (data[end] !== 0) end++
    return new TextDecoder().decode(data.subarray(at, end))
  }
  const shstr = sections[shstrndx].offset
  const byName = new Map(sections.map((s) => [cstr(shstr + s.name), s]))
  const slice = (name: string) => {
    const s = byName.get(name)
    return s && s.type !== 8 ? data.subarray(s.offset, s.offset + s.size) : undefined
  }

  const symtab = byName.get('.symtab')
  const funcs: { addr: number; size: number; name: string }[] = []
  if (symtab) {
    const strtab = sections[symtab.link].offset
    for (let o = symtab.offset; o + 24 <= symtab.offset + symtab.size; o += 24) {
      const addr = Number(v.getBigUint64(o + 8, true))
      if ((data[o + 4] & 0xf) === STT_FUNC && addr) {
        funcs.push({ addr, size: Number(v.getBigUint64(o + 16, true)), name: cstr(strtab + v.getUint32(o, true)) })
      }
    }
    funcs.sort((a, b) => a.addr - b.addr)
  }

  const debugLine = slice('.debug_line')
  const seqs = debugLine ? parseDebugLine({ line: debugLine, lineStr: slice('.debug_line_str'), str: slice('.debug_str') }) : []

  return {
    kind: 'elf',
    lookup(addr) {
      let lo = 0
      let hi = funcs.length - 1
      let f: (typeof funcs)[number] | null = null
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (funcs[mid].addr <= addr) {
          f = funcs[mid]
          lo = mid + 1
        } else hi = mid - 1
      }
      if (!f || (f.size > 0 && addr >= f.addr + f.size)) return null
      const line = lookupLine(seqs, addr)
      return { name: demangle(f.name), file: line?.file, line: line?.line }
    },
  }
}
