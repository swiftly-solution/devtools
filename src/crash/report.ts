export interface Frame {
  index: number
  address: string
  module?: string
  function_name?: string
  function_offset?: string
  instruction_offset?: string
  source_file?: string
  source_line?: number
  source_offset?: number
  registers?: Record<string, string>
  trust?: { description: string }
  symbolized?: string
}

export interface ManagedFrame {
  index: number
  address: string
  function_name: string
  source: string
  timestamp: number
}

export interface NativeThread {
  thread_id: number
  thread_name?: string
  frames: Frame[]
}

export interface ManagedThread {
  thread_id: number
  thread_name?: string
  frames: ManagedFrame[]
}

export interface CrashReport {
  machine?: {
    cpu?: { count?: number; info?: string; name?: string }
    os?: { name?: string; version?: string }
  }
  native?: { version?: string }
  process: {
    crash: { address: string; assertion?: string; reason: string; thread_id: number }
    crashed?: boolean
    info?: { uptime?: number }
    managed?: ManagedThread[]
    threads: NativeThread[]
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseCrashReport(text: string): CrashReport {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const proc = isRecord(data) ? data.process : undefined
  if (!isRecord(proc) || !Array.isArray(proc.threads) || !isRecord(proc.crash)) {
    throw new Error('This is not a SwiftlyS2 crash report: "process.crash" or "process.threads" is missing.')
  }
  const threads = (proc.threads as NativeThread[]).map((t) => ({ ...t, frames: t.frames ?? [] }))
  return { ...(data as CrashReport), process: { ...(proc as CrashReport['process']), threads } }
}

export const basename = (path: string) => path.split(/[\\/]/).pop() ?? path

export const formatUptime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
