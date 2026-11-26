import { useEffect, useRef, useState } from 'react'
import { depthOf, firstEndingAfter, firstStartingAt, fmtTime, fnModule, fnName, spanAt, type Lane } from './analysis.ts'
import type { Profile } from './model.ts'

const ROW = 18
const HEADER = 22
const RULER = 22
const GAP = 6
const MIN_SPAN = 50

export interface Pick {
  lane: number
  span: number
}

interface Props {
  profile: Profile
  lanes: Lane[]
  extent: number
  match: Uint8Array | null
  selected: Pick | null
  onSelect: (pick: Pick | null) => void
  range?: [number, number] | null
  onRange?: (range: [number, number] | null, final: boolean) => void
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function colors(p: Profile) {
  return Array.from(p.fnName, (_, f) => {
    const h = hash(fnName(p, f))
    return `hsl(${h % 360} ${45 + ((h >>> 9) % 20)}% ${52 + ((h >>> 17) % 14)}%)`
  })
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow
}

export function FlameCanvas({ profile, lanes, extent, match, selected, onSelect, range = null, onRange }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [view, setView] = useState<[number, number]>([0, Math.max(extent, MIN_SPAN)])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number; pick: Pick } | null>(null)
  const [palette] = useState(() => colors(profile))

  const laneRows = lanes.map((lane) => (collapsed.has(lane.key) ? 0 : lane.levels.length))
  const laneTops = laneRows.map((_, i) => RULER + laneRows.slice(0, i).reduce((sum, r) => sum + HEADER + r * ROW + GAP, 0))
  const layout = {
    lanes: laneRows.map((rows, i) => ({ top: laneTops[i], rows })),
    height: RULER + laneRows.reduce((sum, r) => sum + HEADER + r * ROW + GAP, 0),
  }

  const clamp = ([a, b]: [number, number]): [number, number] => {
    const full = Math.max(extent, MIN_SPAN)
    let w = Math.min(Math.max(b - a, MIN_SPAN), full)
    if (!Number.isFinite(w)) w = full
    const s = Math.min(Math.max(a, 0), full - w)
    return [s, s + w]
  }

  const zoomAt = (factor: number, anchor: number) => {
    setView(([a, b]) => clamp([anchor - (anchor - a) * factor, anchor + (b - anchor) * factor]))
  }

  const timeAt = (x: number) => {
    const [a, b] = view
    return a + (x / Math.max(width, 1)) * (b - a)
  }

  const hit = (x: number, y: number): { header: number } | { pick: Pick } | null => {
    for (let li = 0; li < lanes.length; li++) {
      const { top, rows } = layout.lanes[li]
      if (y < top || y >= top + HEADER + rows * ROW) continue
      if (y < top + HEADER) return { header: li }
      const depth = Math.floor((y - top - HEADER) / ROW)
      const [a, b] = view
      const span = spanAt(lanes[li], depth, timeAt(x), (2 * (b - a)) / Math.max(width, 1))
      return span >= 0 ? { pick: { lane: li, span } } : null
    }
    return null
  }

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomAt(Math.exp(e.deltaY * 0.01), timeAt(e.clientX - rect.left))
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        const d = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX
        setView(([a, b]) => clamp([a + (d / Math.max(width, 1)) * (b - a), b + (d / Math.max(width, 1)) * (b - a)]))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  useEffect(() => {
    const el = canvas.current
    if (!el || width === 0) return
    const dpr = window.devicePixelRatio || 1
    el.width = Math.round(width * dpr)
    el.height = Math.round(layout.height * dpr)
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, layout.height)
    ctx.font = '11px "Geist Mono Variable", ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    const charW = ctx.measureText('M').width
    const [v0, v1] = view
    const scale = width / (v1 - v0)

    const step = niceStep((v1 - v0) / Math.max(1, width / 110))
    ctx.fillStyle = '#71717a'
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    for (let t = Math.ceil(v0 / step) * step; t < v1; t += step) {
      const x = Math.round((t - v0) * scale) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, RULER - 6)
      ctx.lineTo(x, layout.height)
      ctx.stroke()
      ctx.fillText(fmtTime(t), x + 4, RULER / 2)
    }

    lanes.forEach((lane, li) => {
      const { top, rows } = layout.lanes[li]
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      ctx.fillRect(0, top, width, HEADER)
      ctx.fillStyle = '#a1a1aa'
      ctx.fillText(`${collapsed.has(lane.key) ? '▸' : '▾'} ${lane.label}`, 8, top + HEADER / 2)
      for (let d = 0; d < rows; d++) {
        const level = lane.levels[d]
        const y = top + HEADER + d * ROW
        let k = firstEndingAfter(lane, level, v0)
        while (k < level.length) {
          const i = level[k]
          const s = lane.start[i]
          if (s >= v1) break
          const f = lane.fn[i]
          const x0 = (s - v0) * scale
          const x1 = (s + lane.dur[i] - v0) * scale
          const dim = match !== null && !match[f]
          if (x1 - x0 < 1) {
            const px = Math.floor(x0)
            ctx.fillStyle = dim ? '#1f2023' : palette[f]
            ctx.fillRect(px, y, 1, ROW - 1)
            k = firstStartingAt(lane, level, v0 + (px + 1) / scale, k + 1)
            continue
          }
          const left = Math.max(x0, -1)
          const w = Math.min(x1, width + 1) - left
          ctx.fillStyle = dim ? '#1f2023' : palette[f]
          ctx.fillRect(left, y, Math.max(w - 0.5, 0.5), ROW - 1)
          const chars = Math.floor((w - 8) / charW)
          if (chars >= 3) {
            const name = fnName(profile, f)
            ctx.fillStyle = dim ? '#52525b' : '#0a0a0b'
            ctx.fillText(name.length > chars ? `${name.slice(0, chars - 1)}…` : name, left + 4, y + ROW / 2)
          }
          k++
        }
      }
    })

    if (selected && lanes[selected.lane]) {
      const lane = lanes[selected.lane]
      const { top } = layout.lanes[selected.lane]
      const depth = depthOf(lane, selected.span)
      if (depth >= 0 && depth < layout.lanes[selected.lane].rows) {
        const x0 = (lane.start[selected.span] - v0) * scale
        const x1 = (lane.start[selected.span] + lane.dur[selected.span] - v0) * scale
        ctx.strokeStyle = '#00feed'
        ctx.lineWidth = 2
        ctx.strokeRect(Math.max(x0, 0) + 1, top + HEADER + depth * ROW + 1, Math.max(Math.min(x1, width) - Math.max(x0, 0) - 2, 2), ROW - 3)
        ctx.lineWidth = 1
      }
    }

    if (range) {
      const x0 = (Math.min(...range) - v0) * scale
      const x1 = (Math.max(...range) - v0) * scale
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, RULER, Math.max(x0, 0), layout.height)
      ctx.fillRect(Math.min(x1, width), RULER, width, layout.height)
      ctx.fillStyle = 'rgba(0,254,237,0.08)'
      ctx.fillRect(x0, 0, x1 - x0, RULER)
      ctx.fillStyle = '#00feed'
      ctx.fillRect(x0, 0, 1, layout.height)
      ctx.fillRect(x1 - 1, 0, 1, layout.height)
    }
  })

  const drag = useRef<{ x: number; view: [number, number]; moved: boolean; range: [number, number] | null } | null>(null)

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { x: e.clientX - rect.left, view, moved: false, range: null }
    const move = (ev: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const x = ev.clientX - rect.left
      if (!d.moved && Math.abs(x - d.x) < 3) return
      d.moved = true
      if (onRange) {
        const [a, b] = d.view
        const t = (px: number) => a + (Math.min(Math.max(px, 0), width) / width) * (b - a)
        d.range = [Math.min(t(d.x), t(x)), Math.max(t(d.x), t(x))]
        onRange(d.range, false)
      } else {
        const [a, b] = d.view
        const dt = ((d.x - x) / width) * (b - a)
        setView(clamp([a + dt, b + dt]))
      }
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = drag.current
      drag.current = null
      if (d?.moved && d.range) onRange?.(d.range, true)
      if (!d || d.moved) return
      const h = hit(ev.clientX - rect.left, ev.clientY - rect.top)
      if (h && 'header' in h) {
        const key = lanes[h.header].key
        setCollapsed((c) => {
          const next = new Set(c)
          if (!next.delete(key)) next.add(key)
          return next
        })
      } else {
        onSelect(h ? h.pick : null)
        if (!h) onRange?.(null, true)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const focus = (a: number, b: number) => {
    const pad = (b - a) * 0.05
    setView(clamp([a - pad, b + pad]))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const [a, b] = view
    const k = e.key.toLowerCase()
    if (k === 'w') zoomAt(0.8, (a + b) / 2)
    else if (k === 's') zoomAt(1.25, (a + b) / 2)
    else if (k === 'a') setView(clamp([a - (b - a) * 0.15, b - (b - a) * 0.15]))
    else if (k === 'd') setView(clamp([a + (b - a) * 0.15, b + (b - a) * 0.15]))
    else if (k === 'f') {
      if (range) focus(Math.min(...range), Math.max(...range))
      else if (selected && lanes[selected.lane]) focus(lanes[selected.lane].start[selected.span], lanes[selected.lane].start[selected.span] + lanes[selected.lane].dur[selected.span])
    } else if (k === '0') setView(clamp([0, extent]))
    else if (k === 'escape') {
      onSelect(null)
      onRange?.(null, true)
    } else return
    e.preventDefault()
  }

  const hovered = hover && lanes[hover.pick.lane]
  return (
    <div ref={wrap} className="relative h-full overflow-y-auto overflow-x-hidden">
      <canvas
        ref={canvas}
        tabIndex={0}
        role="img"
        aria-label="flame chart"
        className="block cursor-crosshair outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
        style={{ width, height: layout.height }}
        onMouseDown={onMouseDown}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const h = hit(e.clientX - rect.left, e.clientY - rect.top)
          if (h && 'pick' in h) {
            const lane = lanes[h.pick.lane]
            focus(lane.start[h.pick.span], lane.start[h.pick.span] + lane.dur[h.pick.span])
          }
        }}
        onMouseMove={(e) => {
          if (drag.current) return
          const rect = e.currentTarget.getBoundingClientRect()
          const h = hit(e.clientX - rect.left, e.clientY - rect.top)
          setHover(h && 'pick' in h ? { x: e.clientX - rect.left, y: e.clientY - rect.top, pick: h.pick } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      />
      {hover && hovered && (
        <div
          className="pointer-events-none absolute z-10 max-w-md rounded-lg border border-white/10 bg-zinc-950/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(hover.x + 12, Math.max(width - 300, 0)), top: hover.y + 14 }}
        >
          <div className="break-all text-zinc-200">{fnName(profile, hovered.fn[hover.pick.span])}</div>
          <div className="mt-0.5 text-zinc-500">
            {fmtTime(hovered.dur[hover.pick.span])}
            {fnModule(profile, hovered.fn[hover.pick.span]) && ` · ${fnModule(profile, hovered.fn[hover.pick.span])}`}
          </div>
        </div>
      )}
    </div>
  )
}
