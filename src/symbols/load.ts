import { unzipSync } from 'fflate'
import { parseElf } from './elf.ts'
import { parsePdb } from './pdb.ts'
import type { Symbolizer } from './types.ts'

export function extractSymbolFile(zip: Uint8Array): Uint8Array {
  const found = Object.values(unzipSync(zip, { filter: (f) => /(^|\/)swiftlys2\.(pdb|so)$/.test(f.name) }))[0]
  if (!found) throw new Error('That archive has no swiftlys2.pdb or swiftlys2.so in it.')
  return found
}

export async function loadSymbols(file: File): Promise<Symbolizer> {
  let data: Uint8Array = new Uint8Array(await file.arrayBuffer())
  if (data[0] === 0x50 && data[1] === 0x4b) data = extractSymbolFile(data)
  if (data[0] === 0x7f && data[1] === 0x45) {
    const { loadDemangler } = await import('./demangle.ts')
    return parseElf(data, await loadDemangler())
  }
  return parsePdb(data)
}
