import { CATEGORIES, ProfileBuilder } from './build.ts'

interface TraceEvent {
  name?: string
  cat?: string
  ph?: string
  tid?: number
  ts?: number
  dur?: number
  args?: { module?: string; source?: string; function?: string; size?: number; name?: string }
  traceEvents?: TraceEvent[]
}

export async function parseJson(file: Blob, progress: (ratio: number) => void): Promise<ProfileBuilder> {
  const out = new ProfileBuilder(file.size / 260)
  out.intern('')
  const cats = new Map<string, number>(CATEGORIES.map((c, i) => [c, i]))

  const event = (e: TraceEvent) => {
    if (Array.isArray(e.traceEvents)) {
      for (const inner of e.traceEvents) event(inner)
      return
    }
    if (e.ph === 'X') {
      out.addSpan(
        out.intern(e.name ?? ''),
        out.intern(e.args?.module ?? e.args?.source ?? ''),
        cats.get(e.cat ?? '') ?? 0,
        e.tid ?? 0,
        Math.round((e.ts ?? 0) * 1000),
        Math.round((e.dur ?? 0) * 1000),
      )
    } else if (e.ph === 'i' && e.cat === 'alloc') {
      out.addAllocation(out.intern(e.name ?? ''), out.intern(e.args?.function ?? ''), e.args?.size ?? 0)
    } else if (e.ph === 'M' && e.name === 'thread_name') {
      out.setThreadName(e.tid ?? 0, out.intern(e.args?.name ?? ''))
    }
  }

  const line = (raw: string) => {
    let s = raw.trim()
    if (s.endsWith(',')) s = s.slice(0, -1)
    if (s[0] !== '{' || s[s.length - 1] !== '}') return
    let e: TraceEvent
    try {
      e = JSON.parse(s)
    } catch {
      throw new Error('This is not a SwiftlyS2 profile JSON: a line is not valid JSON.')
    }
    event(e)
  }

  const reader = file.stream().getReader()
  const dec = new TextDecoder()
  let rest = ''
  let read = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    read += value.length
    const text = rest + dec.decode(value, { stream: true })
    let from = 0
    for (let nl = text.indexOf('\n'); nl >= 0; nl = text.indexOf('\n', from)) {
      line(text.slice(from, nl))
      from = nl + 1
    }
    rest = text.slice(from)
    progress(read / file.size)
  }
  line(rest + dec.decode())
  return out
}
