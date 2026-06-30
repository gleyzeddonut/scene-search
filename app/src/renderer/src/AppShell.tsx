import { ReactNode, useEffect, useRef } from 'react'
import { IconBrowse, IconPrepare, IconLibrary, IconGear } from './icons'
import iconUrl from './assets/icon.png'

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
  onSettings: () => void
  showPreview: boolean
  onTogglePreview: () => void
  children: ReactNode
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand">
          <img className="brand-mark" src={iconUrl} alt="Scripty" />
          <span className="wordmark">Scripty</span>
          <span className="brand-sep">/ {TITLES[props.section]}</span>
        </div>
        <div className="toolbar-center">
          <div className="search">
            <span className="search-dot" />
            <input
              ref={searchRef}
              placeholder="Search scenes, characters…"
              value={props.search}
              onChange={(e) => props.onSearch(e.target.value)}
            />
            <span className="kbd">⌘F</span>
          </div>
        </div>
        <div className="toolbar-right">
          {props.section === 'browse' && (
            <button
              className="prevtoggle"
              title={props.showPreview ? 'Hide preview' : 'Show preview'}
              onClick={props.onTogglePreview}
            >
              {props.showPreview ? '⇥ Hide preview' : '⇤ Show preview'}
            </button>
          )}
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
          <div className="nav-spacer" />
          <button className="navItem gear" title="Settings" onClick={props.onSettings}>
            <IconGear />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}
