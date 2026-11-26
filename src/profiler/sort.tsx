import type { ReactNode } from 'react'
import { th } from '../ui.ts'
import type { SortState } from './sorting.ts'

interface HeaderProps<K extends string> {
  id: K
  sort: SortState<K>
  onSort: (key: K) => void
  align?: 'left' | 'right'
  className?: string
  children: ReactNode
}

export function SortHeader<K extends string>({ id, sort, onSort, align = 'right', className = '', children }: HeaderProps<K>) {
  const active = sort.key === id
  return (
    <th className={`${th} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        onClick={() => onSort(id)}
        title={active ? `sorted ${sort.dir === 'asc' ? 'ascending' : 'descending'} · click to reverse` : 'click to sort'}
        className={`cursor-pointer ${active ? 'text-accent' : 'hover:text-zinc-300'}`}
      >
        {children}
        {active && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
      </button>
    </th>
  )
}
