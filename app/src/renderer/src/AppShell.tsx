import { ReactNode } from 'react'

export function AppShell(props: {
  section: string
  onSection: (s: string) => void
  search: string
  onSearch: (s: string) => void
  theme: string
  onTheme: (t: string) => void
  children: ReactNode
}) {
  const nav: [string, string][] = [
    ['browse', 'Browse'],
    ['prepare', 'Prepare'],
    ['library', 'Library']
  ]
  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand-dot" />
        <div className="wordmark">Scripty</div>
        <div className="search">
          <input
            placeholder="Search scenes, characters…"
            value={props.search}
            onChange={(e) => props.onSearch(e.target.value)}
          />
          <span className="kbd">⌘K</span>
        </div>
        <div className="seg">
          <button className={props.theme === 'light' ? 'on' : ''} onClick={() => props.onTheme('light')}>
            ☀
          </button>
          <button className={props.theme === 'dark' ? 'on' : ''} onClick={() => props.onTheme('dark')}>
            ☾
          </button>
        </div>
      </div>
      <div className="body">
        <div className="nav">
          {nav.map(([key, label]) => (
            <button
              key={key}
              className={props.section === key ? 'on' : ''}
              onClick={() => props.onSection(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {props.children}
      </div>
    </div>
  )
}
