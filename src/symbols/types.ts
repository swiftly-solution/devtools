export interface Resolved {
  name: string
  file?: string
  line?: number
}

export interface Symbolizer {
  kind: 'pdb' | 'elf'
  lookup(addr: number): Resolved | null
}
