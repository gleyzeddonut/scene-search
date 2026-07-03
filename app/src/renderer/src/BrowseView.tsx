import { useEffect, useMemo, useRef, useState } from 'react'
import { api, Scene, SceneChar, SceneDetail, sceneBlocks, isPdf, isDocx, isPlainText, stem, mmss } from './api'
import { PdfFrame } from './PdfFrame'
import { DocFrame } from './DocFrame'
import { TextFrame } from './TextFrame'
import { RowMetaEditor } from './RowMetaEditor'
import { IconSortUp, IconSortDown, IconChevron } from './icons'

// Cast-size options. "Monologue" is not a size — it filters scripts that contain a
// substantial solo speech (server-side); the others map to a total-cast range.
type SizeOpt = { label: string; range?: [number, number]; mono?: boolean }
const SIZE: SizeOpt[] = [
  { label: 'Any', range: [0, 50] },
  { label: 'Monologue', mono: true },
  { label: 'Duet', range: [2, 2] },
  { label: 'Ensemble', range: [3, 50] }
]
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
  genres: string[]
  medium: string | null
  added: number
  monologue: { who: string; seconds: number; scene: number } | null
  foldedInto: string | null // duplicate of this rep path → hidden behind its chevron
}

// optional list columns the user can show/hide by right-clicking the header (Script
// is always shown). Persisted in localStorage.
type ColKey = 'genre' | 'medium' | 'cast' | 'scenes'
const COLS: { key: ColKey; label: string }[] = [
  { key: 'genre', label: 'Genre' },
  { key: 'medium', label: 'Medium' },
  { key: 'cast', label: 'Cast' },
  { key: 'scenes', label: 'Scenes' }
]
function loadCols(): Record<ColKey, boolean> {
  let saved: Partial<Record<ColKey, boolean>> = {}
  try {
    saved = JSON.parse(localStorage.getItem('browseCols') || '{}')
  } catch {
    saved = {}
  }
  return { genre: saved.genre !== false, medium: saved.medium !== false, cast: saved.cast !== false, scenes: saved.scenes !== false }
}

// list sort — by any column; counts/date default to descending, text to ascending
type SortKey = 'name' | 'genre' | 'medium' | 'cast' | 'scenes' | 'added'
interface Sort { key: SortKey; dir: 'asc' | 'desc' }
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'added', label: 'Date added' },
  { key: 'genre', label: 'Genre' },
  { key: 'medium', label: 'Medium' },
  { key: 'cast', label: 'Cast' },
  { key: 'scenes', label: 'Scenes' }
]
const defaultDir = (k: SortKey): 'asc' | 'desc' =>
  k === 'cast' || k === 'scenes' || k === 'added' ? 'desc' : 'asc'
function loadSort(): Sort {
  try {
    const s = JSON.parse(localStorage.getItem('browseSort') || '')
    if (s && s.key) return { key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc' }
  } catch {
    /* default below */
  }
  return { key: 'name', dir: 'asc' }
}
function sortGroups(groups: ScriptGroup[], sort: Sort): ScriptGroup[] {
  const f = sort.dir === 'desc' ? -1 : 1
  return [...groups].sort((a, b) => {
    if (sort.key === 'added') return ((a.added || 0) - (b.added || 0)) * f || a.name.localeCompare(b.name)
    if (sort.key === 'cast') return (a.cast.length - b.cast.length) * f || a.name.localeCompare(b.name)
    if (sort.key === 'scenes') return (a.scenes.length - b.scenes.length) * f || a.name.localeCompare(b.name)
    if (sort.key === 'genre' || sort.key === 'medium') {
      const av = sort.key === 'genre' ? a.genres[0] || '' : a.medium || ''
      const bv = sort.key === 'genre' ? b.genres[0] || '' : b.medium || ''
      if (!av !== !bv) return av ? -1 : 1 // untagged always sorts last
      return av.localeCompare(bv) * f || a.name.localeCompare(b.name)
    }
    return a.name.localeCompare(b.name) * f
  })
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
  mediums,
  setMediums,
  showPreview,
  selRef,
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
  mediums: string[]
  setMediums: (m: string[]) => void
  showPreview: boolean
  // remembers the selected script across tab switches (lives in App so it survives
  // this view unmounting when you go to Prepare), so Back returns to the same script
  selRef: React.MutableRefObject<{ path: string; index: number } | null>
  refreshKey: number
  onPrepare: (scene: Scene, scenes: Scene[]) => void
}) {
  const [openSize, setOpenSize] = useState(false)
  const [openPair, setOpenPair] = useState(false)
  const [openGenre, setOpenGenre] = useState(false)
  const [openMedium, setOpenMedium] = useState(false)
  const [allGenres, setAllGenres] = useState<string[]>([])
  const [allMediums, setAllMediums] = useState<string[]>([])
  // inline genre/medium editor anchored to a row cell
  const [metaEdit, setMetaEdit] = useState<{ path: string; kind: 'genre' | 'medium'; rect: DOMRect } | null>(null)
  // which list columns are shown (right-click the header to toggle); persisted
  const [cols, setColsState] = useState<Record<ColKey, boolean>>(loadCols)
  const setCol = (k: ColKey, v: boolean) =>
    setColsState((c) => {
      const next = { ...c, [k]: v }
      localStorage.setItem('browseCols', JSON.stringify(next))
      return next
    })
  const [colMenu, setColMenu] = useState<{ x: number; y: number } | null>(null)
  const [sort, setSortState] = useState<Sort>(loadSort)
  const setSort = (key: SortKey) =>
    setSortState((prev) => {
      // clicking the active column flips direction; a new column uses its default
      const next: Sort = { key, dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : defaultDir(key) }
      localStorage.setItem('browseSort', JSON.stringify(next))
      return next
    })
  const [sortMenu, setSortMenu] = useState<DOMRect | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [selScript, setSelScript] = useState<ScriptGroup | null>(null)
  const [selScene, setSelScene] = useState<Scene | null>(null)
  // whether the selected scene was EXPLICITLY picked (scene navigator / arrow keys).
  // Only then do the preview and Quick Look scroll to it — selecting a script shows
  // the top of the file, like Finder would.
  const [sceneJump, setSceneJump] = useState(false)
  const [detail, setDetail] = useState<SceneDetail | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const qlToggleAt = useRef(0)
  // set when a fresh query result lands, so the selection-reset effect resets ONLY
  // then — not when an inline edit patches the scene list in place (which would
  // otherwise snap the selection back to the top)
  const freshResult = useRef(true)
  // the script to select when the NEXT result set lands — coming Back from Prepare
  // (captured once on mount), or the representative after a Join/Separate, so the
  // list doesn't snap to the top and lose the user's place
  const restoreRef = useRef<{ path: string; index: number; jump?: boolean } | null>(selRef.current)
  const [qlOpen, setQlOpen] = useState(false)

  // the pop-out can be closed from its own window — keep our toggle state in sync
  useEffect(() => window.scripty.onQuickLookClosed?.(() => setQlOpen(false)), [])

  // pairing only applies to two-person scenes; show it for Any + Duet, hide for Solo / 3+
  const showPairing = size === 0 || size === DUET
  const monoActive = !!SIZE[size].mono // the "Monologue" filter is on → show the row hint
  const pairValue = showPairing ? PAIR[pair][1] : null

  // group the flat matching-scene list into scripts; a script appears only if it has
  // a scene that matched the filters, and it carries just those scenes
  const scripts = useMemo<ScriptGroup[]>(() => {
    const map = new Map<string, ScriptGroup>()
    for (const s of scenes) {
      let g = map.get(s.script_path)
      if (!g) {
        // genre/medium/added/monologue are per-script, so any of its scenes carries them
        g = { path: s.script_path, name: s.script_name, scenes: [], cast: [], genres: s.genres ?? [], medium: s.medium ?? null, added: s.added ?? 0, monologue: s.monologue ?? null, foldedInto: s.folded_into ?? null }
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

  const sorted = useMemo(() => sortGroups(scripts, sort), [scripts, sort])

  // duplicate folding: reps carry a chevron; their twins render beneath when expanded
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set())
  const twinsByRep = useMemo(() => {
    const m = new Map<string, ScriptGroup[]>()
    for (const g of sorted) if (g.foldedInto) m.set(g.foldedInto, [...(m.get(g.foldedInto) || []), g])
    return m
  }, [sorted])
  // the rows actually shown, in order: visible reps, each followed by its expanded twins
  const displayRows = useMemo(() => {
    const out: ScriptGroup[] = []
    for (const g of sorted) {
      if (g.foldedInto) continue
      out.push(g)
      if (unfolded.has(g.path)) out.push(...(twinsByRep.get(g.path) || []))
    }
    return out
  }, [sorted, twinsByRep, unfolded])
  const toggleFold = (path: string) =>
    setUnfolded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  // multi-select (⌘-click toggles, ⇧-click extends a range) → manual duplicate Join
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  const [joinBump, setJoinBump] = useState(0) // re-query after join/unjoin
  const rowClick = (g: ScriptGroup, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setMultiSel((prev) => {
        const next = new Set(prev)
        if (!next.size && selScript) next.add(selScript.path) // fold the current selection in
        if (next.has(g.path)) next.delete(g.path)
        else next.add(g.path)
        return next
      })
      anchorRef.current = g.path
      return
    }
    if (e.shiftKey) {
      const a = anchorRef.current ?? selScript?.path
      const i1 = a ? displayRows.findIndex((x) => x.path === a) : -1
      const i2 = displayRows.findIndex((x) => x.path === g.path)
      if (i1 >= 0 && i2 >= 0) {
        const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1]
        setMultiSel(new Set(displayRows.slice(lo, hi + 1).map((x) => x.path)))
        return
      }
    }
    setMultiSel(new Set())
    anchorRef.current = g.path
    chooseScript(g)
  }
  const joinSelected = async () => {
    const r = await api.joinScripts([...multiSel]).catch(() => null)
    setMultiSel(new Set())
    // keep the user's place: when the re-queried list lands, select the joined
    // group's representative instead of snapping back to the top of the list
    if (r?.rep) restoreRef.current = { path: r.rep, index: 0, jump: false }
    setJoinBump((b) => b + 1)
  }
  // "Remove from stack" in the row's right-click menu
  useEffect(
    () =>
      window.scripty.onUnjoinRequest?.(async (p) => {
        await api.unjoinScript(p.path).catch(() => {})
        restoreRef.current = { path: p.path, index: 0, jump: false } // stay on the separated script
        setJoinBump((b) => b + 1)
      }),
    []
  )
  // "Move to top of stack" — promote, keep the stack open under its new top row
  useEffect(
    () =>
      window.scripty.onPromoteRequest?.(async (p) => {
        await api.promoteScript(p.path).catch(() => {})
        setUnfolded((prev) => new Set(prev).add(p.path)) // the stack now lives under this path
        restoreRef.current = { path: p.path, index: 0, jump: false }
        setJoinBump((b) => b + 1)
      }),
    []
  )

  // the genres actually assigned across the library + the fixed medium list, for the rail
  useEffect(() => {
    api.allGenres().then(setAllGenres).catch(() => {})
    api.allMediums().then(setAllMediums).catch(() => {})
  }, [refreshKey])

  useEffect(() => {
    let active = true
    const opt = SIZE[size]
    api
      .scenes({
        min_chars: opt.range?.[0],
        max_chars: opt.range?.[1],
        monologue: opt.mono || undefined,
        pairing: pairValue || undefined,
        search,
        genres: genres.length ? genres : undefined,
        mediums: mediums.length ? mediums : undefined
      })
      .then((r) => {
        if (!active) return // ignore a stale response when filters/search changed
        freshResult.current = true // a new result set → the reset effect should reset
        setScenes(r.scenes)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [size, pair, search, genres, mediums, refreshKey, joinBump])

  // select the first script (in the current sort order) and its earliest scene — but
  // ONLY when a fresh query result landed. An inline edit that patches scenes in place
  // must not reset selection (and re-sorting only repositions it), so we gate on the
  // freshResult flag rather than the `scripts` identity.
  useEffect(() => {
    if (!freshResult.current) return
    if (!sorted.length) {
      // no matches: clear the preview but keep waiting (don't consume the restore)
      setSelScript(null)
      setSelScene(null)
      return
    }
    freshResult.current = false
    setMultiSel(new Set()) // a new result set invalidates a half-built selection
    // on mount, restore the remembered script (Back from Prepare); afterwards, and on
    // filter changes, fall back to the first row
    const restore = restoreRef.current
    restoreRef.current = null
    const g = restore ? sorted.find((x) => x.path === restore.path) : undefined
    if (g) {
      setSelScript(g)
      setSelScene(g.scenes.find((s) => s.scene_index === restore!.index) || g.scenes[0] || null)
      setSceneJump(restore!.jump !== false) // Prepare-return lands on the scene; a Join stays at the top
      if (g.foldedInto) setUnfolded((prev) => new Set(prev).add(g.foldedInto!)) // reveal a restored twin
    } else {
      const first = sorted.find((x) => !x.foldedInto) || null
      setSelScript(first)
      setSelScene(first ? defaultScene(first) : null)
      setSceneJump(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts])

  // remember the current selection in App (a ref → no re-render) so it survives this
  // view unmounting and can be restored when we come back
  useEffect(() => {
    if (selScene) selRef.current = { path: selScene.script_path, index: selScene.scene_index }
  }, [selScene, selRef])

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

  const qlPayload = (s: Scene, jump = sceneJump) => ({
    title: stem(s.script_name),
    path: s.script_path,
    sceneIndex: s.scene_index,
    // scroll to the scene only when it was explicitly picked; otherwise open at the top
    page: jump ? s.page : undefined,
    top: jump ? s.top : undefined,
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
  useEffect(() => window.scripty.onMainSpace?.(toggleQuickLook), [qlOpen, selScene, sceneJump])
  // "Prepare scene" from a row's right-click menu. The row's onContextMenu already ran
  // chooseScript, so the selection is the right-clicked script and its default scene.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      window.scripty.onPrepareRequest?.(() => {
        if (selScene && selScript) onPrepare(selScene, selScript.scenes)
      }),
    [selScene, selScript]
  )
  // "Quick Look" from a row's right-click menu → open it for the just-selected scene.
  // Only open when closed: the row's onContextMenu already ran chooseScript, which
  // updates an already-open pop-out in place, so re-opening here would reload+flash it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      window.scripty.onQuickLookRequest?.(() => {
        if (!qlOpen && selScene) {
          window.scripty.quickLook(qlPayload(selScene))
          setQlOpen(true)
        }
      }),
    [selScene, qlOpen, sceneJump]
  )

  // pick a script (and reset to its earliest scene)
  // when a filter is active, land the preview on the scene that matches it: the
  // monologue scene for "Monologue", a 2-hander for "Duet", a 3+ scene for "Ensemble"
  const defaultScene = (g: ScriptGroup): Scene | null => {
    const opt = SIZE[size]
    if (opt.mono && g.monologue)
      return g.scenes.find((s) => s.scene_index === g.monologue!.scene) || g.scenes[0] || null
    if (opt.range && size !== 0) {
      const [mn, mx] = opt.range
      const hit = g.scenes.find((s) => s.char_count >= mn && s.char_count <= mx)
      if (hit) return hit
    }
    return g.scenes[0] || null
  }
  const chooseScript = (g: ScriptGroup) => {
    setSelScript(g)
    const sc = defaultScene(g)
    setSelScene(sc)
    setSceneJump(false) // a script pick shows the top of the file
    if (qlOpen && sc) window.scripty.quickLookUpdate(qlPayload(sc, false))
  }
  // pick a scene within the current script (navigator click / ←→ keys) → jump to it
  const chooseScene = (sc: Scene) => {
    setSelScene(sc)
    setSceneJump(true)
    if (qlOpen) window.scripty.quickLookUpdate(qlPayload(sc, true))
  }

  // keyboard, Finder-style: ↑/↓ move between scripts, ←/→ step scenes within the
  // selected script, and the open pop-out follows. Space toggles the pop-out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!displayRows.length) return
        e.preventDefault()
        const i = selScript ? displayRows.indexOf(selScript) : -1
        const ni = e.key === 'ArrowDown' ? Math.min(displayRows.length - 1, i + 1) : Math.max(0, i - 1)
        if (displayRows[ni]) chooseScript(displayRows[ni])
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && selScript && selScript.scenes.length > 1) {
        e.preventDefault()
        const list = selScript.scenes
        const i = selScene ? list.indexOf(selScene) : -1
        const ni = e.key === 'ArrowRight' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1)
        if (list[ni]) chooseScene(list[ni])
      } else if (e.key === 'Enter' && selScript) {
        // fold/unfold the selected script's stack; collapsing while a stacked row
        // is selected moves the selection to the stack's top row first
        const rep = selScript.foldedInto ?? selScript.path
        if (twinsByRep.has(rep)) {
          e.preventDefault()
          if (unfolded.has(rep) && selScript.foldedInto) {
            const repGroup = sorted.find((g) => g.path === rep)
            if (repGroup) chooseScript(repGroup)
          }
          toggleFold(rep)
        }
      } else if (e.key === ' ' && !e.repeat && el?.tagName !== 'BUTTON') {
        e.preventDefault()
        toggleQuickLook() // !e.repeat: holding Space shouldn't strobe the pop-out
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // sceneJump matters: re-clicking the already-selected scene changes ONLY the
    // jump flag, and Space must open Quick Look with the fresh payload, not a
    // stale top-of-file one (the close-reopen-fixes-it bug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRows, selScript, selScene, qlOpen, sceneJump])

  // keep the keyboard-selected rows visible
  useEffect(() => {
    listRef.current?.querySelector('.row.on')?.scrollIntoView({ block: 'nearest' })
  }, [selScript])
  useEffect(() => {
    navRef.current?.querySelector('.scenenav-row.on')?.scrollIntoView({ block: 'nearest' })
  }, [selScene])

  const chooseSize = (i: number) => {
    setSize(i)
    if (i === 1 || i === 3) setPair(0) // Monologue / Ensemble have no pairing
  }
  const toggleGenre = (g: string) =>
    setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g])
  const toggleMedium = (m: string) =>
    setMediums(mediums.includes(m) ? mediums.filter((x) => x !== m) : [...mediums, m])

  // inline edits: update every scene of the script locally (so the row reflects it
  // immediately) and persist; medium reflects the server's effective value (guess fallback)
  const patchScript = (path: string, patch: Partial<Scene>) =>
    setScenes((prev) => prev.map((s) => (s.script_path === path ? { ...s, ...patch } : s)))
  const applyGenres = (path: string, g: string[]) => {
    patchScript(path, { genres: g })
    api.setGenres(path, g).then(() => api.allGenres().then(setAllGenres).catch(() => {})).catch(() => {})
  }
  const applyMedium = (path: string, m: string | null) => {
    api
      .setMedium(path, m ?? '')
      .then((r) => patchScript(path, { medium: r.medium }))
      .catch(() => {})
  }
  const openMetaEdit = (e: React.MouseEvent, path: string, kind: 'genre' | 'medium') => {
    e.stopPropagation()
    setMetaEdit({ path, kind, rect: e.currentTarget.getBoundingClientRect() })
  }

  const sizeChip = size !== 0
  const pairChip = showPairing && pair !== 0
  const hasChips = sizeChip || pairChip || genres.length > 0 || mediums.length > 0
  const navScenes = selScript?.scenes ?? []

  return (
    <>
      <div className="rail">
        <div className="fsection">
          <div className="fhead" onClick={() => setOpenSize((v) => !v)}>
            <span className="flabel">Cast size</span>
            <span className="fright">
              <span className={'fsummary' + (size !== 0 ? ' active' : '')}>{SIZE[size].label}</span>
              <span className={'caret' + (openSize ? ' open' : '')}><IconChevron /></span>
            </span>
          </div>
          {openSize && (
            <div className="seg-size">
              {SIZE.map((o, i) => (
                <button key={o.label} className={i === size ? 'on' : ''} onClick={() => chooseSize(i)}>
                  {o.label}
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
                <span className={'caret' + (openPair ? ' open' : '')}><IconChevron /></span>
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
              <span className={'caret' + (openGenre ? ' open' : '')}><IconChevron /></span>
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

        <div className="fsection">
          <div className="fhead" onClick={() => setOpenMedium((v) => !v)}>
            <span className="flabel">Medium</span>
            <span className="fright">
              <span className={'fsummary' + (mediums.length ? ' active' : '')}>
                {mediums.length ? `${mediums.length} selected` : 'Any'}
              </span>
              <span className={'caret' + (openMedium ? ' open' : '')}><IconChevron /></span>
            </span>
          </div>
          {openMedium && (
            <div className="chips">
              {allMediums.map((m) => (
                <button key={m} className={'chip' + (mediums.includes(m) ? ' on' : '')} onClick={() => toggleMedium(m)}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      <div className="listpane">
        <div className="lhead">
          <div className="meta" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {hasChips ? (
              <>
                {sizeChip && (
                  <span className="fchip">
                    {SIZE[size].label}
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
                {mediums.map((m) => (
                  <span key={m} className="fchip">
                    {m}
                    <span className="x" onClick={() => toggleMedium(m)}>✕</span>
                  </span>
                ))}
              </>
            ) : (
              <span>All scripts · no filters applied</span>
            )}
          </div>
          <span className="lhead-right">
            <span className="result">
              {sorted.filter((g) => !g.foldedInto).length} script
              {sorted.filter((g) => !g.foldedInto).length !== 1 ? 's' : ''}
            </span>
            <button
              className="sortbtn"
              title="Sort scripts"
              onClick={(e) => setSortMenu(e.currentTarget.getBoundingClientRect())}
            >
              Sort: {SORTS.find((s) => s.key === sort.key)?.label}
              <span className="sortdir">{sort.dir === 'asc' ? <IconSortUp /> : <IconSortDown />}</span>
            </button>
          </span>
        </div>
        <div
          className="colhead"
          title="Right-click to show or hide columns"
          onContextMenu={(e) => {
            e.preventDefault()
            setColMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          <span style={{ flex: 1 }}>Script</span>
          {cols.genre && <span style={{ width: 96 }}>Genre</span>}
          {cols.medium && <span style={{ width: 78 }}>Medium</span>}
          {cols.cast && <span style={{ width: 64 }}>Cast</span>}
          {cols.scenes && <span style={{ width: 42, textAlign: 'right' }}>Scenes</span>}
        </div>
        <div className="list" ref={listRef}>
          {displayRows.length === 0 && <div className="empty">No scripts match these filters.</div>}
          {displayRows.map((g) => (
            <div
              key={g.path}
              className={'row' + (selScript === g ? ' on' : '') + (g.foldedInto ? ' twin' : '') + (multiSel.has(g.path) ? ' msel' : '')}
              onClick={(e) => rowClick(g, e)}
              onMouseDown={(e) => e.shiftKey && e.preventDefault()} // no browser text-selection on ⇧-range
              onDoubleClick={() => api.openFile(g.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                chooseScript(g)
                window.scripty.rowMenu({ path: g.path, name: g.name, stacked: !!g.foldedInto })
              }}
            >
              <div className="main">
                <div className="title">
                  <span className="tname">{stem(g.name)}</span>
                  {twinsByRep.has(g.path) && (
                    <span
                      className={'foldchev' + (unfolded.has(g.path) ? ' open' : '')}
                      title={`${twinsByRep.get(g.path)!.length} more in this stack (Enter to toggle)`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFold(g.path)
                      }}
                      // two quick toggles must not bubble as a row double-click (opens the file)
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <IconChevron />
                      <span className="fc-n">{twinsByRep.get(g.path)!.length}</span>
                    </span>
                  )}
                </div>
                {monoActive && g.monologue ? (
                  <div className="sub monohint">
                    Monologue · {g.monologue.who} · {mmss(g.monologue.seconds)}
                  </div>
                ) : (
                  <div className="sub">
                    {g.scenes.length} scene{g.scenes.length !== 1 ? 's' : ''} · {g.cast.length} character
                    {g.cast.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
              {cols.genre && (
                <span
                  className="col-genre editable"
                  title={g.genres.length ? g.genres.join(', ') : 'Set genre'}
                  onClick={(e) => openMetaEdit(e, g.path, 'genre')}
                >
                  {g.genres.length ? (
                    <>
                      {g.genres[0]}
                      {g.genres.length > 1 && <span className="more"> +{g.genres.length - 1}</span>}
                    </>
                  ) : (
                    <span className="col-dash">＋</span>
                  )}
                </span>
              )}
              {cols.medium && (
                <span
                  className="col-medium editable"
                  title="Set medium"
                  onClick={(e) => openMetaEdit(e, g.path, 'medium')}
                >
                  {g.medium ? <span className="medchip">{g.medium}</span> : <span className="col-dash">＋</span>}
                </span>
              )}
              {cols.cast && (
                <div className="cast">
                  {g.cast.slice(0, 3).map((c) => (
                    <div key={c.name} className={'gchip ' + gletter(c.gender)} title={c.name}>
                      {gletter(c.gender)}
                    </div>
                  ))}
                </div>
              )}
              {cols.scenes && <span className="page">{g.scenes.length}</span>}
            </div>
          ))}
        </div>
      </div>

      {showPreview && (
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
              <PdfFrame
                path={selScene.script_path}
                page={sceneJump ? selScene.page : undefined}
                top={sceneJump ? selScene.top : undefined}
                nonce={selScene.scene_index}
              />
            ) : isDocx(selScene.script_path) ? (
              <DocFrame path={selScene.script_path} />
            ) : isPlainText(selScene.script_path) ? (
              <TextFrame path={selScene.script_path} />
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
                      <div className="sn-bottom">
                        <span className="sn-meta">
                          {monoActive && selScript.monologue?.scene === sc.scene_index && (
                            <span className="sn-badge">Monologue · </span>
                          )}
                          {sizeTag(sc.char_count)}{sc.page ? ` · p.${sc.page}` : ''}
                        </span>
                        {sc.characters.length > 0 && (
                          <span className="sn-cast">
                            {sc.characters.slice(0, 4).map((c) => (
                              <span key={c.name} className={'gchip ' + gletter(c.gender)} title={c.name}>
                                {gletter(c.gender)}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="dbtns">
              <button className="prepare" onClick={() => onPrepare(selScene, selScript.scenes)}>
                Prepare scene →
              </button>
            </div>
          </>
        )}
      </div>
      )}

      {multiSel.size >= 2 && (
        <div className="join-toast">
          <span className="jt-n">{multiSel.size} scripts highlighted</span>
          <button className="jt-join" onClick={joinSelected}>Stack together</button>
          <button className="jt-x" title="Clear selection" onClick={() => setMultiSel(new Set())}>✕</button>
        </div>
      )}

      {sortMenu && (
        <div className="rme-backdrop" onClick={() => setSortMenu(null)}>
          <div
            className="rme"
            style={{ left: Math.min(sortMenu.left, window.innerWidth - 196), top: sortMenu.bottom + 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rme-cap">Sort by</div>
            <div className="rme-list">
              {SORTS.map((s) => (
                <button key={s.key} className={'rme-opt' + (sort.key === s.key ? ' on' : '')} onClick={() => setSort(s.key)}>
                  <span className="rme-check">{sort.key === s.key ? (sort.dir === 'asc' ? <IconSortUp /> : <IconSortDown />) : ''}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {colMenu && (
        <div className="rme-backdrop" onClick={() => setColMenu(null)} onContextMenu={(e) => { e.preventDefault(); setColMenu(null) }}>
          <div
            className="rme"
            style={{ left: Math.min(colMenu.x, window.innerWidth - 196), top: colMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rme-cap">Columns</div>
            <div className="rme-list">
              {COLS.map((c) => (
                <button key={c.key} className="rme-opt" onClick={() => setCol(c.key, !cols[c.key])}>
                  <span className="rme-check">{cols[c.key] ? '✓' : ''}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {metaEdit &&
        (() => {
          const g = scripts.find((x) => x.path === metaEdit.path)
          if (!g) return null
          return (
            <RowMetaEditor
              kind={metaEdit.kind}
              rect={metaEdit.rect}
              genres={g.genres}
              medium={g.medium}
              allGenres={allGenres}
              allMediums={allMediums}
              onApplyGenres={(next) => applyGenres(metaEdit.path, next)}
              onApplyMedium={(next) => applyMedium(metaEdit.path, next)}
              onClose={() => setMetaEdit(null)}
            />
          )
        })()}
    </>
  )
}
