import { useEffect, useState } from 'react'
import './styles.css'
import { init } from './api'
import { AppShell } from './AppShell'
import { BrowseView } from './BrowseView'
import { LibraryView } from './LibraryView'

export default function App() {
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState('library')
  const [search, setSearch] = useState('')
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')

  useEffect(() => {
    init().then(() => setReady(true))
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  if (!ready) return <div style={{ padding: 40 }}>Starting engine…</div>
  return (
    <AppShell
      section={section}
      onSection={setSection}
      search={search}
      onSearch={setSearch}
      theme={theme}
      onTheme={setTheme}
    >
      {section === 'browse' && <BrowseView search={search} />}
      {section === 'library' && <LibraryView />}
      {section === 'prepare' && <div style={{ padding: 40, color: 'var(--text-3)' }}>Prepare — coming soon.</div>}
    </AppShell>
  )
}
