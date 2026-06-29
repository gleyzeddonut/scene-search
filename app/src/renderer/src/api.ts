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
  reindexStatus: () => Promise<{
    running: boolean; scanned: number; total: number; file: string
    scripts: number; scenes: number; errors: string[]
  }>
  reindexStop: () => Promise<{ stopped: boolean }>
  add: (p: string) => Promise<{ result: 'added' | 'exists' | 'not_script' | 'unreadable'; name: string }>
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
      checkUpdates: () => Promise<void>
      quitAndInstall: () => Promise<void>
      quickLook: (p: { title: string; path: string; sceneIndex: number; page?: number; isPdf: boolean }) => Promise<void>
      onUpdateStatus: (cb: (m: UpdateMsg) => void) => () => void
    }
  }
}

const eng = () => window.scripty.engine

export const api = {
  getFolders: () => eng().getFolders(),
  setFolders: (roots: string[], ignored: string[]) => eng().setFolders(roots, ignored),
  reindex: () => eng().reindex(),
  reindexStop: () => eng().reindexStop(),
  reindexStatus: () => eng().reindexStatus(),
  stats: () => eng().stats(),
  scenes: (p: { min_chars?: number; max_chars?: number; pairing?: string; search?: string }) =>
    eng().scenes(p),
  getScene: (path: string, index: number) => eng().scene(path, index),
  addScript: (path: string) => eng().add(path),
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
