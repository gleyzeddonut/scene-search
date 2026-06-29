import { useEffect, useRef, useState } from 'react'
import './styles.css'
import { init, api, Scene } from './api'
import { AppShell } from './AppShell'
import { BrowseView } from './BrowseView'
import { LibraryView } from './LibraryView'
import { PrepareView } from './PrepareView'
import { SettingsModal } from './SettingsModal'

export default function App() {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [section, setSection] = useState('library')
  const [search, setSearch] = useState('')
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prepScene, setPrepScene] = useState<Scene | null>(null)
  // Browse filters live here so they persist across tab switches (this session).
  const [browseSize, setBrowseSize] = useState(0) // 0 = Any
  const [browsePair, setBrowsePair] = useState(0)
  const [toast, setToast] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const readyRef = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3800)
  }

  useEffect(() => {
    init()
      .then(() => {
        readyRef.current = true
        setReady(true)
      })
      .catch(() => setFailed(true))
    window.scripty.onOpenSettings(() => setSettingsOpen(true))
  }, [])

  // drag-and-drop a script file onto the window to add it
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      if (!readyRef.current) return
      const files = Array.from(e.dataTransfer?.files || [])
      const paths = files.map((f) => (f as File & { path?: string }).path).filter(Boolean) as string[]
      if (!paths.length) return
      const counts = { added: 0, exists: 0, bad: 0 }
      let last = ''
      for (const p of paths) {
        try {
          const r = await api.addScript(p)
          last = r.name
          if (r.result === 'added') counts.added++
          else if (r.result === 'exists') counts.exists++
          else counts.bad++
        } catch {
          counts.bad++
        }
      }
      if (paths.length === 1) {
        if (counts.added) showToast(`Added “${last}”`)
        else if (counts.exists) showToast(`“${last}” has already been added`)
        else showToast(`“${last}” isn’t a readable script`)
      } else {
        const parts = []
        if (counts.added) parts.push(`${counts.added} added`)
        if (counts.exists) parts.push(`${counts.exists} already added`)
        if (counts.bad) parts.push(`${counts.bad} skipped`)
        showToast(parts.join(' · '))
      }
      if (counts.added) setRefreshKey((k) => k + 1)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
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

  if (failed)
    return (
      <div style={{ padding: 40, lineHeight: 1.5 }}>
        Couldn’t start the Scripty engine. Please quit and reopen Scripty.
      </div>
    )
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
          refreshKey={refreshKey}
          onPrepare={(s) => {
            setPrepScene(s)
            setSection('prepare')
          }}
        />
      )}
      {section === 'library' && <LibraryView refreshKey={refreshKey} />}
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
    {toast && <div className="toast">{toast}</div>}
    </>
  )
}
