import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileDrop } from '../FileDrop.tsx'
import { bar, errorLine, statusBar, th } from '../ui.ts'
import {
  ALL_MODULES,
  ALL_THREADS,
  busyTime,
  callersTree,
  calleesTree,
  callTree,
  depthOf,
  fmtBytes,
  fmtCount,
  fmtTime,
  fnCategory,
  fnModule,
  fnName,
  isFiltering,
  matchFns,
  modules,
  rangeSummary,
  rows,
  selfTime,
  threadLabel,
  timelineLanes,
  treeLane,
  type Filter,
  type GroupBy,
  type Lane,
  type Row,
} from './analysis.ts'
import { CATEGORIES, type AllocRow } from './build.ts'
import { FlameCanvas, type Pick } from './FlameCanvas.tsx'
import type { Profile } from './model.ts'
import { SortHeader } from './sort.tsx'
import { sorted, useSort } from './sorting.ts'
import type { WorkerMessage } from './worker.ts'

const control = 'h-7 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-200 outline-none focus:border-accent/60'
const pane = 'h-64 shrink-0 border-t border-white/10'

const CANVAS_KEYS = 'ctrl+wheel or W/S zoom · A/D or shift+wheel pan · dbl-click zooms to a span · F focus · 0 reset · Esc clear'

type Tab = 'top' | 'timeline' | 'flame' | 'sandwich' | 'allocations'

const TAB_INFO: Record<Tab, { label: string; hint: string }> = {
  top: { label: 'top functions', hint: 'click a row to open it in sandwich · click a column header to sort' },
  timeline: { label: 'timeline', hint: `drag to select a range · click a thread header to collapse it · ${CANVAS_KEYS}` },
  flame: { label: 'flame graph', hint: `merged call stacks, heaviest on the left · drag to pan · ${CANVAS_KEYS}` },
  sandwich: { label: 'sandwich', hint: `pick a function: callers above, callees below · drag to pan · ${CANVAS_KEYS}` },
  allocations: { label: 'allocations', hint: 'allocated bytes by type and by allocating function' },
}

export function ProfilerAnalyzer() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState<{ stage: string; ratio: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])

  function load(file: File) {
    worker.current?.terminate()
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setError(null)
    setProgress({ stage: 'reading', ratio: 0 })
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data
      if (m.type === 'progress') setProgress({ stage: m.stage, ratio: m.ratio })
      else {
        w.terminate()
        worker.current = null
        setProgress(null)
        if (m.type === 'error') setError(m.message)
        else {
          setProfile(m.profile)
          setFileName(file.name)
        }
      }
    }
    w.onerror = (e) => {
      w.terminate()
      worker.current = null
      setProgress(null)
      setError(e.message || 'The profile could not be read. It may be too large for this browser.')
    }
    w.postMessage(file)
  }

  const status = (
    <>
      {progress && <Progress {...progress} />}
      {error && <p className={errorLine}>{error}</p>}
    </>
  )

  if (!profile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {status}
        <div className="flex min-h-0 flex-1 p-4">
          <FileDrop accept=".pb,.json,application/json,application/octet-stream" onFile={load} className="flex-1 flex-col justify-center gap-2 px-6 text-center">
            <span className="text-sm text-zinc-300">
              drop a SwiftlyS2 profile <span className="text-accent">.pb</span> or <span className="text-accent">.json</span> here, or click to choose one
            </span>
          </FileDrop>
        </div>
      </div>
    )
  }

  return <Workspace key={fileName + profile.start.length} profile={profile} fileName={fileName} onFile={load} status={status} />
}

function Progress({ stage, ratio }: { stage: string; ratio: number }) {
  return (
    <div className="shrink-0 border-b border-white/10 px-3 py-1.5">
      <div className="flex justify-between text-[11px] text-zinc-500">
        <span>{stage}…</span>
        <span className="tabular-nums">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

function Workspace({ profile, fileName, onFile, status }: { profile: Profile; fileName: string; onFile: (f: File) => void; status: ReactNode }) {
  const [tab, setTab] = useState<Tab>('top')
  const [filter, setFilter] = useState<Filter>({ search: '', thread: ALL_THREADS, categories: CATEGORIES.map(() => true), module: ALL_MODULES })
  const [sandwichFn, setSandwichFn] = useState<number | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const match = isFiltering(filter) ? matchFns(profile, filter) : null
  const tabs = (Object.keys(TAB_INFO) as Tab[]).filter((t) => t !== 'allocations' || profile.allocations.count > 0)

  const openSandwich = (f: number) => {
    setSandwichFn(f)
    setTab('sandwich')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === '/') {
        e.preventDefault()
        search.current?.focus()
        return
      }
      const t = tabs[Number(e.key) - 1]
      if (t) setTab(t)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`${bar} flex-wrap gap-y-2 py-2`}>
        <FileDrop accept=".pb,.json,application/json,application/octet-stream" onFile={onFile} className="max-w-72 px-2.5 py-1">
          <span className="truncate text-zinc-300" title={`${fileName} · drop or click to open another profile`}>
            {fileName}
          </span>
        </FileDrop>
        <span className="flex flex-wrap gap-x-3 text-zinc-500">
          <Stat value={fmtTime(profile.duration)} name="duration" />
          <Stat value={fmtTime(busyTime(profile, ALL_THREADS))} name="busy" />
          <Stat value={fmtCount(profile.start.length)} name="spans" />
          <Stat value={fmtCount(profile.tracks.length)} name="threads" />
          <Stat value={fmtCount(profile.fnName.length)} name="functions" />
        </span>
      </div>
      {status}

      <div className={`${bar} flex-wrap gap-y-1.5 py-1 sm:py-0`}>
      <div role="tablist" className="flex shrink-0 overflow-x-auto">
        {tabs.map((id, i) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 py-2 transition-colors ${
              tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {TAB_INFO[id].label}
            <kbd className="rounded border border-white/10 px-1 text-[10px] leading-4 text-zinc-600">{i + 1}</kbd>
          </button>
        ))}
      </div>
        <Filters profile={profile} filter={filter} onChange={setFilter} search={search} />
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'top' && <TopFunctions profile={profile} filter={filter} match={match} onOpen={openSandwich} />}
        {tab === 'timeline' && <Timeline key={filter.thread} profile={profile} thread={filter.thread} match={match} onOpen={openSandwich} />}
        {tab === 'flame' && <LeftHeavy key={filter.thread} profile={profile} thread={filter.thread} match={match} onOpen={openSandwich} />}
        {tab === 'sandwich' && <Sandwich profile={profile} filter={filter} match={match} selected={sandwichFn} onSelect={setSandwichFn} />}
        {tab === 'allocations' && <Allocations profile={profile} />}
      </div>

      <div className={statusBar}>
        <span className="truncate">{TAB_INFO[tab].hint}</span>
        <span className="ml-auto hidden shrink-0 sm:inline">/ search · 1–{tabs.length} switch view</span>
      </div>
    </div>
  )
}

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="tabular-nums text-zinc-200">{value}</span> {name}
    </span>
  )
}

function Filters({ profile, filter, onChange, search }: { profile: Profile; filter: Filter; onChange: (f: Filter) => void; search: React.RefObject<HTMLInputElement | null> }) {
  return (
    <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:py-1.5">
      <input
        ref={search}
        type="search"
        placeholder="search  /"
        aria-label="search functions or modules"
        value={filter.search}
        onChange={(e) => onChange({ ...filter, search: e.target.value })}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        className={`${control} w-full min-w-0 sm:w-64`}
      />
      <select aria-label="thread" value={filter.thread} onChange={(e) => onChange({ ...filter, thread: Number(e.target.value) })} className={`${control} max-w-48`}>
        <option value={ALL_THREADS}>all threads</option>
        {profile.tracks.map((t) => (
          <option key={t.index} value={t.index}>
            {threadLabel(profile, t.index)}
          </option>
        ))}
      </select>
      <select aria-label="module" value={filter.module} onChange={(e) => onChange({ ...filter, module: e.target.value })} className={`${control} max-w-48`}>
        <option value={ALL_MODULES}>all modules</option>
        {modules(profile).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {CATEGORIES.map((c, i) => (
          <button
            key={c}
            aria-pressed={filter.categories[i]}
            onClick={() => onChange({ ...filter, categories: filter.categories.map((v, j) => (j === i ? !v : v)) })}
            className={`h-7 cursor-pointer border-l border-white/10 px-2 text-xs transition-colors first:border-l-0 ${
              filter.categories[i] ? 'bg-accent/10 text-accent' : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}

type TopKey = 'label' | 'module' | 'category' | 'self' | 'total' | 'calls' | 'avg'

const topValue = (r: Row, key: TopKey) => (key === 'avg' ? r.total / Math.max(r.calls, 1) : r[key])

function TopFunctions({ profile, filter, match, onOpen }: { profile: Profile; filter: Filter; match: Uint8Array | null; onOpen: (f: number) => void }) {
  const [group, setGroup] = useState<GroupBy>('function')
  const [chosen, toggle] = useSort<TopKey>({ key: 'self', dir: 'desc' }, ['label', 'module', 'category'])
  const byFunction = group === 'function'
  const sort = byFunction || (chosen.key !== 'module' && chosen.key !== 'category') ? chosen : { key: 'self' as const, dir: 'desc' as const }
  const busy = busyTime(profile, filter.thread)
  const list = sorted(rows(profile, group, filter.thread, match), sort, topValue)
  const header = (id: TopKey, text: string, align: 'left' | 'right' = 'right', className = 'w-px') => (
    <SortHeader id={id} sort={sort} onSort={toggle} align={align} className={className}>
      {text}
    </SortHeader>
  )

  return (
    <div className="flex h-full flex-col">
      <div className={`${bar} py-1.5`}>
        <span className="text-zinc-600">group by</span>
        <div className="flex overflow-hidden rounded-md border border-white/10">
          {(['function', 'module', 'thread'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              aria-pressed={group === g}
              className={`cursor-pointer border-l border-white/10 px-2 py-0.5 first:border-l-0 ${group === g ? 'bg-accent/10 text-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {g}
            </button>
          ))}
        </div>
        <span className="ml-auto text-zinc-600">
          {fmtCount(list.length)} rows · % of {fmtTime(busy)} busy
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead>
            <tr>
              <th className={`${th} w-12 text-right`}>#</th>
              {header('label', group, 'left', '')}
              {byFunction && header('module', 'module', 'left')}
              {byFunction && header('category', 'category', 'left')}
              {header('self', 'self')}
              {header('self', 'self %', 'left', 'w-32')}
              {header('total', 'total')}
              {header('total', 'total %', 'left', 'w-32')}
              {header('calls', 'calls')}
              {header('avg', 'avg / call')}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-zinc-600">
                  nothing matches the filters
                </td>
              </tr>
            )}
            {list.map((r, i) => (
              <tr
                key={r.key}
                onClick={r.fn >= 0 ? () => onOpen(r.fn) : undefined}
                className={`border-b border-white/[0.04] ${r.fn >= 0 ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
              >
                <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{i + 1}</td>
                <td className="max-w-0 truncate px-2 py-1 text-zinc-200" title={r.label}>
                  {r.label}
                </td>
                {byFunction && <td className="whitespace-nowrap px-2 py-1 text-zinc-500">{r.module || '—'}</td>}
                {byFunction && <td className="whitespace-nowrap px-2 py-1 text-zinc-600">{r.category}</td>}
                <Num value={fmtTime(r.self)} strong={sort.key === 'self'} />
                <Pct value={r.self / busy} />
                <Num value={fmtTime(r.total)} strong={sort.key === 'total'} />
                <Pct value={r.total / busy} />
                <Num value={fmtCount(r.calls)} strong={sort.key === 'calls'} />
                <Num value={fmtTime(r.total / Math.max(r.calls, 1))} strong={sort.key === 'avg'} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Num({ value, strong }: { value: string; strong?: boolean }) {
  return <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${strong ? 'text-zinc-100' : 'text-zinc-400'}`}>{value}</td>
}

function Pct({ value }: { value: number }) {
  const v = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0
  return (
    <td className="px-2 py-1">
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-sm bg-white/[0.06]">
          <div className="h-full bg-accent/70" style={{ width: `${v * 100}%` }} />
        </div>
        <span className="tabular-nums text-zinc-500">{(v * 100).toFixed(1)}%</span>
      </div>
    </td>
  )
}

function Split({ main, detail, size = pane }: { main: ReactNode; detail: ReactNode; size?: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{main}</div>
      {detail && <div className={size}>{detail}</div>}
    </div>
  )
}

function Timeline({ profile, thread, match, onOpen }: { profile: Profile; thread: number; match: Uint8Array | null; onOpen: (f: number) => void }) {
  const lanes = timelineLanes(profile, thread)
  const [selected, setSelected] = useState<Pick | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [summary, setSummary] = useState<[number, number] | null>(null)
  return (
    <Split
      main={
        <FlameCanvas
          profile={profile}
          lanes={lanes}
          extent={profile.duration}
          match={match}
          selected={selected}
          onSelect={setSelected}
          range={range}
          onRange={(r, final) => {
            setRange(r)
            if (final) setSummary(r)
          }}
        />
      }
      detail={
        range
          ? summary && <RangeDetails profile={profile} lanes={lanes} range={summary} onOpen={onOpen} />
          : selected && <SpanDetails profile={profile} lane={lanes[selected.lane]} span={selected.span} onOpen={onOpen} />
      }
      size={range ? 'h-80 shrink-0 border-t border-white/10' : pane}
    />
  )
}

function SpanDetails({ profile, lane, span, onOpen }: { profile: Profile; lane: Lane; span: number; onOpen: (f: number) => void }) {
  const f = lane.fn[span]
  const depth = depthOf(lane, span)
  return (
    <Details title={fnName(profile, f)} action={<OpenButton onClick={() => onOpen(f)} />}>
      <Field name="duration" value={fmtTime(lane.dur[span])} />
      <Field name="self time" value={fmtTime(selfTime(lane, depth, span))} />
      <Field name="start" value={fmtTime(lane.start[span])} />
      <Field name="end" value={fmtTime(lane.start[span] + lane.dur[span])} />
      <Field name="depth" value={String(depth)} />
      <Field name="thread" value={lane.label.split(' · ')[0]} />
      <Field name="module" value={fnModule(profile, f) || 'none'} />
      <Field name="category" value={fnCategory(profile, f)} />
    </Details>
  )
}

type RangeKey = 'function' | 'category' | 'wall' | 'count' | 'avg'

function RangeDetails({ profile, lanes, range, onOpen }: { profile: Profile; lanes: Lane[]; range: [number, number]; onOpen: (f: number) => void }) {
  const [t0, t1] = range
  const { rows: summary, spans } = rangeSummary(lanes, t0, t1)
  const [sort, toggle] = useSort<RangeKey>({ key: 'wall', dir: 'desc' }, ['function', 'category'])
  const list = sorted(summary, sort, (r, key) =>
    key === 'function' ? fnName(profile, r.fn) : key === 'category' ? fnCategory(profile, r.fn) : key === 'avg' ? r.wall / r.count : r[key],
  )
  return (
    <div className="flex h-full flex-col">
      <div className={`${bar} bg-white/[0.02] py-1.5`}>
        <span className="text-zinc-200">selected range · {fmtTime(t1 - t0)}</span>
        <span className="truncate text-zinc-500">
          {fmtTime(t0)} → {fmtTime(t1)} · {fmtCount(spans)} spans · {fmtCount(list.length)} functions
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <SortHeader id="function" sort={sort} onSort={toggle} align="left">
                function
              </SortHeader>
              <SortHeader id="category" sort={sort} onSort={toggle} align="left" className="w-px">
                category
              </SortHeader>
              <SortHeader id="wall" sort={sort} onSort={toggle} className="w-px">
                wall time
              </SortHeader>
              <SortHeader id="count" sort={sort} onSort={toggle} className="w-px">
                occurrences
              </SortHeader>
              <SortHeader id="avg" sort={sort} onSort={toggle} className="w-px">
                avg
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 500).map((r) => (
              <tr key={r.fn} onClick={() => onOpen(r.fn)} className="cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.04]">
                <td className="max-w-0 truncate px-2 py-1 text-zinc-200" title={fnName(profile, r.fn)}>
                  {fnName(profile, r.fn)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-zinc-600">{fnCategory(profile, r.fn)}</td>
                <Num value={fmtTime(r.wall)} strong={sort.key === 'wall'} />
                <Num value={fmtCount(r.count)} strong={sort.key === 'count'} />
                <Num value={fmtTime(r.wall / r.count)} strong={sort.key === 'avg'} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LeftHeavy({ profile, thread, match, onOpen }: { profile: Profile; thread: number; match: Uint8Array | null; onOpen: (f: number) => void }) {
  const { lane, extent } = treeLane(callTree(profile, thread), 'tree', thread === ALL_THREADS ? 'all threads, merged' : threadLabel(profile, thread))
  const [selected, setSelected] = useState<Pick | null>(null)
  return (
    <Split
      main={<FlameCanvas profile={profile} lanes={[lane]} extent={extent} match={match} selected={selected} onSelect={setSelected} />}
      detail={selected && <NodeDetails profile={profile} lane={lane} node={selected.span} extent={extent} onOpen={onOpen} />}
    />
  )
}

function NodeDetails({ profile, lane, node, extent, onOpen }: { profile: Profile; lane: Lane; node: number; extent: number; onOpen: (f: number) => void }) {
  const f = lane.fn[node]
  const depth = depthOf(lane, node)
  return (
    <Details title={fnName(profile, f)} action={<OpenButton onClick={() => onOpen(f)} />}>
      <Field name="total time" value={fmtTime(lane.dur[node])} />
      <Field name="share" value={`${((lane.dur[node] / extent) * 100).toFixed(1)}%`} />
      <Field name="self time" value={fmtTime(selfTime(lane, depth, node))} />
      <Field name="depth" value={String(depth)} />
      <Field name="module" value={fnModule(profile, f) || 'none'} />
      <Field name="category" value={fnCategory(profile, f)} />
    </Details>
  )
}

type SandwichKey = 'label' | 'self' | 'total'

function Sandwich({
  profile,
  filter,
  match,
  selected,
  onSelect,
}: {
  profile: Profile
  filter: Filter
  match: Uint8Array | null
  selected: number | null
  onSelect: (f: number) => void
}) {
  const all = rows(profile, 'function', filter.thread, match)
  const [sort, toggle] = useSort<SandwichKey>({ key: 'self', dir: 'desc' }, ['label'])
  const list = sorted(all, sort, (r, key) => r[key])
  const heaviest = all.reduce<Row | null>((best, r) => (best === null || r.self > best.self ? r : best), null)
  const f = selected ?? heaviest?.fn ?? null
  const callers = f === null ? null : treeLane(callersTree(profile, f, filter.thread), 'callers', 'callers · who calls it')
  const callees = f === null ? null : treeLane(calleesTree(profile, f, filter.thread), 'callees', 'callees · what it calls')
  const [pick, setPick] = useState<{ which: 'callers' | 'callees'; span: number } | null>(null)

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="max-h-72 shrink-0 overflow-auto border-b border-white/10 md:max-h-none md:w-[min(40%,520px)] md:border-b-0 md:border-r">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <SortHeader id="label" sort={sort} onSort={toggle} align="left">
                function
              </SortHeader>
              <SortHeader id="self" sort={sort} onSort={toggle} className="w-px">
                self
              </SortHeader>
              <SortHeader id="total" sort={sort} onSort={toggle} className="w-px">
                total
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr
                key={r.key}
                onClick={() => {
                  onSelect(r.fn)
                  setPick(null)
                }}
                aria-selected={r.fn === f}
                className={`cursor-pointer border-b border-white/[0.04] ${r.fn === f ? 'bg-accent/10' : 'hover:bg-white/[0.04]'}`}
              >
                <td className={`max-w-0 truncate px-2 py-1 ${r.fn === f ? 'text-accent' : 'text-zinc-200'}`} title={r.label}>
                  {r.label}
                </td>
                <Num value={fmtTime(r.self)} strong={sort.key === 'self'} />
                <Num value={fmtTime(r.total)} strong={sort.key === 'total'} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f === null || !callers || !callees ? (
        <div className="flex-1 px-3 py-6 text-center text-xs text-zinc-600">nothing matches the filters</div>
      ) : (
        <div key={f} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 border-b border-white/10">
            <FlameCanvas
              profile={profile}
              lanes={[callers.lane]}
              extent={callers.extent}
              match={match}
              selected={pick?.which === 'callers' ? { lane: 0, span: pick.span } : null}
              onSelect={(p) => setPick(p && { which: 'callers', span: p.span })}
            />
          </div>
          <div className="min-h-0 flex-1">
            <FlameCanvas
              profile={profile}
              lanes={[callees.lane]}
              extent={callees.extent}
              match={match}
              selected={pick?.which === 'callees' ? { lane: 0, span: pick.span } : null}
              onSelect={(p) => setPick(p && { which: 'callees', span: p.span })}
            />
          </div>
          {pick && (
            <div className="h-40 shrink-0 border-t border-white/10">
              <NodeDetails
                profile={profile}
                lane={pick.which === 'callers' ? callers.lane : callees.lane}
                node={pick.span}
                extent={pick.which === 'callers' ? callers.extent : callees.extent}
                onOpen={onSelect}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Allocations({ profile }: { profile: Profile }) {
  const { count, bytes, byType, byFunction } = profile.allocations
  return (
    <div className="flex h-full flex-col">
      <div className={`${bar} py-1.5 text-zinc-500`}>
        <Stat value={fmtCount(count)} name="allocations" />
        <Stat value={fmtBytes(bytes)} name="allocated" />
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <AllocTable title="type" rows={byType} />
        <AllocTable title="allocating function" rows={byFunction} />
      </div>
    </div>
  )
}

type AllocKey = 'name' | 'bytes' | 'count'

function AllocTable({ title, rows: unsorted }: { title: string; rows: AllocRow[] }) {
  const [sort, toggle] = useSort<AllocKey>({ key: 'bytes', dir: 'desc' }, ['name'])
  const list = sorted(unsorted, sort, (r, key) => r[key])
  return (
    <div className="min-h-0 overflow-auto border-white/10 lg:border-r lg:last:border-r-0">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <SortHeader id="name" sort={sort} onSort={toggle} align="left">
              {title}
            </SortHeader>
            <SortHeader id="bytes" sort={sort} onSort={toggle} className="w-px">
              bytes
            </SortHeader>
            <SortHeader id="count" sort={sort} onSort={toggle} className="w-px">
              count
            </SortHeader>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.name} className="border-b border-white/[0.04]">
              <td className="max-w-0 truncate px-2 py-1 text-zinc-200" title={r.name}>
                {r.name}
              </td>
              <Num value={fmtBytes(r.bytes)} strong={sort.key === 'bytes'} />
              <Num value={fmtCount(r.count)} strong={sort.key === 'count'} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Details({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className={`${bar} bg-white/[0.02] py-1.5`}>
        <span className="min-w-0 flex-1 truncate text-zinc-200" title={title}>
          {title}
        </span>
        {action}
      </div>
      <dl className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-3 overflow-auto px-3 py-3 text-xs">{children}</dl>
    </div>
  )
}

function Field({ name, value }: { name: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-zinc-600">{name}</dt>
      <dd className="mt-0.5 truncate tabular-nums text-zinc-300" title={value}>
        {value}
      </dd>
    </div>
  )
}

function OpenButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="shrink-0 cursor-pointer rounded-md border border-accent/30 px-2 py-0.5 text-accent hover:bg-accent/10">
      open in sandwich
    </button>
  )
}
