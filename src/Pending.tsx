export function Pending({ title, description }: { title: string; description: string }) {
  return (
    <section className="relative flex-1 overflow-hidden px-6 pb-20 pt-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'linear-gradient(to bottom, black, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
        }}
      />
      <div className="mx-auto max-w-6xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-zinc-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          implementation pending
        </div>
        <h1 className="mt-8 text-3xl font-bold tracking-tight text-zinc-300 sm:text-4xl lg:text-5xl">
          <span className="text-accent">{title}</span>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-zinc-500">{description}</p>
      </div>
    </section>
  )
}
