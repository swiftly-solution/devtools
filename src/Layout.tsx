import { NavLink, Outlet } from 'react-router'
import { DiscordIcon, GithubIcon } from './icons'

const YEAR = new Date().getFullYear()
const REPO_URL = 'https://github.com/swiftly-solution/swiftlys2'
const DISCORD_URL = 'https://swiftlys2.net/discord'

const TABS = [
  { label: 'crash analyzer', to: '/crash-analyzer' },
  { label: 'profiler analyzer', to: '/profiler-analyzer' },
]

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-background font-mono text-foreground antialiased">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <nav className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-1.5 gap-y-1 px-4 py-3 text-xs text-zinc-500 sm:px-6 sm:text-sm">
          <img src="/icon.png" alt="" width={18} height={18} className="shrink-0" />
          <NavLink to="/" className="font-semibold text-white">
            swiftlys2 devtools
          </NavLink>
          {TABS.map((t) => (
            <span key={t.to} className="flex items-center gap-1.5">
              <span className="text-zinc-700">/</span>
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  `transition-colors hover:text-white ${isActive ? 'text-accent' : ''}`
                }
              >
                {t.label}
              </NavLink>
            </span>
          ))}
          <div className="ml-auto flex items-center gap-3 text-zinc-500">
            <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub" className="transition-colors hover:text-white">
              <GithubIcon className="h-4 w-4" />
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noreferrer" aria-label="Discord" className="transition-colors hover:text-white">
              <DiscordIcon className="h-4 w-4" />
            </a>
          </div>
        </nav>
      </header>
      <main className="relative flex flex-1 flex-col">
        <Outlet />
      </main>
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 px-6 py-8 text-xs text-zinc-600 md:flex-row">
          <span>© 2025-{YEAR} SwiftlyLabs.net - licensed GPLv3</span>
          <span>swiftlys2.net is a hobby project, not affiliated with Valve Corp.</span>
        </div>
      </footer>
    </div>
  )
}
