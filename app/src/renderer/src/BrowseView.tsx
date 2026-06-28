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
const PAIR_PRETTY: Record<string, string> = { MW: 'Man + Woman', MM: 'Man + Man', WW: 'Woman + Woman', has_unknown: 'Has unknown' }

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

  const sizeChip = size !== 0
  const pairChip = pair !== 0
  const hasChips = sizeChip || pairChip

  return (
    <>
      <div className="rail">
        <div className="fsection">
          <div className="fhead">
            <span className="flabel">Scene size</span>
            <span className="fsummary">{SIZE[size][0]}</span>
          </div>
          <div className="seg-size">
            {SIZE.map(([l], i) => (
              <button key={l} className={i === size ? 'on' : ''} onClick={() => setSize(i)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="fsection">
          <div className="fhead">
            <span className="flabel">Partner pairing</span>
            <span className="fsummary">{PAIR[pair][0]}</span>
          </div>
          <div className="chips">
            {PAIR.map(([l], i) => (
              <button key={l} className={'chip' + (i === pair ? ' on' : '')} onClick={() => setPair(i)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="listpane">
        <div className="lhead">
          <div className="meta" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {hasChips ? (
              <>
                {sizeChip && (
                  <span className="fchip">{SIZE[size][0]} {SIZE[size][0] === '1' ? 'character' : 'characters'}<span className="x" onClick={() => setSize(0)}>✕</span></span>
                )}
                {pairChip && (
                  <span className="fchip">{PAIR_PRETTY[PAIR[pair][1]!]}<span className="x" onClick={() => setPair(0)}>✕</span></span>
                )}
              </>
            ) : (
              <span>All scenes · no filters applied</span>
            )}
          </div>
          <span className="result">{scenes.length} scene{scenes.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="colhead">
          <span style={{ flex: 1 }}>Scene</span>
          <span style={{ width: 64 }}>Cast</span>
          <span style={{ width: 42, textAlign: 'right' }}>Pg</span>
        </div>
        <div className="list">
          {scenes.length === 0 && <div className="empty">No scenes match these filters.</div>}
          {scenes.map((s) => (
            <div
              key={s.script_path + s.heading}
              className={'row' + (sel === s ? ' on' : '')}
              onClick={() => setSel(s)}
              onDoubleClick={() => api.openFile(s.script_path)}
            >
              <div className="main">
                <div className="title">{s.script_name.replace(/\.[^.]+$/, '')}</div>
                <div className="sub">{s.heading}{s.page ? ` · p.${s.page}` : ''}</div>
              </div>
              <div className="cast">
                {s.characters.slice(0, 3).map((c) => (
                  <div key={c.name} className={'gchip ' + gletter(c.gender)} title={c.name}>
                    {gletter(c.gender)}
                  </div>
                ))}
              </div>
              <span className="page">{s.page || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        {sel && (
          <>
            <div className="dheading">{sel.heading}</div>
            <div className="dtitle">{sel.script_name.replace(/\.[^.]+$/, '')}</div>
            <div className="dmeta">{sel.characters.map((c) => c.name).join(', ')}</div>
            <div className="dtags">
              <span className="tag size">{sel.char_count === 2 ? 'Two-hander' : `${sel.char_count} cast`}</span>
              {sel.pairing && <span className="tag">{PAIR_PRETTY[sel.pairing] || sel.pairing}</span>}
            </div>
            <div className="dcard">
              <div className="h">{sel.heading}</div>
              {sel.characters.map((c) => (
                <div key={c.name} className="cue">{c.name}</div>
              ))}
              <div className="dnote">“Open the file or Prepare the scene to read the full sides.”</div>
            </div>
            <div className="dbtns">
              <button className="prepare">Prepare scene →</button>
              <button className="ghost" onClick={() => api.openFile(sel.script_path)}>Open file</button>
              <button className="ghost" onClick={() => api.revealFile(sel.script_path)}>Reveal</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
