import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { IconFolder } from './icons'

export function LibraryView({ refreshKey }: { refreshKey: number }) {
  const [roots, setRoots] = useState<string[]>([])
  const [stats, setStats] = useState({ scripts: 0, scenes: 0 })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [unreadable, setUnreadable] = useState<string[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.reindexStatus()
        if (!st.running) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setBusy(false)
          setStatus('')
          setStats(st)
          setUnreadable(st.errors || [])
        } else {
          setStatus(`Indexing… ${st.scanned} files scanned`)
        }
      } catch {
        // transient engine hiccup — keep polling so we still detect the finish
      }
    }, 300)
  }

  const load = async () => {
    setRoots((await api.getFolders()).roots)
    setStats(await api.stats())
    // the engine indexes in the background — if it's still running (e.g. we
    // navigated away and came back), show progress and resume polling.
    const st = await api.reindexStatus()
    if (st.running) {
      setBusy(true)
      setStatus(`Indexing… ${st.scanned} files scanned`)
      startPolling()
    }
  }
  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // reload stats when a script is dropped in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const add = async () => {
    const f = await api.pickFolder()
    if (f && !roots.includes(f)) {
      const next = [...roots, f]
      setRoots(next)
      setStatus('')
      await api.setFolders(next, [])
    }
  }
  const remove = async (p: string) => {
    const next = roots.filter((r) => r !== p)
    setRoots(next)
    await api.setFolders(next, [])
  }
  const reindex = async () => {
    if (roots.length === 0) {
      setStatus('Add a folder first')
      return
    }
    setBusy(true)
    setStatus('Indexing…')
    setUnreadable([])
    await api.reindex()
    startPolling()
  }
  const stop = async () => {
    setStatus('Stopping…')
    try {
      await api.reindexStop()
    } catch {
      // ignore — the poll below will still pick up when it ends
    }
    if (!pollRef.current) startPolling() // make sure we detect the finish
  }

  return (
    <div className="libwrap">
      <div className="libinner">
        <div className="libtitle">Library</div>
        <div className="libblurb">
          Scripty indexes the script files already on your drive — nothing leaves your Mac. Point it at
          the folders where your scripts live, then index to make every scene searchable offline.
        </div>

        <div className="stats">
          <div className="stat"><div className="n">{stats.scripts}</div><div className="l">scripts indexed</div></div>
          <div className="stat"><div className="n">{stats.scenes.toLocaleString()}</div><div className="l">scenes parsed</div></div>
          <div className="stat"><div className="n accent">{roots.length}</div><div className="l">folders indexed</div></div>
        </div>

        <div className="libhead">
          <span className="lab">Indexed folders</span>
          <button className="smallbtn" onClick={add}>＋ Add folder…</button>
        </div>
        <div className="folders">
          {roots.map((r) => (
            <div className="folder" key={r}>
              <div className="ficon"><IconFolder /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.split('/').pop()}</div>
                <div className="path">{r}</div>
              </div>
              <span className="rm" onClick={() => remove(r)}>Remove</span>
            </div>
          ))}
        </div>

        <div className="banner">
          <div style={{ flex: 1 }}>
            <div className="t">{status || (busy ? 'Indexing…' : 'Index your library')}</div>
            <div className="s">Re-indexing only re-reads files that changed.</div>
          </div>
          <button className="go" onClick={busy ? stop : reindex}>{busy ? 'Stop indexing' : 'Re-index now'}</button>
        </div>

        {unreadable.length > 0 && (
          <div className="warnbox">
            <div className="wt">⚠ Couldn’t read {unreadable.length} folder{unreadable.length > 1 ? 's' : ''}</div>
            <div className="ws">
              macOS may be blocking access. Grant Scripty permission in System Settings → Privacy &
              Security → Files and Folders (or Full Disk Access), then re-index.
            </div>
            {unreadable.slice(0, 6).map((p) => (
              <div className="wpath" key={p}>{p}</div>
            ))}
          </div>
        )}

        <div className="libnote">
          Reads <span className="mono">.pdf .fountain .fdx .txt .docx</span> · detects screenplays by
          INT./EXT. headings, character cues and dialogue · re-downloaded copies fold into one stack ·
          scanned image-only PDFs can't be read.
        </div>
      </div>
    </div>
  )
}
