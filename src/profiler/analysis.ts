import { CATEGORIES } from './build.ts'
import type { Profile } from './model.ts'

export interface Lane {
  key: string
  label: string
  start: Float64Array
  dur: Float64Array
  fn: ArrayLike<number>
  levels: Uint32Array[]
}

export interface Filter {
  search: string
  thread: number
  categories: boolean[]
  module: string
}

export const ALL_THREADS = -1
export const ALL_MODULES = ''

export function fmtTime(ns: number) {
  const a = Math.abs(ns)
  if (a >= 1e9) return `${(ns / 1e9).toFixed(a >= 1e11 ? 0 : a >= 1e10 ? 1 : 2)} s`
  if (a >= 1e6) return `${(ns / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)} ms`
  if (a >= 1e3) return `${(ns / 1e3).toFixed(a >= 1e5 ? 0 : a >= 1e4 ? 1 : 2)} µs`
  return `${Math.round(ns)} ns`
}

export const fmtBytes = (n: number) =>
  n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`

export const fmtCount = (n: number) => n.toLocaleString('en-US')

export const basename = (path: string) => path.split(/[\\/]/).pop() ?? path

export const fnName = (p: Profile, f: number) => p.strings[p.fnName[f]] || '<unknown>'
export const fnModule = (p: Profile, f: number) => basename(p.strings[p.fnSource[f]] ?? '')
export const fnCategory = (p: Profile, f: number) => CATEGORIES[p.fnCat[f]] ?? CATEGORIES[0]

export function shortName(name: string) {
  const parts = name.split('.')
  return parts.length > 2 ? parts.slice(-2).join('.') : name
}

export function threadLabel(p: Profile, index: number) {
  const t = p.tracks.find((x) => x.index === index)
  return t ? `${t.name || 'thread'} ${t.tid}` : `thread #${index}`
}

export function modules(p: Profile) {
  return [...new Set(Array.from(p.fnSource, (s) => basename(p.strings[s] ?? '')).filter(Boolean))].sort()
}

export function matchFns(p: Profile, f: Filter) {
  const q = f.search.trim().toLowerCase()
  const out = new Uint8Array(p.fnName.length)
  for (let i = 0; i < out.length; i++) {
    out[i] =
      f.categories[p.fnCat[i]] !== false &&
      (f.module === ALL_MODULES || fnModule(p, i) === f.module) &&
      (!q || fnName(p, i).toLowerCase().includes(q) || fnModule(p, i).toLowerCase().includes(q))
        ? 1
        : 0
  }
  return out
}

export const isFiltering = (f: Filter) => f.search.trim() !== '' || f.module !== ALL_MODULES || f.categories.some((c) => !c)

export function timelineLanes(p: Profile, thread: number): Lane[] {
  return p.tracks
    .filter((t) => thread === ALL_THREADS || t.index === thread)
    .map((t) => ({ key: `t${t.index}`, label: `${t.name || 'thread'} ${t.tid} · ${fmtCount(t.spans)} spans`, start: p.start, dur: p.dur, fn: p.fn, levels: t.levels }))
}

export interface Tree {
  fn: number[]
  parent: number[]
  total: number[]
  self: number[]
  calls: number[]
}

class TreeBuilder implements Tree {
  fn: number[] = []
  parent: number[] = []
  total: number[] = []
  self: number[] = []
  calls: number[] = []
  private ids = new Map<string, number>()

  add(parent: number, fn: number, total: number, self: number, calls: number) {
    const key = `${parent}:${fn}`
    let id = this.ids.get(key)
    if (id === undefined) {
      id = this.fn.length
      this.fn.push(fn)
      this.parent.push(parent)
      this.total.push(0)
      this.self.push(0)
      this.calls.push(0)
      this.ids.set(key, id)
    }
    this.total[id] += total
    this.self[id] += self
    this.calls[id] += calls
    return id
  }
}

const threadOk = (p: Profile, thread: number) => (node: number) => thread === ALL_THREADS || p.nodes.thread[node] === thread

export function callTree(p: Profile, thread: number): Tree {
  const { parent, fn, total, self, calls } = p.nodes
  const ok = threadOk(p, thread)
  const tb = new TreeBuilder()
  const map = new Int32Array(fn.length).fill(-1)
  for (let i = 0; i < fn.length; i++) {
    if (!ok(i)) continue
    map[i] = tb.add(parent[i] >= 0 ? map[parent[i]] : -1, fn[i], total[i], self[i], calls[i])
  }
  return tb
}

export function calleesTree(p: Profile, f: number, thread: number): Tree {
  const { parent, fn, total, self, calls } = p.nodes
  const ok = threadOk(p, thread)
  const tb = new TreeBuilder()
  const map = new Int32Array(fn.length).fill(-1)
  for (let i = 0; i < fn.length; i++) {
    if (!ok(i)) continue
    const pm = parent[i] >= 0 ? map[parent[i]] : -1
    if (pm >= 0) map[i] = tb.add(pm, fn[i], total[i], self[i], calls[i])
    else if (fn[i] === f) map[i] = tb.add(-1, f, total[i], self[i], calls[i])
  }
  return tb
}

export function callersTree(p: Profile, f: number, thread: number): Tree {
  const { parent, fn, total, self, calls } = p.nodes
  const ok = threadOk(p, thread)
  const tb = new TreeBuilder()
  const inside = new Uint8Array(fn.length)
  for (let i = 0; i < fn.length; i++) {
    const parentInside = parent[i] >= 0 && inside[parent[i]] === 1
    inside[i] = parentInside || fn[i] === f ? 1 : 0
    if (fn[i] !== f || parentInside || !ok(i)) continue
    let id = tb.add(-1, f, total[i], self[i], calls[i])
    for (let a = parent[i]; a >= 0; a = parent[a]) id = tb.add(id, fn[a], total[i], 0, calls[i])
  }
  return tb
}

export function treeLane(tree: Tree, key: string, label: string): { lane: Lane; extent: number } {
  const n = tree.fn.length
  const children: number[][] = Array.from({ length: n }, () => [])
  const roots: number[] = []
  for (let i = 0; i < n; i++) (tree.parent[i] >= 0 ? children[tree.parent[i]] : roots).push(i)
  const byTotal = (a: number, b: number) => tree.total[b] - tree.total[a]
  const start = new Float64Array(n)
  const dur = Float64Array.from(tree.total)
  const levels: number[][] = []
  const stack: [number, number, number][] = []
  let extent = 0
  for (const r of roots.sort(byTotal)) {
    stack.push([r, extent, 0])
    extent += tree.total[r]
  }
  while (stack.length) {
    const [node, x0, d] = stack.pop()!
    start[node] = x0
    ;(levels[d] ??= []).push(node)
    let cx = x0
    for (const c of children[node].sort(byTotal)) {
      stack.push([c, cx, d + 1])
      cx += tree.total[c]
    }
  }
  return {
    lane: {
      key,
      label,
      start,
      dur,
      fn: tree.fn,
      levels: levels.map((l) => Uint32Array.from(l).sort((a, b) => start[a] - start[b])),
    },
    extent,
  }
}

export interface Row {
  key: number
  label: string
  module: string
  category: string
  self: number
  total: number
  calls: number
  fn: number
}

export type GroupBy = 'function' | 'module' | 'thread'

export function rows(p: Profile, group: GroupBy, thread: number, match: Uint8Array | null): Row[] {
  const { parent, fn, total, self, calls } = p.nodes
  const ok = threadOk(p, thread)
  const moduleIds = new Map<string, number>()
  const keyOf = (node: number) => {
    if (group === 'function') return fn[node]
    if (group === 'thread') return p.nodes.thread[node]
    const m = fnModule(p, fn[node]) || '<no module>'
    let id = moduleIds.get(m)
    if (id === undefined) moduleIds.set(m, (id = moduleIds.size))
    return id
  }
  const out = new Map<number, Row>()
  for (let i = 0; i < fn.length; i++) {
    if (!ok(i) || (match && !match[fn[i]])) continue
    const key = keyOf(i)
    let row = out.get(key)
    if (!row) {
      const f = fn[i]
      row = {
        key,
        fn: group === 'function' ? f : -1,
        label: group === 'function' ? fnName(p, f) : group === 'thread' ? threadLabel(p, key) : fnModule(p, f) || '<no module>',
        module: group === 'function' ? fnModule(p, f) : '',
        category: group === 'function' ? fnCategory(p, f) : '',
        self: 0,
        total: 0,
        calls: 0,
      }
      out.set(key, row)
    }
    row.self += self[i]
    row.calls += calls[i]
    let nested = false
    for (let a = parent[i]; a >= 0; a = parent[a]) {
      if (keyOf(a) === key) {
        nested = true
        break
      }
    }
    if (!nested) row.total += total[i]
  }
  return [...out.values()]
}

export function busyTime(p: Profile, thread: number) {
  let sum = 0
  for (let i = 0; i < p.nodes.fn.length; i++) if (p.nodes.parent[i] < 0 && (thread === ALL_THREADS || p.nodes.thread[i] === thread)) sum += p.nodes.total[i]
  return sum
}

export function firstEndingAfter(lane: Lane, level: Uint32Array, t: number) {
  let lo = 0
  let hi = level.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const i = level[mid]
    if (lane.start[i] + lane.dur[i] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function firstStartingAt(lane: Lane, level: Uint32Array, t: number, from = 0) {
  let lo = from
  let hi = level.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lane.start[level[mid]] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function depthOf(lane: Lane, span: number) {
  const s = lane.start[span]
  for (let d = 0; d < lane.levels.length; d++) {
    const level = lane.levels[d]
    for (let k = firstStartingAt(lane, level, s); k < level.length && lane.start[level[k]] === s; k++) if (level[k] === span) return d
  }
  return -1
}

export function spanAt(lane: Lane, depth: number, t: number, tolerance: number) {
  const level = lane.levels[depth]
  if (!level) return -1
  const k = firstEndingAfter(lane, level, t - tolerance)
  const i = level[k]
  if (i === undefined || lane.start[i] > t + tolerance) return -1
  return i
}

export function selfTime(lane: Lane, depth: number, i: number) {
  const level = lane.levels[depth + 1]
  const s = lane.start[i]
  const e = s + lane.dur[i]
  let child = 0
  if (level) for (let k = firstStartingAt(lane, level, s); k < level.length && lane.start[level[k]] < e; k++) child += lane.dur[level[k]]
  return lane.dur[i] - child
}

export interface RangeRow {
  fn: number
  wall: number
  count: number
}

export function rangeSummary(lanes: Lane[], t0: number, t1: number) {
  const out = new Map<number, RangeRow>()
  let spans = 0
  for (const lane of lanes) {
    for (const level of lane.levels) {
      for (let k = firstEndingAfter(lane, level, t0); k < level.length; k++) {
        const i = level[k]
        const s = lane.start[i]
        if (s >= t1) break
        const f = lane.fn[i]
        const wall = Math.min(s + lane.dur[i], t1) - Math.max(s, t0)
        let row = out.get(f)
        if (!row) out.set(f, (row = { fn: f, wall: 0, count: 0 }))
        row.wall += wall
        row.count++
        spans++
      }
    }
  }
  return { rows: [...out.values()].sort((a, b) => b.wall - a.wall), spans }
}
