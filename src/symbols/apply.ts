import type { CrashReport, Frame } from '../crash/report.ts'
import type { Symbolizer } from './types.ts'

const SWIFTLY_MODULE = /swiftlys2\.(dll|so)$/i
const IP_IN_CONTEXT = 'given as instruction pointer in context'

export const needsSymbols = (f: Frame) => !f.function_name && SWIFTLY_MODULE.test(f.module ?? '')
export const releaseVersion = (v?: string) => /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(v?.trim() ?? '')?.[1]
const kindOf = (f: Frame) => (/\.dll$/i.test(f.module ?? '') ? 'pdb' : 'elf')

export function missingSymbols(report: CrashReport) {
  const frames = report.process.threads.flatMap((t) => t.frames).filter(needsSymbols)
  return { total: frames.length, windows: frames.some((f) => kindOf(f) === 'pdb') }
}

export function applySymbols(report: CrashReport, symbols: Symbolizer, label: string) {
  let resolved = 0
  const threads = report.process.threads.map((t) => ({
    ...t,
    frames: t.frames.map((f): Frame => {
      if (!needsSymbols(f) || kindOf(f) !== symbols.kind || !f.function_offset) return f
      const addr = parseInt(f.function_offset, 16) - (f.trust?.description === IP_IN_CONTEXT ? 0 : 1)
      const hit = symbols.lookup(addr)
      if (!hit) return f
      resolved++
      return { ...f, function_name: hit.name, source_file: hit.file, source_line: hit.line, symbolized: label }
    }),
  }))
  return { report: { ...report, process: { ...report.process, threads } }, resolved }
}
