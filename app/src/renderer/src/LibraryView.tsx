import { useEffect, useState } from 'react'
import { api } from './api'

export function LibraryView() {
  const [roots, setRoots] = useState<string[]>([])
  const [stats, setStats] = useState({ scripts: 0, scenes: 0 })
  const [status, setStatus] = useState('')

  const load = async () => {
    setRoots((await api.getFolders()).roots)
    setStats(await api.stats())
  }
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    const f = await api.pickFolder()
    if (f) {
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
    setStatus('Indexing…')
    await api.reindex()
    const poll = setInterval(async () => {
      const st = await api.reindexStatus()
      setStatus(`Indexing… ${st.scenes} scenes`)
      if (!st.running) {
        clearInterval(poll)
        setStatus(`Indexed: ${st.scripts} scripts, ${st.scenes} scenes`)
        setStats(st)
      }
    }, 300)
  }

  return (
    <div className="libwrap">
      <div style={{ fontSize: 22, fontWeight: 700 }}>Library</div>
      <div style={{ color: 'var(--text-3)' }}>
        Scripty indexes the script files on your drive — nothing leaves your Mac.
      </div>
      <div className="stats">
        <div className="stat">
          <div className="n">{stats.scripts}</div>
          <div className="l">scripts indexed</div>
        </div>
        <div className="stat">
          <div className="n">{stats.scenes}</div>
          <div className="l">scenes parsed</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0' }}>
        <div className="section-label">Indexed folders</div>
        <button className="btn" onClick={add}>
          ＋ Add folder…
        </button>
      </div>
      <div className="folders">
        {roots.map((r) => (
          <div className="folder" key={r}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="path">{r}</div>
            </div>
            <button className="btn" onClick={() => remove(r)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div style={{ margin: '16px 0', color: 'var(--text-3)' }}>{status}</div>
      <button className="btn primary" onClick={reindex}>
        Re-index now
      </button>
    </div>
  )
}
