import { useState } from 'react'

export function useSize(key: string, initial: number, min: number, max: number) {
  const clamp = (v: number) => Math.round(Math.min(Math.max(v, min), max))
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      return saved > 0 ? clamp(saved) : initial
    } catch {
      return initial
    }
  })
  const set = (v: number) => {
    const next = clamp(v)
    setSize(next)
    try {
      localStorage.setItem(key, String(next))
    } catch {
      return
    }
  }
  return [size, set] as const
}

export function useWidths(key: string, initial: number[], min = 40, max = 2000) {
  const [widths, setWidths] = useState(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      return Array.isArray(saved) && saved.length === initial.length && saved.every((v) => typeof v === 'number' && v > 0) ? (saved as number[]) : initial
    } catch {
      return initial
    }
  })
  const set = (i: number, v: number) => {
    const next = widths.map((w, j) => (j === i ? Math.round(Math.min(Math.max(v, min), max)) : w))
    setWidths(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      return
    }
  }
  return [widths, set] as const
}
