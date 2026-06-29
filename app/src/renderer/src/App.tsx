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
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prepScene, setPrepScene] = useState<Scene | null>(null)
  // Browse filters live here so they persist across tab switches (this session).
  const [browseSize, setBrowseSize] = useState(0) // 0 = Any
  const [browsePair, setBrowsePair] = useState(0)

  useEffect(() => {
    init().then(() => setReady(true))
    window.scripty.onOpenSettings(() => setSettingsOpen(true))
  }, [])
  useEffect(() => {
    localStorage.setItem('theme', theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const eff = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
      document.documentElement.setAttribute('data-theme', eff)
    }
    apply()
    if (theme === 'system') {
      mq.addEventListener('change', apply) // follow OS changes live
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  if (!ready) return <div style={{ padding: 40 }}>Starting engine…</div>
  return (
    <>
    <AppShell
      section={section}
      onSection={setSection}
      search={search}
      onSearch={setSearch}
      onSettings={() => setSettingsOpen(true)}
    >
      {section === 'browse' && (
        <BrowseView
          search={search}
          size={browseSize}
          setSize={setBrowseSize}
          pair={browsePair}
          setPair={setBrowsePair}
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
