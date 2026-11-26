import { useState } from 'react'

export type Dir = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K
  dir: Dir
}

export function useSort<K extends string>(initial: SortState<K>, textKeys: readonly K[]) {
  const [sort, setSort] = useState(initial)
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: textKeys.includes(key) ? 'asc' : 'desc' }))
  return [sort, toggle] as const
}

export function sorted<T, K extends string>(list: T[], sort: SortState<K>, get: (row: T, key: K) => number | string) {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const x = get(a, sort.key)
    const y = get(b, sort.key)
    return (typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y) * sign
  })
}
