import type React from 'react'

interface Props {
  axis: 'x' | 'y'
  size: number
  onResize: (size: number) => void
  invert?: boolean
  label: string
  className?: string
}

export function Splitter({ axis, size, onResize, invert = false, label, className = '' }: Props) {
  const horizontal = axis === 'x'
  const sign = invert ? -1 : 1

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const from = horizontal ? e.clientX : e.clientY
    const start = size
    el.setPointerCapture(e.pointerId)
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => onResize(start + sign * ((horizontal ? ev.clientX : ev.clientY) - from))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    const keys = horizontal ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 }
    const dir = keys[e.key as keyof typeof keys]
    if (dir === undefined) return
    e.preventDefault()
    onResize(size + sign * dir * step)
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`group relative z-20 shrink-0 touch-none bg-white/10 outline-none ${
        horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
      } ${className}`}
    >
      <div
        className={`absolute transition-colors group-hover:bg-accent/40 group-focus-visible:bg-accent/60 group-active:bg-accent/60 ${
          horizontal ? '-inset-x-1 inset-y-0' : '-inset-y-1 inset-x-0'
        }`}
      />
    </div>
  )
}
