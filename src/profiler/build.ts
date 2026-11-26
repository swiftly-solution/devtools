export const CATEGORIES = ['managed', 'native-to-managed', 'custom'] as const

export interface AllocRow {
  name: string
  count: number
  bytes: number
}

const MAX_STRING_ID = 0x1000000

export class ProfileBuilder {
  strings: string[] = []
  n = 0
  start: Float64Array
  dur: Float64Array
  fn: Uint32Array
  thread: Uint16Array
  fnName: number[] = []
  fnSource: number[] = []
  fnCat: number[] = []
  tids: number[] = []
  threadNames = new Map<number, number>()
  allocCount = 0
  allocBytes = 0
  allocByType = new Map<number, [number, number]>()
  allocByFunction = new Map<number, [number, number]>()
  private stringIds = new Map<string, number>()
  private fnIds = new Map<number, number>()
  private tidIds = new Map<number, number>()

  constructor(capacity: number) {
    const c = Math.max(1024, Math.ceil(capacity))
    this.start = new Float64Array(c)
    this.dur = new Float64Array(c)
    this.fn = new Uint32Array(c)
    this.thread = new Uint16Array(c)
  }

  intern(s: string) {
    let id = this.stringIds.get(s)
    if (id === undefined) {
      id = this.strings.length
      this.strings.push(s)
      this.stringIds.set(s, id)
    }
    return id
  }

  private threadIndex(tid: number) {
    let t = this.tidIds.get(tid)
    if (t === undefined) {
      t = this.tids.length
      if (t > 0xffff) throw new Error('The profile has more than 65535 threads.')
      this.tids.push(tid)
      this.tidIds.set(tid, t)
    }
    return t
  }

  addSpan(name: number, source: number, cat: number, tid: number, startNs: number, durNs: number) {
    if (name >= MAX_STRING_ID * 8 || source >= MAX_STRING_ID) throw new Error('The profile has too many distinct strings.')
    const key = (name * MAX_STRING_ID + source) * 4 + (cat & 3)
    let f = this.fnIds.get(key)
    if (f === undefined) {
      f = this.fnName.length
      this.fnName.push(name)
      this.fnSource.push(source)
      this.fnCat.push(cat > 2 ? 0 : cat)
      this.fnIds.set(key, f)
    }
    if (this.n === this.start.length) this.grow()
    const i = this.n++
    this.start[i] = startNs
    this.dur[i] = durNs
    this.fn[i] = f
    this.thread[i] = this.threadIndex(tid)
  }

  addAllocation(type: number, fn: number, size: number) {
    this.allocCount++
    this.allocBytes += size
    for (const [map, key] of [
      [this.allocByType, type],
      [this.allocByFunction, fn],
    ] as const) {
      const row = map.get(key)
      if (row) {
        row[0]++
        row[1] += size
      } else map.set(key, [1, size])
    }
  }

  setThreadName(tid: number, name: number) {
    this.threadNames.set(tid, name)
  }

  private grow() {
    const c = Math.ceil(this.start.length * 1.5)
    const copy = <T extends Float64Array | Uint32Array | Uint16Array>(a: T, next: T) => {
      next.set(a)
      return next
    }
    this.start = copy(this.start, new Float64Array(c))
    this.dur = copy(this.dur, new Float64Array(c))
    this.fn = copy(this.fn, new Uint32Array(c))
    this.thread = copy(this.thread, new Uint16Array(c))
  }

  allocRows(map: Map<number, [number, number]>): AllocRow[] {
    return [...map].map(([id, [count, bytes]]) => ({ name: this.strings[id] || '<unknown>', count, bytes })).sort((a, b) => b.bytes - a.bytes)
  }
}
