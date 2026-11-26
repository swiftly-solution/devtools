import type { ReactNode } from 'react'
import { Splitter } from './Splitter.tsx'
import { th } from './ui.ts'
import { useWidths } from './useSize.ts'

export interface Column {
  label: string
  width: number
  align?: 'left' | 'right'
}

const FILL_MIN = 120

export function ColumnTable({ storageKey, columns, fill, children }: { storageKey: string; columns: Column[]; fill: Omit<Column, 'width'>; children: ReactNode }) {
  const [widths, setWidth] = useWidths(storageKey, columns.map((c) => c.width))
  const all: Omit<Column, 'width'>[] = [...columns, fill]
  return (
    <table className="w-full table-fixed text-xs" style={{ minWidth: widths.reduce((s, w) => s + w, FILL_MIN) }}>
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
        <col />
      </colgroup>
      <thead>
        <tr>
          {all.map((c, i) => (
            <th key={c.label} className={`${th} overflow-hidden text-ellipsis ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
              {c.label}
              {i < widths.length && (
                <div className="absolute inset-y-0 right-1 flex">
                  <Splitter axis="x" size={widths[i]} onResize={(w) => setWidth(i, w)} label={`resize ${c.label} column`} />
                </div>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}
