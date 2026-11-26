export interface LineSequence {
  start: number
  end: number
  addrs: number[]
  lines: number[]
  files: string[]
}

export interface LineSections {
  line: Uint8Array
  lineStr?: Uint8Array
  str?: Uint8Array
}

class Reader {
  p: number
  private b: Uint8Array
  private v: DataView
  constructor(b: Uint8Array, p = 0) {
    this.b = b
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    this.p = p
  }
  u8() { return this.b[this.p++] }
  u16() { const x = this.v.getUint16(this.p, true); this.p += 2; return x }
  u32() { const x = this.v.getUint32(this.p, true); this.p += 4; return x }
  u64() { const x = Number(this.v.getBigUint64(this.p, true)); this.p += 8; return x }
  i8() { const x = this.v.getInt8(this.p); this.p += 1; return x }
  uleb() {
    let r = 0
    let shift = 1
    for (;;) {
      const x = this.b[this.p++]
      r += (x & 0x7f) * shift
      if (!(x & 0x80)) return r
      shift *= 128
    }
  }
  sleb() {
    let r = 0
    let shift = 1
    for (;;) {
      const x = this.b[this.p++]
      r += (x & 0x7f) * shift
      shift *= 128
      if (!(x & 0x80)) return x & 0x40 ? r - shift : r
    }
  }
  cstr() {
    const s = this.p
    while (this.b[this.p] !== 0) this.p++
    return new TextDecoder().decode(this.b.subarray(s, this.p++))
  }
}

const cstrAt = (b: Uint8Array | undefined, at: number) => (b ? new Reader(b, at).cstr() : '')

function readEntry(r: Reader, format: [number, number][], sections: LineSections) {
  const out: Record<number, string | number> = {}
  for (const [type, form] of format) {
    let value: string | number
    switch (form) {
      case 0x08: value = r.cstr(); break
      case 0x0e: value = cstrAt(sections.str, r.u32()); break
      case 0x1f: value = cstrAt(sections.lineStr, r.u32()); break
      case 0x0b: value = r.u8(); break
      case 0x05: value = r.u16(); break
      case 0x06: value = r.u32(); break
      case 0x07: value = r.u64(); break
      case 0x0f: value = r.uleb(); break
      case 0x1e: r.p += 16; value = 0; break
      case 0x09: r.p += r.uleb(); value = 0; break
      default: throw new Error(`Unsupported DWARF form 0x${form.toString(16)}`)
    }
    out[type] = value
  }
  return out
}

const join = (dir: string, name: string) => (!dir || /^([/\\]|[A-Za-z]:)/.test(name) ? name : `${dir}/${name}`)

export function parseDebugLine(sections: LineSections): LineSequence[] {
  const { line } = sections
  const seqs: LineSequence[] = []
  for (let unitStart = 0; unitStart + 4 < line.length; ) {
    const r = new Reader(line, unitStart)
    const unitLength = r.u32()
    if (unitLength === 0xffffffff) break
    const unitEnd = r.p + unitLength
    const version = r.u16()
    if (version >= 5) r.p += 2
    const headerLength = r.u32()
    const programStart = r.p + headerLength
    const minInst = r.u8()
    if (version >= 4) r.u8()
    r.u8()
    const lineBase = r.i8()
    const lineRange = r.u8()
    const opcodeBase = r.u8()
    const stdLengths = Array.from({ length: opcodeBase - 1 }, () => r.u8())

    const dirs: string[] = []
    const files: string[] = []
    if (version >= 5) {
      const readFormat = () => Array.from({ length: r.u8() }, () => [r.uleb(), r.uleb()] as [number, number])
      const dirFormat = readFormat()
      for (let n = r.uleb(); n > 0; n--) dirs.push(String(readEntry(r, dirFormat, sections)[1] ?? ''))
      const fileFormat = readFormat()
      for (let n = r.uleb(); n > 0; n--) {
        const e = readEntry(r, fileFormat, sections)
        files.push(join(dirs[Number(e[2] ?? 0)] ?? '', String(e[1] ?? '')))
      }
    } else {
      dirs.push('')
      for (let d = r.cstr(); d; d = r.cstr()) dirs.push(d)
      files.push('')
      for (let name = r.cstr(); name; name = r.cstr()) {
        const dir = r.uleb()
        r.uleb()
        r.uleb()
        files.push(join(dirs[dir] ?? '', name))
      }
    }

    r.p = programStart
    let addr = 0
    let file = 1
    let ln = 1
    let cur: LineSequence | null = null
    const row = () => {
      if (!cur) cur = { start: addr, end: addr, addrs: [], lines: [], files: [] }
      cur.addrs.push(addr)
      cur.lines.push(ln)
      cur.files.push(files[file] ?? '')
    }
    const reset = () => {
      addr = 0
      file = 1
      ln = 1
    }

    while (r.p < unitEnd) {
      const op = r.u8()
      if (op >= opcodeBase) {
        const adj = op - opcodeBase
        addr += Math.floor(adj / lineRange) * minInst
        ln += lineBase + (adj % lineRange)
        row()
      } else if (op === 0) {
        const len = r.uleb()
        const next = r.p + len
        const sub = r.u8()
        if (sub === 1) {
          if (cur) {
            const done: LineSequence = cur
            done.end = addr
            seqs.push(done)
            cur = null
          }
          reset()
        } else if (sub === 2) addr = len - 1 === 4 ? r.u32() : r.u64()
        r.p = next
      } else {
        switch (op) {
          case 1: row(); break
          case 2: addr += r.uleb() * minInst; break
          case 3: ln += r.sleb(); break
          case 4: file = r.uleb(); break
          case 8: addr += Math.floor((255 - opcodeBase) / lineRange) * minInst; break
          case 9: addr += r.u16(); break
          default: for (let i = 0; i < stdLengths[op - 1]; i++) r.uleb()
        }
      }
    }
    unitStart = unitEnd
  }
  seqs.sort((a, b) => a.start - b.start)
  return seqs
}

export function lookupLine(seqs: LineSequence[], addr: number): { file: string; line: number } | null {
  let lo = 0
  let hi = seqs.length - 1
  let s: LineSequence | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (seqs[mid].start <= addr) {
      s = seqs[mid]
      lo = mid + 1
    } else hi = mid - 1
  }
  if (!s) return null
  for (let i = seqs.indexOf(s); i > 0 && seqs[i - 1].start === s.start && seqs[i - 1].end === s.end; i--) s = seqs[i - 1]
  if (addr >= s.end) return null
  lo = 0
  hi = s.addrs.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (s.addrs[mid] <= addr) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best < 0 ? null : { file: s.files[best], line: s.lines[best] }
}
