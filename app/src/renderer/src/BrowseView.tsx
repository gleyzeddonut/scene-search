import { useEffect, useState } from 'react'
import { api, Scene, SceneDetail } from './api'

// Semantic size labels (matches the Cue handoff). Values map to char-count range.
const SIZE: [string, [number, number]][] = [
  ['Any', [0, 50]],
  ['Solo', [1, 1]],
  ['Duet', [2, 2]],
  ['3+', [3, 50]]
]
const SIZE_CHIP = ['', 'Solo', 'Duet', 'Ensemble']
const DUET = 2 // index of the Duet option

const PAIR: [string, string | null][] = [
  ['Any', null],
  ['W + M', 'MW'],
  ['W + W', 'WW'],
  ['M + M', 'MM']
]
const PAIR_TAG: Record<string, string> = { MW: 'W + M', WW: 'W + W', MM: 'M + M', has_unknown: 'Mixed / unknown' }

function gletter(g: string) {
  return g === 'female' ? 'W' : g === 'male' ? 'M' : 'U'
}
function sizeTag(n: number) {
  return n === 1 ? 'Solo' : n === 2 ? 'Duet' : n >= 3 ? 'Ensemble' : 'No dialogue'
}

export function BrowseView({
  search,
  size,
  setSize,
  pair,
  setPair,
  onPrepare
}: {
  search: string
  size: number
  setSize: (n: number) => void
  pair: number
  setPair: (n: number) => void
  onPrepare: (s: Scene) => void
}) {
  const [openSize, setOpenSize] = useState(false)
  const [openPair, setOpenPair] = useState(false)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sel, setSel] = useState<Scene | null>(null)
  const [detail, setDetail] = useState<SceneDetail | null>(null)

  const showPairing = size === DUET
  const pairValue = showPairing ? PAIR[pair][1] : null

  useEffect(() => {
    const [mn, mx] = SIZE[size][1]
    api
      .scenes({ min_chars: mn, max_chars: mx, pairing: pairValue || undefined, search })
      .then((r) => {
        setScenes(r.scenes)
        setSel(r.scenes[0] || null)
      })
  }, [size, pair, search])

  // pull the selected scene's dialogue so the preview shows the full scene
  useEffect(() => {
    let active = true
    setDetail(null)
    if (sel) {
      const empty: SceneDetail = { heading: sel.heading, characters: [], est_seconds: 0, lines: [] }
      api
        .getScene(sel.script_path, sel.scene_index)
        .then((d) => active && setDetail(d))
        .catch(() => active && setDetail(empty)) // don't hang on "Loading…" if /scene fails
    }
    return () => {
      active = false // ignore a stale response when the selection changed
    }
  }, [sel])

  const chooseSize = (i: number) => {
    setSize(i)
    if (i !== DUET) setPair(0) // pairing only applies to duets
  }

  const sizeChip = size !== 0
  const pairChip = showPairing && pair !== 0
  const hasChips = sizeChip || pairChip

  return (
    <>
      <div className="rail">
        <div className="fsection">
          <div className="fhead" onClick={() => setOpenSize((v) => !v)}>
            <span className="flabel">Scene size</span>
            <span className="fright">
              <span className={'fsummary' + (size !== 0 ? ' active' : '')}>{SIZE[size][0]}</span>
              <span className={'caret' + (openSize ? ' open' : '')}>›</span>
            </span>
          </div>
          {openSize && (
            <div className="seg-size">
              {SIZE.map(([l], i) => (
                <button key={l} className={i === size ? 'on' : ''} onClick={() => chooseSize(i)}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>

        {showPairing && (
          <div className="fsection">
            <div className="fhead" onClick={() => setOpenPair((v) => !v)}>
              <span className="flabel">Partner pairing</span>
              <span className="fright">
                <span className={'fsummary' + (pair !== 0 ? ' active' : '')}>{PAIR[pair][0]}</span>
                <span className={'caret' + (openPair ? ' open' : '')}>›</span>
              </span>
            </div>
            {openPair && (
              <div className="chips">
                {PAIR.map(([l], i) => (
                  <button key={l} className={'chip' + (i === pair ? ' on' : '')} onClick={() => setPair(i)}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="listpane">
        <div className="lhead">
          <div className="meta" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {hasChips ? (
              <>
                {sizeChip && (
                  <span className="fchip">
                    {SIZE_CHIP[size]}
                    <span className="x" onClick={() => chooseSize(0)}>✕</span>
                  </span>
                )}
                {pairChip && (
                  <span className="fchip">
                    {PAIR[pair][0]}
                    <span className="x" onClick={() => setPair(0)}>✕</span>
                  </span>
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
              <span className="tag size">{sizeTag(sel.char_count)}</span>
              {sel.pairing && <span className="tag">{PAIR_TAG[sel.pairing] || sel.pairing}</span>}
            </div>
            <div className="dcard">
              <div className="h">{sel.heading}</div>
              {detail === null ? (
                <div className="dnote">Loading scene…</div>
              ) : detail.lines.length === 0 ? (
                <div className="dnote">No dialogue could be read from this scene. Open the file to view it.</div>
              ) : (
                detail.lines.map((l, i) => (
                  <div key={i}>
                    <div className="dcue">{l.who}</div>
                    <div className="dtext">{l.text}</div>
                  </div>
                ))
              )}
            </div>
            <div className="dbtns">
              <button className="prepare" onClick={() => onPrepare(sel)}>Prepare scene →</button>
            </div>
            <div className="dbtns">
              <button className="ghost" onClick={() => api.openFile(sel.script_path)}>Open file</button>
              <button className="ghost" onClick={() => api.revealFile(sel.script_path)}>Reveal</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
