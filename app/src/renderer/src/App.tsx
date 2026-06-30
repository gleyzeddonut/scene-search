import { useEffect, useRef, useState } from 'react'
import './styles.css'
import { api, Scene } from './api'
import { AppShell } from './AppShell'
import { BrowseView } from './BrowseView'
import { LibraryView } from './LibraryView'
import { PrepareView } from './PrepareView'
import { SettingsModal } from './SettingsModal'
import { RenameModal } from './RenameModal'
import { EditDetailsModal } from './EditDetailsModal'
import { Splash } from './Splash'

export default function App() {
  const [ready, setReady] = useState(false)
  const [splashOut, setSplashOut] = useState(false)
  const [splashDone, setSplashDone] = useState(false)
  const [section, setSection] = useState('library')
  const sectionRef = useRef('library') // latest section for the long-lived focus reporter
  const [search, setSearch] = useState('')
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  const [editing, setEditing] = useState<{ path: string; name: string } | null>(null)
  const [prepScene, setPrepScene] = useState<Scene | null>(null)
  const [prepScenes, setPrepScenes] = useState<Scene[]>([]) // the script's matching scenes, for the Prepare switcher
  // Browse filters live here so they persist across tab switches (this session).
  const [browseSize, setBrowseSize] = useState(0) // 0 = Any
  const [browsePair, setBrowsePair] = useState(0)
  const [browseGenres, setBrowseGenres] = useState<string[]>([])
  const [browseMediums, setBrowseMediums] = useState<string[]>([])
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
    readyRef.current = true // engine is in-process; always available
    setReady(true)
    window.scripty.onOpenSettings(() => setSettingsOpen(true))
    // open straight to Browse when the library already has scripts; only land on
    // Library (the setup screen) for a fresh/empty library
    api
      .stats()
      .then((s) => {
        if (s.scripts > 0) setSection('browse')
      })
      .catch(() => {})
    // from a row's right-click menu
    const offRename = window.scripty.onRenameRequest?.((p) => setRenaming(p))
    const offEdit = window.scripty.onEditDetails?.((p) => setEditing(p))
    return () => {
      offRename?.()
      offEdit?.()
    }
  }, [])

  useEffect(() => {
    sectionRef.current = section
  }, [section])

  // tell main what has keyboard focus so it knows when to reclaim Space from the
  // embedded PDF preview (which otherwise scrolls instead of toggling Quick Look).
  // Only the Browse preview counts as 'pdf' — in Prepare, Space should scroll the
  // sides as usual, so its PDF reports 'other'.
  useEffect(() => {
    let last = ''
    const report = () => {
      const a = document.activeElement as HTMLElement | null
      const cat = !a
        ? 'other'
        : a.tagName === 'IFRAME'
          ? sectionRef.current === 'browse'
            ? 'pdf'
            : 'other'
          : a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable
            ? 'text'
            : 'other'
      if (cat !== last) {
        last = cat
        window.scripty.setFocusCat?.(cat as 'pdf' | 'text' | 'other')
      }
    }
    report()
    const onBlur = () => setTimeout(report, 0) // the PDF iframe stealing focus blurs the window
    window.addEventListener('focusin', report)
    window.addEventListener('focus', report)
    window.addEventListener('blur', onBlur)
    const id = setInterval(report, 250) // safety net for the PDF plugin's focus quirks
    return () => {
      window.removeEventListener('focusin', report)
      window.removeEventListener('focus', report)
      window.removeEventListener('blur', onBlur)
      clearInterval(id)
    }
  }, [])

  // splash: once ready, keep it briefly so it's seen, then fade out (.5s) + unmount
  useEffect(() => {
    if (!ready) return
    const t1 = setTimeout(() => setSplashOut(true), 1300)
    const t2 = setTimeout(() => setSplashDone(true), 1800)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [ready])

  // drag-and-drop a script file onto the window to add it
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      if (!readyRef.current) return
      const files = Array.from(e.dataTransfer?.files || [])
      const items = files
        .map((f) => ({ path: window.scripty.pathForFile(f) || (f as File & { path?: string }).path || '', name: f.name }))
        .filter((it) => it.path)
      if (!items.length) {
        showToast('Couldn’t read the dropped file’s location')
        return
      }
      const counts = { added: 0, exists: 0, notScript: 0, err: 0 }
      let last = ''
      for (const it of items) {
        last = it.name // File.name is always the basename, so never empty
        try {
          const r = await api.addScript(it.path)
          if (r.result === 'added') counts.added++
          else if (r.result === 'exists') counts.exists++
          else counts.notScript++
        } catch {
          counts.err++
        }
      }
      if (items.length === 1) {
        if (counts.added) showToast(`Added “${last}”`)
        else if (counts.exists) showToast(`“${last}” has already been added`)
        else if (counts.err) showToast(`Couldn’t add “${last}” — try reopening Scripty`)
        else showToast(`“${last}” isn’t a readable script`)
      } else {
        const parts: string[] = []
        if (counts.added) parts.push(`${counts.added} added`)
        if (counts.exists) parts.push(`${counts.exists} already added`)
        if (counts.notScript + counts.err) parts.push(`${counts.notScript + counts.err} skipped`)
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

  return (
    <>
    {ready && (
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
              genres={browseGenres}
              setGenres={setBrowseGenres}
              mediums={browseMediums}
              setMediums={setBrowseMediums}
              refreshKey={refreshKey}
              onPrepare={(s, list) => {
                setPrepScene(s)
                setPrepScenes(list)
                setSection('prepare')
              }}
            />
          )}
          {section === 'library' && <LibraryView refreshKey={refreshKey} />}
          {section === 'prepare' && prepScene && (
            <PrepareView scene={prepScene} scenes={prepScenes} onBack={() => setSection('browse')} />
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
        {renaming && (
          <RenameModal
            path={renaming.path}
            name={renaming.name}
            onClose={() => setRenaming(null)}
            onDone={(msg) => {
              setRenaming(null)
              showToast(msg)
              setRefreshKey((k) => k + 1) // re-read the library so the new name shows
            }}
          />
        )}
        {editing && (
          <EditDetailsModal
            path={editing.path}
            name={editing.name}
            onClose={() => setEditing(null)}
            onDone={(msg) => {
              setEditing(null)
              showToast(msg)
              setRefreshKey((k) => k + 1) // re-read scenes + genre list with the new metadata
            }}
          />
        )}
        {toast && <div className="toast">{toast}</div>}
      </>
    )}
    {!splashDone && <Splash out={splashOut} />}
    </>
  )
}
