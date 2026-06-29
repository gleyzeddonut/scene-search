import { app } from 'electron'
import { join, basename, dirname, extname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { rename as renameFile, copyFile, rm } from 'node:fs/promises'
import { Library } from './library'
import { Settings, loadIndex, saveIndex, migrateLegacySettings, ensureDir } from './store'
import { defaultRoots, iterCandidates } from './scanner'
import { guessGender } from './gender'
import { Meta, Gender } from './meta'
import { PARSER_VERSION } from './parser'

export class Engine {
  private dir = join(app.getPath('userData'), 'scripty')
  private settings: Settings
  private lib = new Library()
  private meta = new Meta(this.dir)
  // resolve a character's gender: manual override first, then the name-based guess
  private genderOf = (path: string, name: string): string => this.meta.gender(path, name) ?? guessGender(name)
  // true when the persisted index was built by an older parser — the next
  // reindex re-parses every file (not just changed ones) so the new parsing
  // reaches scripts that are already in the library
  private stale = false
  state = { running: false, scanned: 0, total: 0, file: '', scripts: 0, scenes: 0, cancel: false, errors: [] as string[] }

  constructor() {
    ensureDir(this.dir)
    const settingsPath = join(this.dir, 'settings.json')
    migrateLegacySettings(settingsPath)
    this.settings = new Settings(settingsPath)
    const saved = loadIndex(this.dir)
    if (saved) {
      this.lib.fromJSON(saved)
      // older indexes have no parserVersion → undefined !== current → stale
      this.stale = saved.parserVersion !== PARSER_VERSION
    }
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
  scenes(f: { min_chars?: number; max_chars?: number; pairing?: string; search?: string; genres?: string[] }) {
    const rows = this.lib.query(
      { minChars: f.min_chars, maxChars: f.max_chars, pairing: f.pairing || null },
      this.genderOf
    )
    const s = (f.search || '').toLowerCase()
    const wantGenres = f.genres && f.genres.length ? new Set(f.genres) : null
    const gcache = new Map<string, string[]>() // a script's genres, looked up once
    const genresOf = (p: string) => {
      let g = gcache.get(p)
      if (!g) gcache.set(p, (g = this.meta.genres(p)))
      return g
    }
    const out = rows
      .filter((m) => !s || m.script_name.toLowerCase().includes(s) || m.heading.toLowerCase().includes(s))
      .filter((m) => !wantGenres || genresOf(m.script_path).some((g) => wantGenres.has(g)))
      .map((m) => ({
        ...m,
        characters: m.characters.map((n) => ({ name: n, gender: this.genderOf(m.script_path, n) })),
        genres: genresOf(m.script_path)
      }))
    return { scenes: out }
  }
  scene(path: string, index: number) {
    const s = this.lib.getScene(path, index, this.genderOf)
    if (!s) throw new Error('no such scene')
    return s
  }
  // manual metadata: genres + per-character gender overrides for a script
  allGenres() {
    return this.meta.allGenres()
  }
  getMeta(path: string) {
    return {
      genres: this.meta.genres(path),
      // effective gender per character (override or guess) so the editor starts right
      cast: this.lib.scriptCharacters(path).map((name) => ({ name, gender: this.genderOf(path, name) }))
    }
  }
  setMeta(path: string, m: { genres: string[]; genders: Record<string, Gender> }) {
    // only persist a gender that DIFFERS from the guess — so opening Edit-details and
    // saving doesn't freeze every character's guess as a permanent override (which
    // would mask future guesser improvements and leave the entry undeletable)
    const genders: Record<string, Gender> = {}
    for (const [name, g] of Object.entries(m.genders)) {
      if (g !== guessGender(name)) genders[name] = g
    }
    this.meta.set(path, { genres: m.genres, genders })
    return { ok: true }
  }
  reindexStatus() {
    return {
      running: this.state.running,
      scanned: this.state.scanned,
      total: this.state.total,
      file: this.state.file,
      scripts: this.state.scripts,
      scenes: this.state.scenes,
      errors: this.state.errors,
      stale: this.stale // index built by an older parser — a refresh is worthwhile
    }
  }
  reindexStop() {
    this.state.cancel = true
    return { stopped: true }
  }
  // force = re-parse every file regardless of mtime (explicit "Rebuild library").
  // A stale index (older parser) also forces a full pass on the next reindex.
  reindex(force = false) {
    if (this.state.running) return { started: false } // one is already running

    const full = force || this.stale
    const roots = this.settings.getRoots() ?? defaultRoots()
    const ignored = this.settings.getIgnored() ?? []
    Object.assign(this.state, { running: true, scanned: 0, total: 0, file: '', cancel: false, errors: [] as string[] })
    const bad = new Set<string>()
    void (async () => {
      try {
        // cheap pre-count (walk only, no extraction) so the UI shows a real percentage
        let total = 0
        for await (const _p of iterCandidates(roots, {
          ignoreDirs: ignored,
          shouldCancel: () => this.state.cancel
        })) {
          void _p
          total++
        }
        this.state.total = total
        await this.lib.reindex(roots, {
          ignoreDirs: ignored,
          force: full,
          progress: (name) => {
            this.state.scanned++
            this.state.file = name
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
        // a completed pass brings the whole index up to the current parser; a
        // full pass stopped partway leaves it half-upgraded, so keep it stale
        // (persist version 0) and force the full pass again next time. Capture the
        // pre-mutation flag so this stays correct regardless of statement order.
        const completed = !this.state.cancel
        const leftStale = this.stale && !completed
        if (completed) this.stale = false
        const version = leftStale && full ? 0 : PARSER_VERSION
        saveIndex(this.dir, { parserVersion: version, ...this.lib.toJSON() })
      } finally {
        this.state.running = false
        this.state.file = ''
      }
    })()
    return { started: true }
  }
  // explicit full rebuild — re-parse everything from scratch on demand
  rebuild() {
    return this.reindex(true)
  }
  // rename a file on disk (newStem = the new name without extension; the original
  // extension is kept) and move it within the index in place
  async rename(oldPath: string, newStem: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    // a running reindex captured the old path in its 'present' set; renaming now would
    // let its orphan sweep delete the moved row. Make the user wait it out.
    if (this.state.running) return { ok: false, error: 'busy' }
    const stem = newStem.trim().replace(/[/\\]/g, '') // no path separators
    if (!stem) return { ok: false, error: 'empty' }
    const newPath = join(dirname(oldPath), stem + extname(oldPath))
    if (newPath === oldPath) return { ok: true, path: oldPath }
    // a capitalization-only change is the SAME file on a case-insensitive volume, so
    // existsSync would falsely report a collision — allow it through
    const caseOnly = newPath.toLowerCase() === oldPath.toLowerCase()
    if (!caseOnly && existsSync(newPath)) return { ok: false, error: 'exists' }
    try {
      await renameFile(oldPath, newPath)
    } catch {
      return { ok: false, error: 'failed' }
    }
    this.lib.renamePath(oldPath, newPath)
    this.meta.rename(oldPath, newPath) // keep genre/gender edits with the file
    saveIndex(this.dir, { parserVersion: this.stale ? 0 : PARSER_VERSION, ...this.lib.toJSON() })
    return { ok: true, path: newPath }
  }

  // Move every indexed script file into destDir (organizing the library through the
  // app). Index paths AND manual metadata (genres, gender overrides) follow each
  // file, filename collisions get a " (n)" suffix, and destDir becomes an indexed
  // root so the moved files stay tracked.
  async moveAll(destDir: string): Promise<{ moved: number; skipped: number; failed: number }> {
    if (this.state.running) return { moved: 0, skipped: 0, failed: 0 } // see rename's note
    const dest = resolve(destDir) // normalize so the "already here?" check is reliable
    // make the destination an indexed root UP FRONT, so even an interrupted move
    // leaves the already-moved files re-indexable on the next launch (no orphaning)
    const roots = this.settings.getRoots() ?? defaultRoots()
    if (!roots.includes(dest)) this.settings.setRoots([...roots, dest])
    let moved = 0
    let skipped = 0
    let failed = 0
    for (const oldPath of this.lib.allPaths()) {
      if (dirname(oldPath) === dest) {
        skipped++
        continue
      }
      const target = this.freeTarget(dest, basename(oldPath), dirname(oldPath))
      try {
        try {
          await renameFile(oldPath, target)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
          // across volumes: copy then remove the original; roll back the copy on any
          // failure so we never leave a partial/duplicate and never lose the original
          try {
            await copyFile(oldPath, target)
            await rm(oldPath)
          } catch (err) {
            await rm(target).catch(() => {})
            throw err
          }
        }
        this.lib.renamePath(oldPath, target)
        this.meta.rename(oldPath, target)
        moved++
      } catch {
        failed++
      }
    }
    saveIndex(this.dir, { parserVersion: this.stale ? 0 : PARSER_VERSION, ...this.lib.toJSON() })
    return { moved, skipped, failed }
  }

  // a non-colliding path in dir for a moved file. On a name clash, disambiguate with
  // the SOURCE folder name — NOT a "(n)"/"copy" suffix, which canonicalKey folds as a
  // re-download copy and would hide the script from results.
  private freeTarget(dir: string, base: string, fromDir: string): string {
    let t = join(dir, base)
    if (!existsSync(t)) return t
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    const tag = basename(fromDir) || 'moved'
    t = join(dir, `${stem} - ${tag}${ext}`)
    if (!existsSync(t)) return t
    for (let i = 2; ; i++) {
      t = join(dir, `${stem} - ${tag} ${i}${ext}`)
      if (!existsSync(t)) return t
    }
  }

  async add(path: string) {
    const result = await this.lib.addFile(path)
    // stamp the parser version like reindex does — but only claim the index is
    // current when it actually is. If the library is still stale (old parser,
    // pending a full re-parse), adding one file must NOT mark the whole index
    // current, or the pending upgrade is silently cancelled on the next launch.
    if (result === 'added') {
      saveIndex(this.dir, { parserVersion: this.stale ? 0 : PARSER_VERSION, ...this.lib.toJSON() })
    }
    return { result, name: basename(path) }
  }
}
