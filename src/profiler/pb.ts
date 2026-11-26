import { ProfileBuilder } from './build.ts'

const PROGRESS_STEP = 1 << 22

export function parsePb(b: Uint8Array, progress: (ratio: number) => void): ProfileBuilder {
  const out = new ProfileBuilder(b.length / 22)
  const dec = new TextDecoder()
  const n = b.length
  let p = 0

  const varint = () => {
    let x = b[p++]
    if (x < 0x80) return x
    let r = x & 0x7f
    let m = 128
    for (;;) {
      x = b[p++]
      r += (x & 0x7f) * m
      if (x < 0x80) return r
      m *= 128
      if (m > 2 ** 63) throw new Error('This is not a SwiftlyS2 .pb profile (bad varint).')
    }
  }

  const skip = (wire: number) => {
    if (wire === 0) varint()
    else if (wire === 1) p += 8
    else if (wire === 2) p += varint()
    else if (wire === 5) p += 4
    else throw new Error('This is not a SwiftlyS2 .pb profile (unknown wire type).')
  }

  const fields = (end: number, read: (field: number, value: number) => void) => {
    while (p < end) {
      const tag = varint()
      if ((tag & 7) === 0) read(tag >>> 3, varint())
      else skip(tag & 7)
    }
    if (p !== end) throw new Error('This is not a SwiftlyS2 .pb profile (message overruns its length).')
  }

  let name = 0
  let cat = 0
  let tid = 0
  let start = 0
  let dur = 0
  let source = 0
  const span = (f: number, v: number) => {
    if (f === 1) name = v
    else if (f === 2) cat = v
    else if (f === 3) tid = v
    else if (f === 4) start = v
    else if (f === 5) dur = v
    else if (f === 6) source = v
  }

  let size = 0
  const alloc = (f: number, v: number) => {
    if (f === 1) name = v
    else if (f === 5) source = v
    else if (f === 4) size = v
  }

  const thread = (f: number, v: number) => {
    if (f === 1) tid = v
    else if (f === 2) name = v
  }

  let nextProgress = PROGRESS_STEP
  while (p < n) {
    const tag = varint()
    const field = tag >>> 3
    const wire = tag & 7
    if (field === 0) throw new Error('This is not a SwiftlyS2 .pb profile (field number 0).')
    if (wire !== 2) {
      skip(wire)
      continue
    }
    const len = varint()
    const end = p + len
    if (end > n) throw new Error('The .pb file is truncated.')
    if (field === 2) {
      out.strings.push(dec.decode(b.subarray(p, end)))
      p = end
    } else if (field === 3) {
      name = cat = tid = start = dur = source = 0
      fields(end, span)
      out.addSpan(name, source, cat, tid, start, dur)
    } else if (field === 4) {
      name = source = size = 0
      fields(end, alloc)
      out.addAllocation(name, source, size)
    } else if (field === 5) {
      tid = name = 0
      fields(end, thread)
      out.setThreadName(tid, name)
    } else p = end
    if (p >= nextProgress) {
      progress(p / n)
      nextProgress = p + PROGRESS_STEP
    }
  }
  if (p !== n) throw new Error('The .pb file is truncated.')
  if (out.strings.length === 0) out.strings.push('')
  return out
}
