export interface SceneChar { name: string; gender: string }

export interface Scene {
  script_path: string
  script_name: string
  heading: string
  page: number
  char_count: number
  characters: SceneChar[]
  pairing: string | null
  scene_index: number
  est_seconds: number
  genres?: string[] // manual genre tags on the script
  medium?: string | null // effective medium (manual or guessed), null = untagged
}

export type SceneBlock =
  | { type: 'action'; text: string }
  | { type: 'cue'; who: string; text: string }

export interface SceneDetail {
  heading: string
  characters: SceneChar[]
  est_seconds: number
  lines: { who: string; text: string }[]
  content: SceneBlock[]
}

// full ordered scene; falls back to dialogue for indexes built before content existed
export function sceneBlocks(d: SceneDetail): SceneBlock[] {
  return d.content.length ? d.content : d.lines.map((l) => ({ type: 'cue', who: l.who, text: l.text }))
}

export function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf')
}

// .docx previews render the real document (mammoth → HTML), like the PDF viewer —
// not the parsed-scene fallback the other text formats use
export function isDocx(path: string): boolean {
  return path.toLowerCase().endsWith('.docx')
}

// readable plain-text scripts shown verbatim (real file), like Finder. .fdx is
// excluded — its raw form is Final Draft XML, so the parsed view reads better.
export function isPlainText(path: string): boolean {
  const p = path.toLowerCase()
  return p.endsWith('.txt') || p.endsWith('.fountain')
}

// a filename without its extension ("Heat.pdf" → "Heat")
export const stem = (name: string): string => name.replace(/\.[^.]+$/, '')

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'none'
  | 'error'
  | 'dev'

export interface UpdateMsg {
  phase: UpdatePhase
  pct?: number
  version?: string
}

interface EngineApi {
  getFolders: () => Promise<{ roots: string[]; ignored: string[] }>
  setFolders: (r: string[], ig: string[]) => Promise<unknown>
  stats: () => Promise<{ scripts: number; scenes: number }>
  scenes: (f: unknown) => Promise<{ scenes: Scene[] }>
  scene: (p: string, i: number) => Promise<SceneDetail>
  reindex: () => Promise<{ started: boolean }>
  rebuild: () => Promise<{ started: boolean }>
  reindexStatus: () => Promise<{
    running: boolean; scanned: number; total: number; file: string
    scripts: number; scenes: number; errors: string[]; stale: boolean
  }>
  reindexStop: () => Promise<{ stopped: boolean }>
  add: (p: string) => Promise<{ result: 'added' | 'exists' | 'not_script' | 'unreadable'; name: string }>
  rename: (p: string, name: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  moveAll: (dir: string) => Promise<{ moved: number; skipped: number; failed: number }>
  genres: () => Promise<string[]>
  mediums: () => Promise<string[]>
  getMeta: (
    p: string
  ) => Promise<{ genres: string[]; cast: { name: string; gender: string }[]; medium: string; mediums: string[] }>
  setMeta: (
    p: string,
    m: { genres: string[]; genders: Record<string, string>; medium?: string }
  ) => Promise<{ ok: boolean }>
  open: (p: string) => Promise<unknown>
  reveal: (p: string) => Promise<unknown>
}

declare global {
  interface Window {
    scripty: {
      engine: EngineApi
      pathForFile: (file: File) => string
      pickFolder: () => Promise<string | null>
      onOpenSettings: (cb: () => void) => void
      exportSides: (html: string, name: string) => Promise<boolean>
      appVersion: () => Promise<string>
      readFile: (path: string) => Promise<Uint8Array>
      renderDoc: (path: string) => Promise<string | null>
      checkUpdates: () => Promise<void>
      quitAndInstall: () => Promise<void>
      quickLook: (p: { title: string; path: string; sceneIndex: number; page?: number; isPdf: boolean }) => Promise<void>
      quickLookUpdate: (p: { title: string; path: string; sceneIndex: number; page?: number; isPdf: boolean }) => Promise<void>
      quickLookClose: () => Promise<void>
      rowMenu: (p: { path: string; name: string }) => Promise<void>
      onRenameRequest: (cb: (p: { path: string; name: string }) => void) => () => void
      onEditDetails: (cb: (p: { path: string; name: string }) => void) => () => void
      setFocusCat: (c: 'pdf' | 'text' | 'other') => void
      onMainSpace: (cb: () => void) => () => void
      onQuickLookClosed: (cb: () => void) => () => void
      onQuickLookScene: (cb: (p: unknown) => void) => () => void
      onUpdateStatus: (cb: (m: UpdateMsg) => void) => () => void
    }
  }
}

const eng = () => window.scripty.engine

export const api = {
  getFolders: () => eng().getFolders(),
  setFolders: (roots: string[], ignored: string[]) => eng().setFolders(roots, ignored),
  reindex: () => eng().reindex(),
  rebuild: () => eng().rebuild(),
  reindexStop: () => eng().reindexStop(),
  reindexStatus: () => eng().reindexStatus(),
  stats: () => eng().stats(),
  scenes: (p: {
    min_chars?: number; max_chars?: number; pairing?: string; search?: string
    genres?: string[]; mediums?: string[]
  }) => eng().scenes(p),
  getScene: (path: string, index: number) => eng().scene(path, index),
  addScript: (path: string) => eng().add(path),
  renameScript: (path: string, newName: string) => eng().rename(path, newName),
  moveAll: (dir: string) => eng().moveAll(dir),
  allGenres: () => eng().genres(),
  allMediums: () => eng().mediums(),
  getMeta: (path: string) => eng().getMeta(path),
  setMeta: (path: string, m: { genres: string[]; genders: Record<string, string>; medium?: string }) =>
    eng().setMeta(path, m),
  openFile: (path: string) => eng().open(path),
  revealFile: (path: string) => eng().reveal(path),
  pickFolder: () => window.scripty.pickFolder(),
  exportSides: (elementId: string, name: string) => {
    const el = document.getElementById(elementId)
    const css =
      '<style>body{font-family:"Courier Prime",monospace;color:#111;margin:48px}' +
      '.cue{margin-left:34%}.sline{margin-left:14%;width:74%;margin-bottom:10px}' +
      '.sline.mine{background:#eee;border-radius:6px;padding:4px 10px}</style>'
    const html = '<html><head>' + css + '</head><body>' + (el?.outerHTML || '') + '</body></html>'
    return window.scripty.exportSides(html, name)
  }
}
