import type { AllocRow, ProfileBuilder } from './build.ts'

export interface Track {
  index: number
  tid: number
  name: string
  spans: number
  levels: Uint32Array[]
}

export interface CallNodes {
  parent: Int32Array
  fn: Uint32Array
  thread: Uint16Array
  total: Float64Array
  self: Float64Array
  calls: Uint32Array
  recursive: Uint8Array
}

export interface Profile {
  strings: string[]
  fnName: Uint32Array
  fnSource: Uint32Array
  fnCat: Uint8Array
  start: Float64Array
  dur: Float64Array
  fn: Uint32Array
  tracks: Track[]
  duration: number
  nodes: CallNodes
  allocations: { count: number; bytes: number; byType: AllocRow[]; byFunction: AllocRow[] }
}

const MAX_DEPTH = 0xffff

export function buildModel(b: ProfileBuilder): Profile {
  const n = b.n
  const start = b.start.subarray(0, n)
  const dur = b.dur.subarray(0, n)
  const fn = b.fn.subarray(0, n)
  const thread = b.thread.subarray(0, n)
  const T = b.tids.length
  const F = b.fnName.length

  let t0 = Infinity
  let t1 = -Infinity
  for (let i = 0; i < n; i++) {
    if (start[i] < t0) t0 = start[i]
    const e = start[i] + dur[i]
    if (e > t1) t1 = e
  }
  if (n === 0) t0 = t1 = 0
  for (let i = 0; i < n; i++) start[i] -= t0

  const offsets = new Uint32Array(T + 1)
  for (let i = 0; i < n; i++) offsets[thread[i] + 1]++
  for (let t = 0; t < T; t++) offsets[t + 1] += offsets[t]
  const order = new Uint32Array(n)
  const fill = offsets.slice(0, T)
  for (let i = 0; i < n; i++) order[fill[thread[i]]++] = i

  const parent: number[] = []
  const nodeFn: number[] = []
  const nodeThread: number[] = []
  const total: number[] = []
  const self: number[] = []
  const calls: number[] = []
  const recursive: number[] = []
  const nodeIds = new Map<number, number>()
  const nodeOf = (pn: number, t: number, f: number) => {
    const key = (pn >= 0 ? pn + T : t) * F + f
    let id = nodeIds.get(key)
    if (id === undefined) {
      id = parent.length
      parent.push(pn)
      nodeFn.push(f)
      nodeThread.push(t)
      total.push(0)
      self.push(0)
      calls.push(0)
      let rec = 0
      for (let a = pn; a >= 0; a = parent[a]) {
        if (nodeFn[a] === f) {
          rec = 1
          break
        }
      }
      recursive.push(rec)
      nodeIds.set(key, id)
    }
    return id
  }

  const depth = new Uint16Array(n)
  const spanNode = new Uint32Array(n)
  const stack = new Uint32Array(MAX_DEPTH)
  const tracks: Track[] = []

  for (let t = 0; t < T; t++) {
    const sub = order.subarray(offsets[t], offsets[t + 1])
    sub.sort((a, c) => start[a] - start[c] || dur[c] - dur[a] || c - a)

    let sp = 0
    let maxDepth = 0
    for (let k = 0; k < sub.length; k++) {
      const i = sub[k]
      const s = start[i]
      while (sp > 0 && s >= start[stack[sp - 1]] + dur[stack[sp - 1]]) sp--
      if (sp === MAX_DEPTH) throw new Error('A thread nests calls deeper than 65535 levels.')
      const p = sp > 0 ? stack[sp - 1] : -1
      const pn = p >= 0 ? spanNode[p] : -1
      const node = nodeOf(pn, t, fn[i])
      spanNode[i] = node
      depth[i] = sp
      if (sp > maxDepth) maxDepth = sp
      total[node] += dur[i]
      self[node] += dur[i]
      calls[node]++
      if (pn >= 0) self[pn] -= dur[i]
      stack[sp++] = i
    }

    const levelCounts = new Uint32Array(maxDepth + 2)
    for (let k = 0; k < sub.length; k++) levelCounts[depth[sub[k]] + 1]++
    for (let d = 0; d <= maxDepth; d++) levelCounts[d + 1] += levelCounts[d]
    const packed = new Uint32Array(sub.length)
    const at = levelCounts.slice(0, maxDepth + 1)
    for (let k = 0; k < sub.length; k++) packed[at[depth[sub[k]]]++] = sub[k]
    const levels: Uint32Array[] = []
    if (sub.length > 0) for (let d = 0; d <= maxDepth; d++) levels.push(packed.subarray(levelCounts[d], levelCounts[d + 1]))

    const tid = b.tids[t]
    const nameId = b.threadNames.get(tid)
    tracks.push({ index: t, tid, name: nameId === undefined ? '' : b.strings[nameId] ?? '', spans: sub.length, levels })
  }

  return {
    strings: b.strings,
    fnName: Uint32Array.from(b.fnName),
    fnSource: Uint32Array.from(b.fnSource),
    fnCat: Uint8Array.from(b.fnCat),
    start,
    dur,
    fn,
    tracks: tracks.sort((x, y) => y.spans - x.spans),
    duration: t1 - t0,
    nodes: {
      parent: Int32Array.from(parent),
      fn: Uint32Array.from(nodeFn),
      thread: Uint16Array.from(nodeThread),
      total: Float64Array.from(total),
      self: Float64Array.from(self),
      calls: Uint32Array.from(calls),
      recursive: Uint8Array.from(recursive),
    },
    allocations: { count: b.allocCount, bytes: b.allocBytes, byType: b.allocRows(b.allocByType), byFunction: b.allocRows(b.allocByFunction) },
  }
}

export function transferables(p: Profile): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>()
  const add = (a: { buffer: ArrayBufferLike }) => {
    if (a.buffer instanceof ArrayBuffer) set.add(a.buffer)
  }
  for (const a of [p.fnName, p.fnSource, p.fnCat, p.start, p.dur, p.fn]) add(a)
  for (const a of Object.values(p.nodes)) add(a)
  for (const t of p.tracks) for (const l of t.levels) add(l)
  return [...set]
}
