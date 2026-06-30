import { useEffect, useMemo, useRef, useState } from 'react'
import { api, Scene, SceneChar, SceneDetail, sceneBlocks, isPdf, isDocx, stem } from './api'
import { PdfFrame } from './PdfFrame'
import { DocFrame } from './DocFrame'

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

// one script's matching scenes, grouped from the flat scene list
interface ScriptGroup {
  path: string
  name: string
  scenes: Scene[]
  cast: SceneChar[]
}

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
  genres,
  setGenres,
  refreshKey,
  onPrepare
}: {
  search: string
  size: number
  setSize: (n: number) => void
  pair: number
  setPair: (n: number) => void
  genres: string[]
  setGenres: (g: string[]) => void
  refreshKey: number
  onPrepare: (scene: Scene, scenes: Scene[]) => void
}) {
  const [openSize, setOpenSize] = useState(false)
  const [openPair, setOpenPair] = useState(false)
  const [openGenre, setOpenGenre] = useState(false)
  const [allGenres, setAllGenres] = useState<string[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [selScript, setSelScript] = useState<ScriptGroup | null>(null)
  const [selScene, setSelScene] = useState<Scene | null>(null)
  const [detail, setDetail] = useState<SceneDetail | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const qlToggleAt = useRef(0)
  const [qlOpen, setQlOpen] = useState(false)

  // the pop-out can be closed from its own window — keep our toggle state in sync
  useEffect(() => window.scripty.onQuickLookClosed?.(() => setQlOpen(false)), [])

  // pairing only applies to two-person scenes; show it for Any + Duet, hide for Solo / 3+
  const showPairing = size === 0 || size === DUET
  const pairValue = showPairing ? PAIR[pair][1] : null

  // group the flat matching-scene list into scripts; a script appears only if it has
  // a scene that matched the filters, and it carries just those scenes
  const scripts = useMemo<ScriptGroup[]>(() => {
    const map = new Map<string, ScriptGroup>()
    for (const s of scenes) {
      let g = map.get(s.script_path)
      if (!g) {
        g = { path: s.script_path, name: s.script_name, scenes: [], cast: [] }
        map.set(s.script_path, g)
      }
      g.scenes.push(s)
    }
    for (const g of map.values()) {
      g.scenes.sort((a, b) => a.scene_index - b.scene_index)
      const seen = new Set<string>()
      for (const sc of g.scenes)
        for (const c of sc.characters)
          if (!seen.has(c.name)) {
            seen.add(c.name)
            g.cast.push(c)
          }
    }
    return [...map.values()] // api.scenes already returns scripts in name order
  }, [scenes])

  // the genres actually assigned across the library, for the filter rail
  useEffect(() => {
    api.allGenres().then(setAllGenres).catch(() => {})
  }, [refreshKey])

  useEffect(() => {
    let active = true
    const [mn, mx] = SIZE[size][1]
    api
      .scenes({
        min_chars: mn,
        max_chars: mx,
        pairing: pairValue || undefined,
        search,
        genres: genres.length ? genres : undefined
      })
      .then((r) => {
        if (!active) return // ignore a stale response when filters/search changed
        setScenes(r.scenes)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [size, pair, search, genres, refreshKey])

  // when the result set changes, select the first script and its earliest scene
  useEffect(() => {
    setSelScript(scripts[0] || null)
    setSelScene(scripts[0]?.scenes[0] || null)
  }, [scripts])

  // pull the selected scene's dialogue so the preview shows the full scene.
  // keep the previous scene visible until the new one arrives (no "Loading…" flash)
  useEffect(() => {
    let active = true
    if (!selScene) {
      setDetail(null)
      return
    }
    const empty: SceneDetail = { heading: selScene.heading, characters: [], est_seconds: 0, lines: [], content: [] }
    api
      .getScene(selScene.script_path, selScene.scene_index)
      .then((d) => active && setDetail(d))
      .catch(() => active && setDetail(empty)) // don't hang on "Loading…" if /scene fails
    return () => {
      active = false // ignore a stale response when the selection changed
    }
  }, [selScene])

  const qlPayload = (s: Scene) => ({
    title: stem(s.script_name),
    path: s.script_path,
    sceneIndex: s.scene_index,
    page: s.page,
    isPdf: isPdf(s.script_path)
  })
  // toggle the Quick Look pop-out for the selected scene. Debounced because Space can
  // arrive from two places — the renderer keydown (DOM focused) and the main process
  // (when the PDF preview has focus) — and we never want a single press to double-fire.
  const toggleQuickLook = () => {
    const now = Date.now()
    if (now - qlToggleAt.current < 220) return
    qlToggleAt.current = now
    if (qlOpen) {
      window.scripty.quickLookClose()
      setQlOpen(false)
    } else if (selScene) {
      window.scripty.quickLook(qlPayload(selScene))
      setQlOpen(true)
    }
  }
  // Space from main (PDF preview had focus and swallowed it) → toggle Quick Look
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => window.scripty.onMainSpace?.(toggleQuickLook), [qlOpen, selScene])

  // pick a script (and reset to its earliest scene)
  const chooseScript = (g: ScriptGroup) => {
    setSelScript(g)
    const sc = g.scenes[0] || null
    setSelScene(sc)
    if (qlOpen && sc) window.scripty.quickLookUpdate(qlPayload(sc))
  }
  // pick a scene within the current script
  const chooseScene = (sc: Scene) => {
    setSelScene(sc)
    if (qlOpen) window.scripty.quickLookUpdate(qlPayload(sc))
  }

  // keyboard, Finder-style: ↑/↓ move between scripts, ←/→ step scenes within the
  // selected script, and the open pop-out follows. Space toggles the pop-out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!scripts.length) return
        e.preventDefault()
        const i = selScript ? scripts.indexOf(selScript) : -1
        const ni = e.key === 'ArrowDown' ? Math.min(scripts.length - 1, i + 1) : Math.max(0, i - 1)
        if (scripts[ni]) chooseScript(scripts[ni])
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && selScript && selScript.scenes.length > 1) {
        e.preventDefault()
        const list = selScript.scenes
        const i = selScene ? list.indexOf(selScene) : -1
        const ni = e.key === 'ArrowRight' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1)
        if (list[ni]) chooseScene(list[ni])
      } else if (e.key === ' ' && !e.repeat && el?.tagName !== 'BUTTON') {
        e.preventDefault()
        toggleQuickLook() // !e.repeat: holding Space shouldn't strobe the pop-out
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts, selScript, selScene, qlOpen])

  // keep the keyboard-selected rows visible
  useEffect(() => {
    listRef.current?.querySelector('.row.on')?.scrollIntoView({ block: 'nearest' })
  }, [selScript])
  useEffect(() => {
    navRef.current?.querySelector('.scenenav-row.on')?.scrollIntoView({ block: 'nearest' })
  }, [selScene])

  const chooseSize = (i: number) => {
    setSize(i)
    if (i === 1 || i === 3) setPair(0) // Solo / 3+ have no pairing
  }
  const toggleGenre = (g: string) =>
    setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g])

  const sizeChip = size !== 0
  const pairChip = showPairing && pair !== 0
  const hasChips = sizeChip || pairChip || genres.length > 0
  const navScenes = selScript?.scenes ?? []

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

        <div className="fsection">
          <div className="fhead" onClick={() => setOpenGenre((v) => !v)}>
            <span className="flabel">Genre</span>
            <span className="fright">
              <span className={'fsummary' + (genres.length ? ' active' : '')}>
                {genres.length ? `${genres.length} selected` : 'Any'}
              </span>
              <span className={'caret' + (openGenre ? ' open' : '')}>›</span>
            </span>
          </div>
          {openGenre &&
            (allGenres.length === 0 ? (
              <div className="fhint">Right-click a script → Edit details to tag genres.</div>
            ) : (
              <div className="chips">
                {allGenres.map((g) => (
                  <button key={g} className={'chip' + (genres.includes(g) ? ' on' : '')} onClick={() => toggleGenre(g)}>
                    {g}
                  </button>
                ))}
              </div>
            ))}
        </div>
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
                {genres.map((g) => (
                  <span key={g} className="fchip">
                    {g}
                    <span className="x" onClick={() => toggleGenre(g)}>✕</span>
                  </span>
                ))}
              </>
            ) : (
              <span>All scripts · no filters applied</span>
            )}
          </div>
          <span className="result">{scripts.length} script{scripts.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="colhead">
          <span style={{ flex: 1 }}>Script</span>
          <span style={{ width: 64 }}>Cast</span>
          <span style={{ width: 42, textAlign: 'right' }}>Scenes</span>
        </div>
        <div className="list" ref={listRef}>
          {scripts.length === 0 && <div className="empty">No scripts match these filters.</div>}
          {scripts.map((g) => (
            <div
              key={g.path}
              className={'row' + (selScript === g ? ' on' : '')}
              onClick={() => chooseScript(g)}
              onDoubleClick={() => api.openFile(g.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                chooseScript(g)
                window.scripty.rowMenu({ path: g.path, name: g.name })
              }}
            >
              <div className="main">
                <div className="title">{stem(g.name)}</div>
                <div className="sub">
                  {g.scenes.length} scene{g.scenes.length !== 1 ? 's' : ''} · {g.cast.length} character
                  {g.cast.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="cast">
                {g.cast.slice(0, 3).map((c) => (
                  <div key={c.name} className={'gchip ' + gletter(c.gender)} title={c.name}>
                    {gletter(c.gender)}
                  </div>
                ))}
              </div>
              <span className="page">{g.scenes.length}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        {selScene && selScript && (
          <>
            <div className="dtitle">{stem(selScript.name)}</div>
            <div className="dmeta">{selScene.characters.map((c) => c.name).join(', ')}</div>
            <div className="dtags">
              <span className="tag size">{sizeTag(selScene.char_count)}</span>
              {selScene.pairing && <span className="tag">{PAIR_TAG[selScene.pairing] || selScene.pairing}</span>}
            </div>
            {isPdf(selScene.script_path) ? (
              <PdfFrame path={selScene.script_path} page={selScene.page} nonce={selScene.scene_index} />
            ) : isDocx(selScene.script_path) ? (
              <DocFrame path={selScene.script_path} />
            ) : (
              <div className="dcard">
                <div className="h">{selScene.heading}</div>
                {detail === null ? <div className="dnote">Loading scene…</div> : renderBlocks(detail, false)}
              </div>
            )}

            {navScenes.length > 1 && (
              <div className="scenenav">
                <div className="scenenav-h">
                  Scenes in this script <span className="scenenav-n">{navScenes.length}</span>
                </div>
                <div className="scenenav-list" ref={navRef}>
                  {navScenes.map((sc) => (
                    <div
                      key={sc.scene_index}
                      className={'scenenav-row' + (selScene === sc ? ' on' : '')}
                      onClick={() => chooseScene(sc)}
                    >
                      <span className="sn-h">{sc.heading}</span>
                      <span className="sn-meta">
                        {sizeTag(sc.char_count)}{sc.page ? ` · p.${sc.page}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="dbtns">
              <button className="prepare" onClick={() => onPrepare(selScene, selScript.scenes)}>
                Prepare scene →
              </button>
              <button className="ghost" onClick={() => api.revealFile(selScene.script_path)}>Reveal</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
