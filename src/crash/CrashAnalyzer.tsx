import { useEffect, useState, type ReactNode } from 'react'
import { ColumnTable } from '../ColumnTable.tsx'
import { FileDrop } from '../FileDrop.tsx'
import { Splitter } from '../Splitter.tsx'
import { useSize } from '../useSize.ts'
import { applySymbols, missingSymbols, releaseVersion } from '../symbols/apply.ts'
import { loadSymbols } from '../symbols/load.ts'
import type { Symbolizer } from '../symbols/types.ts'
import { bar, errorLine, statusBar } from '../ui.ts'
import { basename, formatUptime, parseCrashReport, type CrashReport, type Frame, type ManagedFrame } from './report'

const mentionsSwiftly = (...parts: (string | undefined)[]) => parts.some((p) => p !== undefined && /swiftlys2/i.test(p))
const RELEASES = 'https://github.com/swiftly-solution/swiftlys2/releases'

export function CrashAnalyzer() {
  const [report, setReport] = useState<CrashReport | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [symbols, setSymbols] = useState<{ name: string; symbolizer: Symbolizer } | null>(null)
  const [symbolError, setSymbolError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  async function load(file: File) {
    try {
      setReport(parseCrashReport(await file.text()))
      setFileName(file.name)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }

  async function loadSymbolFile(file: File) {
    setReading(true)
    setSymbolError(null)
    try {
      setSymbols({ name: file.name, symbolizer: await loadSymbols(file) })
    } catch (e) {
      setSymbols(null)
      setSymbolError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setReading(false)
    }
  }

  if (!report) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {error && <p className={errorLine}>{error}</p>}
        <div className="flex min-h-0 flex-1 p-4">
          <FileDrop accept=".json,application/json" onFile={load} className="flex-1 flex-col justify-center gap-2 px-6 text-center">
            <span className="text-sm text-zinc-300">
              drop a SwiftlyS2 <span className="text-accent">crashinfo.json</span> here, or click to choose one
            </span>
            <span className="text-xs text-zinc-600">read locally in your browser, nothing is uploaded</span>
          </FileDrop>
        </div>
      </div>
    )
  }

  const applied = symbols ? applySymbols(report, symbols.symbolizer, symbols.name) : null
  return (
    <Workspace
      key={fileName}
      report={applied?.report ?? report}
      fileName={fileName}
      onFile={load}
      error={error}
      symbols={
        <SymbolsBar
          report={report}
          loaded={symbols && applied ? { name: symbols.name, resolved: applied.resolved } : null}
          reading={reading}
          error={symbolError}
          onFile={loadSymbolFile}
        />
      }
    />
  )
}

function SymbolsBar({
  report,
  loaded,
  reading,
  error,
  onFile,
}: {
  report: CrashReport
  loaded: { name: string; resolved: number } | null
  reading: boolean
  error: string | null
  onFile: (file: File) => void
}) {
  const { total, windows } = missingSymbols(report)
  if (total === 0) return null
  const version = releaseVersion(report.native?.version)
  const archive = windows ? `swiftlys2-windows-v${version}-pdb.zip` : `swiftlys2-linux-v${version}.zip`
  const wanted = windows ? 'swiftlys2.pdb' : 'swiftlys2.so'
  const module = windows ? 'swiftlys2.dll' : 'swiftlys2.so'
  const done = loaded !== null && loaded.resolved === total

  return (
    <>
      <div className={`${bar} flex-wrap gap-y-1.5 py-1.5 ${done ? '' : 'bg-amber-400/[0.04]'}`}>
        <span className={done ? 'text-zinc-400' : 'text-amber-300'}>
          {done ? `symbols added for all ${total} ${module} frames` : `${total} ${module} ${total === 1 ? 'frame has' : 'frames have'} no function name`}
        </span>
        {!done &&
          (version ? (
            <span className="text-zinc-500">
              download{' '}
              <a href={`${RELEASES}/download/v${version}/${archive}`} className="text-accent hover:underline">
                {archive}
              </a>{' '}
              and drop it here
            </span>
          ) : (
            <span className="text-zinc-500">
              version is &quot;{report.native?.version ?? 'unknown'}&quot;, so drop the {wanted} it was built with, or a{' '}
              <a href={RELEASES} className="text-accent hover:underline">
                release archive
              </a>
            </span>
          ))}
        <FileDrop accept=".zip,.pdb,.so" onFile={onFile} className="ml-auto max-w-full px-2.5 py-1">
          <span className="truncate text-zinc-300">
            {reading ? 'reading symbols…' : loaded ? `${loaded.name} · ${loaded.resolved}/${total} resolved` : `drop ${version ? archive : wanted} or click`}
          </span>
        </FileDrop>
      </div>
      {error && <p className={errorLine}>{error}</p>}
      {loaded && !done && (
        <p className="shrink-0 border-b border-white/10 px-3 py-1.5 text-xs text-zinc-500">
          {total - loaded.resolved} {total - loaded.resolved === 1 ? 'frame was' : 'frames were'} not found. Check that the file is from the same SwiftlyS2 version.
        </p>
      )}
    </>
  )
}

type Sel = { kind: 'native' | 'managed'; index: number }

function Workspace({
  report,
  fileName,
  onFile,
  error,
  symbols,
}: {
  report: CrashReport
  fileName: string
  onFile: (file: File) => void
  error: string | null
  symbols: ReactNode
}) {
  const { machine, native, process } = report
  const { crash } = process
  const managed = process.managed ?? []
  const crashedIndex = process.threads.findIndex((t) => t.thread_id === crash.thread_id)
  const [sel, setSel] = useState<Sel>({ kind: 'native', index: Math.max(crashedIndex, 0) })
  const [frame, setFrame] = useState(0)
  const [threadsWidth, setThreadsWidth] = useSize('crash.threads-width', 320, 180, 720)
  const [detailHeight, setDetailHeight] = useSize('crash.detail-height', 256, 96, 720)
  const threads: Sel[] = [...process.threads.map((_, index) => ({ kind: 'native' as const, index })), ...managed.map((_, index) => ({ kind: 'managed' as const, index }))]
  const frames: (Frame | ManagedFrame)[] = (sel.kind === 'native' ? process.threads[sel.index]?.frames : managed[sel.index]?.frames) ?? []

  const pickThread = (s: Sel) => {
    setSel(s)
    setFrame(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, select, textarea')) return
      const at = threads.findIndex((t) => t.kind === sel.kind && t.index === sel.index)
      if (e.key === 'ArrowDown' || e.key === 'j') setFrame((f) => Math.min(f + 1, frames.length - 1))
      else if (e.key === 'ArrowUp' || e.key === 'k') setFrame((f) => Math.max(f - 1, 0))
      else if (e.key === ']' && at < threads.length - 1) pickThread(threads[at + 1])
      else if (e.key === '[' && at > 0) pickThread(threads[at - 1])
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    document.querySelector('[data-frame-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [frame, sel])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`${bar} flex-wrap gap-y-2 py-2`}>
        <FileDrop accept=".json,application/json" onFile={onFile} className="max-w-72 px-2.5 py-1">
          <span className="truncate text-zinc-300" title={`${fileName} · drop or click to open another report`}>
            {fileName}
          </span>
        </FileDrop>
        <span className="min-w-0 break-all font-semibold text-red-400">{crash.reason}</span>
        <span className="text-zinc-500">
          at <span className="text-zinc-200">{crash.address}</span>
          {/^0x0+$/i.test(crash.address) && <span className="text-zinc-500"> (null pointer)</span>} · thread{' '}
          <span className="text-zinc-200">{crash.thread_id}</span>
        </span>
        <span className="ml-auto flex flex-wrap gap-x-3 text-zinc-500">
          <Stat name="uptime" value={formatUptime(process.info?.uptime ?? 0)} />
          <Stat name="os" value={`${machine?.os?.name ?? 'unknown'} ${machine?.os?.version?.trim() ?? ''}`} />
          <Stat name="cpu" value={`${machine?.cpu?.name ?? 'unknown'} × ${machine?.cpu?.count ?? '?'}`} />
          <Stat name="swiftlys2" value={native?.version ?? 'unknown'} />
        </span>
      </div>
      {crash.assertion && <p className="shrink-0 border-b border-white/10 px-3 py-1.5 text-xs text-zinc-300">assertion: {crash.assertion}</p>}
      {error && <p className={errorLine}>{error}</p>}
      {symbols}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="threads"
          style={{ '--threads-w': `${threadsWidth}px` } as React.CSSProperties}
          className="max-h-48 shrink-0 overflow-auto border-b border-white/10 md:max-h-none md:w-(--threads-w) md:border-b-0"
        >
          <ThreadGroup title={`native threads · ${process.threads.length}`}>
            {process.threads.map((t, i) => (
              <ThreadItem
                key={`n${t.thread_id}`}
                active={sel.kind === 'native' && sel.index === i}
                onClick={() => pickThread({ kind: 'native', index: i })}
                title={`thread ${t.thread_id}`}
                badge={i === crashedIndex}
                count={t.frames.length}
                top={(t.frames.find((f) => f.function_name) ?? t.frames[0])?.function_name ?? t.frames[0]?.module}
              />
            ))}
          </ThreadGroup>
          {managed.length > 0 && (
            <ThreadGroup title={`managed threads · ${managed.length}`}>
              {managed.map((t, i) => (
                <ThreadItem
                  key={`m${t.thread_id}`}
                  active={sel.kind === 'managed' && sel.index === i}
                  onClick={() => pickThread({ kind: 'managed', index: i })}
                  title={`thread ${t.thread_id}${t.thread_name ? ` · ${t.thread_name}` : ''}`}
                  count={t.frames.length}
                  top={t.frames[0]?.function_name}
                />
              ))}
            </ThreadGroup>
          )}
        </nav>
        <Splitter axis="x" size={threadsWidth} onResize={setThreadsWidth} label="resize thread list" className="hidden md:block" />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            {frames.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-zinc-600">no frames captured for this thread</p>
            ) : sel.kind === 'native' ? (
              <NativeFrames frames={frames as Frame[]} selected={frame} onSelect={setFrame} />
            ) : (
              <ManagedFrames frames={frames as ManagedFrame[]} selected={frame} onSelect={setFrame} />
            )}
          </div>
          {frames[frame] && (
            <>
              <Splitter axis="y" size={detailHeight} onResize={setDetailHeight} invert label="resize frame details" />
              <div className="shrink-0" style={{ height: detailHeight }}>
                {sel.kind === 'native' ? <NativeDetail frame={frames[frame] as Frame} /> : <ManagedDetail frame={frames[frame] as ManagedFrame} />}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={statusBar}>
        <span className="truncate">↑/↓ or j/k move between frames · [ and ] switch threads · drag the dividers to resize</span>
      </div>
    </div>
  )
}

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      {name} <span className="text-zinc-200">{value}</span>
    </span>
  )
}

function ThreadGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0d0e10] px-3 py-1.5 text-[11px] text-zinc-500">{title}</div>
      <ul>{children}</ul>
    </div>
  )
}

function ThreadItem({ active, onClick, title, badge, count, top }: { active: boolean; onClick: () => void; title: string; badge?: boolean; count: number; top?: string }) {
  return (
    <li>
      <button
        onClick={onClick}
        aria-current={active}
        className={`block w-full cursor-pointer border-b border-l-2 border-b-white/[0.04] px-3 py-1.5 text-left text-xs ${
          active ? 'border-l-accent bg-accent/10' : 'border-l-transparent hover:bg-white/[0.04]'
        }`}
      >
        <span className="flex items-center gap-2">
          <span className={active ? 'text-accent' : 'text-zinc-300'}>{title}</span>
          {badge && <span className="rounded bg-red-500/15 px-1 text-[10px] text-red-400">crashed</span>}
          <span className="ml-auto tabular-nums text-zinc-600">{count}</span>
        </span>
        {top && <span className="mt-0.5 block truncate text-zinc-600">{top}</span>}
      </button>
    </li>
  )
}

function rowClass(active: boolean) {
  return `cursor-pointer border-b border-white/[0.04] ${active ? 'bg-accent/10' : 'hover:bg-white/[0.04]'}`
}

function NativeFrames({ frames, selected, onSelect }: { frames: Frame[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <ColumnTable
      storageKey="crash.native-columns"
      columns={[
        { label: '#', width: 44, align: 'right' },
        { label: 'function', width: 520 },
        { label: 'module', width: 180 },
        { label: 'source', width: 220 },
      ]}
      fill={{ label: 'offset', align: 'right' }}
    >
      {frames.map((f, i) => {
        const name = f.function_name ?? `${f.module ?? 'unknown'}+${f.function_offset ?? f.address}`
        return (
          <tr key={f.index} data-frame-selected={i === selected} onClick={() => onSelect(i)} className={rowClass(i === selected)}>
            <td className="truncate px-2 py-1 text-right tabular-nums text-zinc-600">{f.index}</td>
            <td className={`truncate px-2 py-1 ${f.function_name || mentionsSwiftly(f.module, f.source_file) ? 'text-zinc-200' : 'text-zinc-500'}`} title={name}>
              {name}
            </td>
            <td className="truncate px-2 py-1 text-zinc-500" title={f.module}>
              {f.module ?? '—'}
            </td>
            <td className="truncate px-2 py-1 text-code-type" title={f.source_file}>
              {f.source_file ? `${basename(f.source_file)}:${f.source_line}` : ''}
            </td>
            <td className="truncate px-2 py-1 text-right tabular-nums text-zinc-600">{f.function_offset ?? ''}</td>
          </tr>
        )
      })}
    </ColumnTable>
  )
}

function ManagedFrames({ frames, selected, onSelect }: { frames: ManagedFrame[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <ColumnTable
      storageKey="crash.managed-columns"
      columns={[
        { label: '#', width: 44, align: 'right' },
        { label: 'function', width: 620 },
        { label: 'assembly', width: 220 },
      ]}
      fill={{ label: 'address', align: 'right' }}
    >
      {frames.map((f, i) => (
        <tr key={f.index} data-frame-selected={i === selected} onClick={() => onSelect(i)} className={rowClass(i === selected)}>
          <td className="truncate px-2 py-1 text-right tabular-nums text-zinc-600">{f.index}</td>
          <td className="truncate px-2 py-1 text-zinc-200" title={f.function_name}>
            {f.function_name}
          </td>
          <td className="truncate px-2 py-1 text-code-type" title={f.source}>
            {f.source ? basename(f.source) : ''}
          </td>
          <td className="truncate px-2 py-1 text-right tabular-nums text-zinc-600">{f.address}</td>
        </tr>
      ))}
    </ColumnTable>
  )
}

function DetailPane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className={`${bar} bg-white/[0.02] py-1.5`}>
        <span className="min-w-0 truncate text-zinc-200" title={title}>
          {title}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-xs">{children}</div>
    </div>
  )
}

function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{children}</dl>
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-600">{name}</dt>
      <dd className="break-all tabular-nums text-zinc-300">{children}</dd>
    </>
  )
}

function NativeDetail({ frame: f }: { frame: Frame }) {
  return (
    <DetailPane title={f.function_name ?? `${f.module ?? 'unknown'}+${f.function_offset ?? f.address}`}>
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Fields>
          <Field name="address">{f.address}</Field>
          {f.module && <Field name="module">{f.module}</Field>}
          {f.function_offset && <Field name="function offset">{f.function_offset}</Field>}
          {f.instruction_offset && <Field name="instruction offset">{f.instruction_offset}</Field>}
          {f.source_file && (
            <Field name="source">
              {f.source_file}:{f.source_line}
            </Field>
          )}
          {f.trust && <Field name="found by">{f.trust.description}</Field>}
          {f.symbolized && <Field name="symbols">{f.symbolized}</Field>}
        </Fields>
        {f.registers && Object.keys(f.registers).length > 0 && (
          <div>
            <div className="mb-1 text-zinc-600">registers</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-4 gap-y-0.5">
              {Object.entries(f.registers).map(([name, value]) => (
                <div key={name} className="flex justify-between gap-3">
                  <span className="text-zinc-600">{name}</span>
                  <span className="tabular-nums text-zinc-400">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DetailPane>
  )
}

function ManagedDetail({ frame: f }: { frame: ManagedFrame }) {
  return (
    <DetailPane title={f.function_name}>
      <Fields>
        <Field name="address">{f.address}</Field>
        {f.source && <Field name="assembly">{f.source}</Field>}
        <Field name="timestamp">{f.timestamp}</Field>
      </Fields>
    </DetailPane>
  )
}
