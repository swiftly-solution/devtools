import { useState, type ReactNode } from 'react'

export function FileDrop({ accept, onFile, className, children }: { accept: string; onFile: (file: File) => void; className: string; children: ReactNode }) {
  const [dragging, setDragging] = useState(false)
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={`flex cursor-pointer items-center gap-4 rounded-xl border border-dashed transition-colors ${
        dragging ? 'border-accent bg-accent/5' : 'border-white/15 hover:border-white/30'
      } ${className}`}
    >
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
      {children}
    </label>
  )
}
