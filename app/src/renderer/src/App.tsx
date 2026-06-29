import { useEffect, useState } from 'react'
import './styles.css'
import { init, Scene } from './api'
import { AppShell } from './AppShell'
import { BrowseView } from './BrowseView'
import { LibraryView } from './LibraryView'
import { PrepareView } from './PrepareView'
import { SettingsModal } from './SettingsModal'

export default function App() {
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState('library')
  const [search, setSearch] = useState('')
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prepScene, setPrepScene] = useState<Scene | null>(null)

  useEffect(() => {
    init().then(() => setReady(true))
    window.scripty.onOpenSettings(() => setSettingsOpen(true))
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  if (!ready) return <div style={{ padding: 40 }}>Starting engine…</div>
  return (
    <>
    <AppShell
      section={section}
      onSection={setSection}
      search={search}
      onSearch={setSearch}
      theme={theme}
      onTheme={setTheme}
      onSettings={() => setSettingsOpen(true)}
    >
      {section === 'browse' && (
        <BrowseView
          search={search}
          onPrepare={(s) => {
            setPrepScene(s)
            setSection('prepare')
          }}
        />
      )}
      {section === 'library' && <LibraryView />}
      {section === 'prepare' && prepScene && (
        <PrepareView scene={prepScene} onBack={() => setSection('browse')} />
      )}
      {section === 'prepare' && !prepScene && (
        <div style={{ padding: 40, color: 'var(--text-3)' }}>
          Select a scene in Browse, then “Prepare scene →”.
        </div>
      )}
    </AppShell>
    {settingsOpen && (
      <SettingsModal theme={theme} onTheme={setTheme} onClose={() => setSettingsOpen(false)} />
    )}
    </>
  )
}
