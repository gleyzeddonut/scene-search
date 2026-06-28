import { useEffect, useState } from 'react'
import { api } from './api'
import { IconFolder } from './icons'

export function LibraryView() {
  const [roots, setRoots] = useState<string[]>([])
  const [stats, setStats] = useState({ scripts: 0, scenes: 0 })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setRoots((await api.getFolders()).roots)
    setStats(await api.stats())
  }
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    const f = await api.pickFolder()
    if (f && !roots.includes(f)) {
      const next = [...roots, f]
      setRoots(next)
      await api.setFolders(next, [])
    }
  }
  const remove = async (p: string) => {
    const next = roots.filter((r) => r !== p)
    setRoots(next)
    await api.setFolders(next, [])
  }
  const reindex = async () => {
    setBusy(true)
    setStatus('Indexing…')
    await api.reindex()
    const poll = setInterval(async () => {
      const st = await api.reindexStatus()
      setStatus(`Indexing… ${st.scenes} scenes parsed`)
      if (!st.running) {
        clearInterval(poll)
        setBusy(false)
        setStatus('')
        setStats(st)
      }
    }, 300)
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
          <button className="go" onClick={reindex} disabled={busy}>{busy ? 'Indexing…' : 'Re-index now'}</button>
        </div>

        <div className="libnote">
          Reads <span className="mono">.pdf .fountain .fdx .txt .docx</span> · detects screenplays by
          INT./EXT. headings, character cues and dialogue · re-downloaded copies fold into one stack ·
          scanned image-only PDFs can't be read.
        </div>
      </div>
    </div>
  )
}
