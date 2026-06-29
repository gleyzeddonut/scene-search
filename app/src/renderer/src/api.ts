export interface SceneChar { name: string; gender: string }
export interface Scene {
  script_path: string
  script_name: string
  heading: string
  page: number
  char_count: number
  characters: SceneChar[]
  pairing: string | null
}

declare global {
  interface Window {
    scripty: {
      engineInfo: () => Promise<{ port: number; token: string }>
      pickFolder: () => Promise<string | null>
      onOpenSettings: (cb: () => void) => void
    }
  }
}

let base = ''
let token = ''

export async function init() {
  const info = await window.scripty.engineInfo()
  base = `http://127.0.0.1:${info.port}`
  token = info.token
}

async function call(path: string, opts: RequestInit = {}) {
  const r = await fetch(base + path, {
    ...opts,
    headers: { 'X-Scripty-Token': token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

export const api = {
  getFolders: () => call('/folders') as Promise<{ roots: string[]; ignored: string[] }>,
  setFolders: (roots: string[], ignored: string[]) =>
    call('/folders', { method: 'PUT', body: JSON.stringify({ roots, ignored }) }),
  reindex: () => call('/reindex', { method: 'POST' }),
  reindexStatus: () =>
    call('/reindex/status') as Promise<{ running: boolean; scanned: number; scripts: number; scenes: number }>,
  stats: () => call('/stats') as Promise<{ scripts: number; scenes: number }>,
  scenes: (p: { min_chars?: number; max_chars?: number; pairing?: string; search?: string }) => {
    const q = new URLSearchParams()
    if (p.min_chars != null) q.set('min_chars', String(p.min_chars))
    if (p.max_chars != null) q.set('max_chars', String(p.max_chars))
    if (p.pairing) q.set('pairing', p.pairing)
    if (p.search) q.set('search', p.search)
    return call('/scenes?' + q.toString()) as Promise<{ scenes: Scene[] }>
  },
  openFile: (path: string) => call('/open', { method: 'POST', body: JSON.stringify({ path }) }),
  revealFile: (path: string) => call('/reveal', { method: 'POST', body: JSON.stringify({ path }) }),
  pickFolder: () => window.scripty.pickFolder()
}
