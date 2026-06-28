import { useEffect, useState } from 'react'
import { api, Scene } from './api'

const SIZE: [string, [number, number]][] = [
  ['Any', [0, 50]],
  ['1', [1, 1]],
  ['2', [2, 2]],
  ['3', [3, 3]],
  ['4+', [4, 50]]
]
const PAIR: [string, string | null][] = [
  ['Any', null],
  ['M+W', 'MW'],
  ['M+M', 'MM'],
  ['W+W', 'WW'],
  ['?', 'has_unknown']
]

function gletter(g: string) {
  return g === 'female' ? 'W' : g === 'male' ? 'M' : 'U'
}

export function BrowseView({ search }: { search: string }) {
  const [size, setSize] = useState(2)
  const [pair, setPair] = useState(0)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sel, setSel] = useState<Scene | null>(null)

  useEffect(() => {
    const [mn, mx] = SIZE[size][1]
    api
      .scenes({ min_chars: mn, max_chars: mx, pairing: PAIR[pair][1] || undefined, search })
      .then((r) => {
        setScenes(r.scenes)
        setSel(r.scenes[0] || null)
      })
  }, [size, pair, search])

  return (
    <>
      <div className="rail">
        <div className="section-label">Scene size</div>
        <div className="chips">
          {SIZE.map(([l], i) => (
            <button key={l} className={'chip' + (i === size ? ' on' : '')} onClick={() => setSize(i)}>
              {l}
            </button>
          ))}
        </div>
        <div className="section-label">Partner pairing</div>
        <div className="chips">
          {PAIR.map(([l], i) => (
            <button key={l} className={'chip' + (i === pair ? ' on' : '')} onClick={() => setPair(i)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="list-pane">
        <div className="list-head">
          {scenes.length} scene{scenes.length !== 1 ? 's' : ''}
        </div>
        <div className="list">
          {scenes.map((s) => (
            <div
              key={s.script_path + s.heading}
              className={'row' + (sel === s ? ' on' : '')}
              onClick={() => setSel(s)}
              onDoubleClick={() => api.openFile(s.script_path)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="title">{s.script_name.replace(/\.[^.]+$/, '')}</div>
                <div className="sub">
                  {s.heading}
                  {s.page ? ` · p.${s.page}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {s.characters.slice(0, 3).map((c) => (
                  <div key={c.name} className={'gchip ' + gletter(c.gender)} title={c.name}>
                    {gletter(c.gender)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        {sel && (
          <>
            <div className="detail-heading">{sel.heading}</div>
            <div className="detail-title">{sel.script_name.replace(/\.[^.]+$/, '')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="tag">{sel.char_count === 2 ? 'Two-hander' : `${sel.char_count} cast`}</span>
              {sel.pairing && <span className="tag">{sel.pairing}</span>}
            </div>
            <div className="card">
              <div className="detail-heading">{sel.heading}</div>
              {sel.characters.map((c) => (
                <div
                  key={c.name}
                  style={{ textAlign: 'center', fontFamily: 'Courier Prime, monospace', marginTop: 10 }}
                >
                  {c.name}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button className="btn primary" style={{ flex: 1 }}>
                Prepare scene →
              </button>
              <button className="btn" onClick={() => api.openFile(sel.script_path)}>
                Open file
              </button>
              <button className="btn" onClick={() => api.revealFile(sel.script_path)}>
                Reveal
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
