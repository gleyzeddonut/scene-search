import { ReactNode } from 'react'
import { IconBrowse, IconPrepare, IconLibrary } from './icons'

const NAV: [string, string, ReactNode][] = [
  ['browse', 'Browse', <IconBrowse key="b" />],
  ['prepare', 'Prepare', <IconPrepare key="p" />],
  ['library', 'Library', <IconLibrary key="l" />]
]

const TITLES: Record<string, string> = { browse: 'Browse', prepare: 'Prepare', library: 'Library' }

export function AppShell(props: {
  section: string
  onSection: (s: string) => void
  search: string
  onSearch: (s: string) => void
  theme: string
  onTheme: (t: string) => void
  children: ReactNode
}) {
  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand">
          <div className="brand-square" />
          <span className="wordmark">Scripty</span>
          <span className="brand-sep">/ {TITLES[props.section]}</span>
        </div>
        <div className="toolbar-center">
          <div className="search">
            <span className="search-dot" />
            <input
              placeholder="Search scenes, characters…"
              value={props.search}
              onChange={(e) => props.onSearch(e.target.value)}
            />
            <span className="kbd">⌘K</span>
          </div>
        </div>
        <div className="seg" onClick={() => props.onTheme(props.theme === 'dark' ? 'light' : 'dark')}>
          <span className={props.theme === 'light' ? 'on' : ''}>☀</span>
          <span className={props.theme === 'dark' ? 'on' : ''}>☾</span>
        </div>
      </div>
      <div className="body">
        <div className="nav">
          {NAV.map(([key, label, icon]) => (
            <button
              key={key}
              className={'navItem' + (props.section === key ? ' on' : '')}
              onClick={() => props.onSection(key)}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
        {props.children}
      </div>
    </div>
  )
}
