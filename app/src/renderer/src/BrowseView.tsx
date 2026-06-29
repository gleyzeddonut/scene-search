import { useEffect, useState } from 'react'
import { api, Scene, SceneDetail, sceneBlocks, isPdf, pdfUrl } from './api'

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

function renderBlocks(detail: SceneDetail, dialogueOnly: boolean) {
  let blocks = sceneBlocks(detail)
  if (dialogueOnly) blocks = blocks.filter((b) => b.type === 'cue')
  if (blocks.length === 0)
    return <div className="dnote">No text could be read from this scene. Open the file to view it.</div>
  return blocks.map((b, i) =>
    b.type === 'cue' ? (
      <div key={i}>
        <div className="dcue">{b.who}</div>
        <div className="dtext">{b.text}</div>
      </div>
    ) : (
      <div key={i} className="daction">{b.text}</div>
    )
  )
}

export function BrowseView({
  search,
  size,
  setSize,
  pair,
  setPair,
  refreshKey,
  onPrepare
}: {
  search: string
  size: number
  setSize: (n: number) => void
  pair: number
  setPair: (n: number) => void
  refreshKey: number
  onPrepare: (s: Scene) => void
}) {
  const [openSize, setOpenSize] = useState(false)
  const [openPair, setOpenPair] = useState(false)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sel, setSel] = useState<Scene | null>(null)
  const [detail, setDetail] = useState<SceneDetail | null>(null)
  const [view, setViewState] = useState(localStorage.getItem('sceneView') || 'pdf')
  const setView = (v: string) => {
    setViewState(v)
    localStorage.setItem('sceneView', v)
  }

  // pairing only applies to two-person scenes; show it for Any + Duet, hide for Solo / 3+
  const showPairing = size === 0 || size === DUET
  const pairValue = showPairing ? PAIR[pair][1] : null

  useEffect(() => {
    const [mn, mx] = SIZE[size][1]
    api
      .scenes({ min_chars: mn, max_chars: mx, pairing: pairValue || undefined, search })
      .then((r) => {
        setScenes(r.scenes)
        setSel(r.scenes[0] || null)
      })
  }, [size, pair, search, refreshKey])

  // pull the selected scene's dialogue so the preview shows the full scene
  useEffect(() => {
    let active = true
    setDetail(null)
    if (sel) {
      const empty: SceneDetail = { heading: sel.heading, characters: [], est_seconds: 0, lines: [], content: [] }
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
    if (i === 1 || i === 3) setPair(0) // Solo / 3+ have no pairing
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
            {(() => {
              const pdfOk = isPdf(sel.script_path)
              const eff = view === 'pdf' && !pdfOk ? 'full' : view
              return (
                <>
                  <div className="dtags">
                    <span className="tag size">{sizeTag(sel.char_count)}</span>
                    {sel.pairing && <span className="tag">{PAIR_TAG[sel.pairing] || sel.pairing}</span>}
                    <span className="vtoggle">
                      {pdfOk && (
                        <span className={eff === 'pdf' ? 'on' : ''} onClick={() => setView('pdf')}>PDF</span>
                      )}
                      <span className={eff === 'full' ? 'on' : ''} onClick={() => setView('full')}>Full scene</span>
                      <span className={eff === 'dialogue' ? 'on' : ''} onClick={() => setView('dialogue')}>Dialogue</span>
                    </span>
                  </div>
                  {eff === 'pdf' ? (
                    <iframe className="pdfframe" src={pdfUrl(sel.script_path, sel.page)} title="Script PDF" />
                  ) : (
                    <div className="dcard">
                      <div className="h">{sel.heading}</div>
                      {detail === null ? (
                        <div className="dnote">Loading scene…</div>
                      ) : (
                        renderBlocks(detail, eff === 'dialogue')
                      )}
                    </div>
                  )}
                </>
              )
            })()}
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
