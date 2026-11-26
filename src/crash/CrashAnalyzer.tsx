import { useState, type ReactNode } from 'react'
import { applySymbols, missingSymbols, releaseVersion } from '../symbols/apply.ts'
import { loadSymbols } from '../symbols/load.ts'
import type { Symbolizer } from '../symbols/types.ts'
import { basename, formatUptime, parseCrashReport, type CrashReport, type Frame, type ManagedFrame, type NativeThread } from './report'

const card = 'overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]'
const label = 'text-xs text-zinc-500'
const rowHover = 'hover:bg-white/[0.03]'
const errorBox = 'rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400'
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
      setReport(null)
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

  const applied = report && symbols ? applySymbols(report, symbols.symbolizer, symbols.name) : null

  return (
    <section className="mx-auto w-full max-w-6xl flex-1 px-6 pb-20 pt-12">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-300 sm:text-3xl">
        crash <span className="text-accent">analyzer</span>
      </h1>
      <p className="mt-2 text-sm text-zinc-500">Read a SwiftlyS2 crash report without scrolling through raw JSON.</p>

      <div className="mt-8">
        <FileDrop
          accept=".json,application/json"
          onFile={load}
          className={report ? 'px-4 py-3' : 'flex-col justify-center gap-2 px-6 py-14 text-center'}
        >
          {report ? (
            <>
              <span className="truncate text-sm text-zinc-300">{fileName}</span>
              <span className="ml-auto hidden shrink-0 text-xs text-zinc-500 sm:inline">drop or click to load another</span>
            </>
          ) : (
            <>
              <span className="text-sm text-zinc-300">drop a crashinfo.json here, or click to choose one</span>
              <span className="text-xs text-zinc-600">read locally in your browser, nothing is uploaded</span>
            </>
          )}
        </FileDrop>
      </div>

      {error && <p className={`mt-4 ${errorBox}`}>{error}</p>}
      {report && (
        <Report
          report={applied?.report ?? report}
          symbols={
            <SymbolsPanel
              report={report}
              loaded={symbols && applied ? { name: symbols.name, resolved: applied.resolved } : null}
              reading={reading}
              error={symbolError}
              onFile={loadSymbolFile}
            />
          }
        />
      )}
    </section>
  )
}

function FileDrop({ accept, onFile, className, children }: { accept: string; onFile: (file: File) => void; className: string; children: ReactNode }) {
  const [dragging, setDragging] = useState(false)
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={`flex cursor-pointer items-center gap-4 rounded-xl border border-dashed transition-colors ${
        dragging ? 'border-accent bg-accent/5' : 'border-white/15 hover:border-white/30'
      } ${className}`}
    >
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
      {children}
    </label>
  )
}

function SymbolsPanel({
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

  return (
    <div className={`${card} p-5`}>
      <div className="text-sm text-zinc-300">
        {loaded && loaded.resolved === total
          ? `function names and source lines added for ${total === 1 ? 'the frame' : `all ${total} frames`} in ${module}`
          : `${total} ${total === 1 ? 'frame' : 'frames'} in ${module} ${total === 1 ? 'has' : 'have'} no function name`}
      </div>
      <p className={`mt-1 text-sm text-zinc-500 ${loaded && loaded.resolved === total ? 'hidden' : ''}`}>
        {version ? (
          <>
            This crash is from SwiftlyS2 v{version}. Download{' '}
            <a href={`${RELEASES}/download/v${version}/${archive}`} className="text-accent hover:underline">
              {archive}
            </a>{' '}
            and drop it here to fill in function names and source lines.
          </>
        ) : (
          <>
            This build reports its version as &quot;{report.native?.version ?? 'unknown'}&quot;, so there is no release to download. Drop the {wanted} it
            was built with, or a release archive from{' '}
            <a href={RELEASES} className="text-accent hover:underline">
              GitHub
            </a>
            .
          </>
        )}
      </p>
      <div className="mt-4">
        <FileDrop accept=".zip,.pdb,.so" onFile={onFile} className="px-4 py-3">
          <span className="truncate text-sm text-zinc-300">
            {reading
              ? 'reading symbols…'
              : loaded
                ? `${loaded.name} · resolved ${loaded.resolved} of ${total}`
                : `drop ${version ? archive : wanted}, or click to choose`}
          </span>
          {loaded && <span className="ml-auto hidden shrink-0 text-xs text-zinc-500 sm:inline">drop or click to replace</span>}
        </FileDrop>
      </div>
      {error && <p className={`mt-3 ${errorBox}`}>{error}</p>}
      {loaded && loaded.resolved < total && (
        <p className="mt-3 text-xs text-zinc-500">
          {total - loaded.resolved} {total - loaded.resolved === 1 ? 'frame was' : 'frames were'} not found. Check that the file is from the same SwiftlyS2
          version.
        </p>
      )}
    </div>
  )
}

type Tab = 'crashed' | 'managed' | 'threads'

function Report({ report, symbols }: { report: CrashReport; symbols: ReactNode }) {
  const { machine, native, process } = report
  const { crash } = process
  const managed = process.managed ?? []
  const crashedThread = process.threads.find((t) => t.thread_id === crash.thread_id)
  const [tab, setTab] = useState<Tab>('crashed')
  const tabs: [Tab, string][] = [
    ['crashed', `crashed thread (${crashedThread?.frames.length ?? 0})`],
    ...(managed.length > 0 ? [['managed', `managed (${managed.length})`] as [Tab, string]] : []),
    ['threads', `all threads (${process.threads.length})`],
  ]

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div className={`${card} border-red-500/30 bg-red-500/[0.04]`}>
        <div className="p-5 sm:p-6">
          <div className={label}>crash reason</div>
          <div className="mt-1 break-all text-xl font-semibold text-red-400 sm:text-2xl">{crash.reason}</div>
          <div className="mt-2 text-sm text-zinc-500">
            at <span className="text-zinc-300">{crash.address}</span>
            {/^0x0+$/i.test(crash.address) && ' (null pointer)'} on thread <span className="text-zinc-300">{crash.thread_id}</span>
          </div>
          {crash.assertion && <div className="mt-3 text-sm text-zinc-300">assertion: {crash.assertion}</div>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/10 px-5 py-4 sm:grid-cols-4 sm:px-6">
          <Fact name="uptime" value={formatUptime(process.info?.uptime ?? 0)} />
          <Fact name="os" value={`${machine?.os?.name ?? 'unknown'} ${machine?.os?.version?.trim() ?? ''}`} />
          <Fact name="cpu" value={`${machine?.cpu?.name ?? 'unknown'} · ${machine?.cpu?.count ?? '?'} cores`} />
          <Fact name="swiftlys2" value={native?.version ?? 'unknown'} />
        </dl>
      </div>

      {symbols}

      <div>
        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-white/10 text-sm">
          {tabs.map(([id, text]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px shrink-0 cursor-pointer border-b-2 px-3 py-2 transition-colors ${
                tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {text}
            </button>
          ))}
        </div>

        <div className={`${card} mt-4`}>
          {tab === 'crashed' &&
            (crashedThread ? <Frames frames={crashedThread.frames} /> : <Empty>thread {crash.thread_id} is not in the report</Empty>)}
          {tab === 'managed' && (
            <div className="divide-y divide-white/10">
              {managed.map((t) => (
                <div key={t.thread_id}>
                  <div className="bg-white/[0.03] px-4 py-2 text-xs text-zinc-500">
                    thread {t.thread_id} · {t.thread_name || 'unnamed'}
                  </div>
                  <ManagedFrames frames={t.frames} />
                </div>
              ))}
            </div>
          )}
          {tab === 'threads' && (
            <div className="divide-y divide-white/5">
              {process.threads.map((t) => (
                <ThreadRow key={t.thread_id} thread={t} crashed={t === crashedThread} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Fact({ name, value }: { name: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={label}>{name}</dt>
      <dd className="mt-0.5 break-words text-sm text-zinc-300">{value}</dd>
    </div>
  )
}

function ThreadRow({ thread, crashed }: { thread: NativeThread; crashed: boolean }) {
  const top = thread.frames.find((f) => f.function_name) ?? thread.frames[0]
  return (
    <details className="group">
      <summary className={`flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm ${rowHover} [&::-webkit-details-marker]:hidden`}>
        <span className="text-xs text-zinc-600 transition-transform group-open:rotate-90">▸</span>
        <span className="shrink-0 text-zinc-300">thread {thread.thread_id}</span>
        {crashed && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-400">crashed</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-600">{top?.function_name ?? top?.module}</span>
        <span className="shrink-0 text-xs text-zinc-600">{thread.frames.length}</span>
      </summary>
      <div className="border-t border-white/5 bg-black/20">
        <Frames frames={thread.frames} />
      </div>
    </details>
  )
}

function Frames({ frames }: { frames: Frame[] }) {
  if (frames.length === 0) return <Empty>no frames captured</Empty>
  return (
    <ol className="divide-y divide-white/5">
      {frames.map((f) => (
        <li key={f.index}>
          <details className="group">
            <summary className={`flex cursor-pointer list-none gap-3 px-4 py-2.5 ${rowHover} [&::-webkit-details-marker]:hidden`}>
              <span className="w-5 shrink-0 text-right text-xs leading-5 tabular-nums text-zinc-600">{f.index}</span>
              <span className="min-w-0 flex-1">
                <span className={`block break-all text-sm ${f.function_name || mentionsSwiftly(f.module, f.source_file) ? 'text-zinc-200' : 'text-zinc-500'}`}>
                  {f.function_name ?? `${f.module ?? 'unknown'}+${f.function_offset ?? f.address}`}
                </span>
                {f.function_name && f.module && (
                  <span className="mt-0.5 block text-xs text-zinc-600">
                    {f.module}
                    {f.source_file && (
                      <span className="text-code-type">
                        {' · '}
                        {basename(f.source_file)}:{f.source_line}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </summary>
            <FrameDetail frame={f} />
          </details>
        </li>
      ))}
    </ol>
  )
}

function FrameDetail({ frame: f }: { frame: Frame }) {
  return (
    <div className="flex flex-col gap-3 bg-black/30 px-4 py-3 pl-12 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <Field name="address">{f.address}</Field>
        {f.function_offset && <Field name="function offset">{f.function_offset}</Field>}
        {f.instruction_offset && <Field name="instruction offset">{f.instruction_offset}</Field>}
        {f.source_file && (
          <Field name="source">
            {f.source_file}:{f.source_line}
          </Field>
        )}
        {f.trust && <Field name="found by">{f.trust.description}</Field>}
        {f.symbolized && <Field name="symbols">{f.symbolized}</Field>}
      </dl>
      {f.registers && (
        <details>
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">registers</summary>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(f.registers).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-3">
                <span className="text-zinc-600">{name}</span>
                <span className="text-zinc-400">{value}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function ManagedFrames({ frames }: { frames: ManagedFrame[] }) {
  if (frames.length === 0) return <Empty>no frames captured</Empty>
  return (
    <ol className="divide-y divide-white/5">
      {frames.map((f) => (
        <li key={f.index} className="flex gap-3 px-4 py-2.5" title={f.source}>
          <span className="w-5 shrink-0 text-right text-xs leading-5 tabular-nums text-zinc-600">{f.index}</span>
          <span className="min-w-0 flex-1">
            <span className="block break-all text-sm text-zinc-200">{f.function_name}</span>
            {f.source && <span className="mt-0.5 block text-xs text-code-type">{basename(f.source)}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-600">{name}</dt>
      <dd className="break-all text-zinc-400">{children}</dd>
    </>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-sm text-zinc-600">{children}</p>
}
