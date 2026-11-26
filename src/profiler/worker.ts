import { parseJson } from './json.ts'
import { buildModel, transferables } from './model.ts'
import { parsePb } from './pb.ts'

export type WorkerMessage = { type: 'progress'; stage: string; ratio: number } | { type: 'done'; profile: ReturnType<typeof buildModel> } | { type: 'error'; message: string }

const post = (m: WorkerMessage, transfer: Transferable[] = []) => postMessage(m, { transfer })

onmessage = async (e: MessageEvent<File>) => {
  try {
    const file = e.data
    const head = new Uint8Array(await file.slice(0, 1).arrayBuffer())[0]
    const progress = (ratio: number) => post({ type: 'progress', stage: 'reading', ratio })
    const raw = head === 0x7b ? await parseJson(file, progress) : parsePb(new Uint8Array(await file.arrayBuffer()), progress)
    if (raw.n === 0) throw new Error('The profile has no spans.')
    post({ type: 'progress', stage: 'building call tree', ratio: 1 })
    const profile = buildModel(raw)
    post({ type: 'done', profile }, transferables(profile))
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
