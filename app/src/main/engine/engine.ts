import { app } from 'electron'
import { join, basename } from 'node:path'
import { Library } from './library'
import { Settings, loadIndex, saveIndex, migrateLegacySettings, ensureDir } from './store'
import { defaultRoots } from './scanner'
import { guessGender } from './gender'

export class Engine {
  private dir = join(app.getPath('userData'), 'scripty')
  private settings: Settings
  private lib = new Library()
  state = { running: false, scanned: 0, scripts: 0, scenes: 0, cancel: false, errors: [] as string[] }

  constructor() {
    ensureDir(this.dir)
    const settingsPath = join(this.dir, 'settings.json')
    migrateLegacySettings(settingsPath)
    this.settings = new Settings(settingsPath)
    const saved = loadIndex(this.dir)
    if (saved) this.lib.fromJSON(saved)
    this.state.scripts = this.lib.scriptCount()
    this.state.scenes = this.lib.sceneCount()
  }

  getFolders() {
    const roots = this.settings.getRoots() ?? defaultRoots()
    return { roots, ignored: this.settings.getIgnored() ?? [] }
  }
  setFolders(roots: string[], ignored: string[]) {
    this.settings.setRoots(roots)
    this.settings.setIgnored(ignored)
    return { roots, ignored }
  }
  stats() {
    return { scripts: this.lib.scriptCount(), scenes: this.lib.sceneCount() }
  }
  scenes(f: { min_chars?: number; max_chars?: number; pairing?: string; search?: string }) {
    const rows = this.lib.query({ minChars: f.min_chars, maxChars: f.max_chars, pairing: f.pairing || null })
    const s = (f.search || '').toLowerCase()
    const out = rows
      .filter((m) => !s || m.script_name.toLowerCase().includes(s) || m.heading.toLowerCase().includes(s))
      .map((m) => ({
        ...m,
        characters: m.characters.map((n) => ({ name: n, gender: guessGender(n) }))
      }))
    return { scenes: out }
  }
  scene(path: string, index: number) {
    const s = this.lib.getScene(path, index)
    if (!s) throw new Error('no such scene')
    return s
  }
  reindexStatus() {
    return {
      running: this.state.running,
      scanned: this.state.scanned,
      scripts: this.state.scripts,
      scenes: this.state.scenes,
      errors: this.state.errors
    }
  }
  reindexStop() {
    this.state.cancel = true
    return { stopped: true }
  }
  reindex() {
    if (this.state.running) return { started: true }
    const roots = this.settings.getRoots() ?? defaultRoots()
    const ignored = this.settings.getIgnored() ?? []
    Object.assign(this.state, { running: true, scanned: 0, cancel: false, errors: [] as string[] })
    const bad = new Set<string>()
    void (async () => {
      try {
        await this.lib.reindex(roots, {
          ignoreDirs: ignored,
          progress: () => {
            this.state.scanned++
          },
          shouldCancel: () => this.state.cancel,
          onError: (p) => {
            if (p) {
              bad.add(p)
              this.state.errors = [...bad].sort()
            }
          }
        })
        this.state.scripts = this.lib.scriptCount()
        this.state.scenes = this.lib.sceneCount()
        saveIndex(this.dir, this.lib.toJSON())
      } finally {
        this.state.running = false
      }
    })()
    return { started: true }
  }
  async add(path: string) {
    const result = await this.lib.addFile(path)
    if (result === 'added') saveIndex(this.dir, this.lib.toJSON())
    return { result, name: basename(path) }
  }
}
