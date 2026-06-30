import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type Gender = 'female' | 'male' | 'unknown'
export interface ScriptMeta {
  genres?: string[]
  genders?: Record<string, Gender> // character name (UPPERCASE) → manual gender
  medium?: string // TV | Play | Film | Commercial (manual override of the guess)
}

// Manual, user-set metadata (genre tags, character-gender overrides) for scripts.
// Stored separately from the parsed index — keyed by file path — so re-indexing,
// rebuilding, or the parser-version auto-reparse never wipe a user's edits.
export class Meta {
  private file: string
  private data: Record<string, ScriptMeta> = {}

  constructor(dir: string) {
    this.file = join(dir, 'meta.json')
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf-8'))
      } catch {
        this.data = {}
      }
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.data))
    } catch {
      /* ignore — metadata is best-effort */
    }
  }

  get(path: string): ScriptMeta | undefined {
    return this.data[path]
  }
  genres(path: string): string[] {
    return this.data[path]?.genres ?? []
  }
  // a character's manual gender override, or undefined to fall back to the guess
  gender(path: string, name: string): Gender | undefined {
    return this.data[path]?.genders?.[name]
  }
  // the manual medium override, or undefined to fall back to the guess
  medium(path: string): string | undefined {
    return this.data[path]?.medium
  }

  // write an entry, stripping empty fields and dropping it entirely when nothing's left
  private put(path: string, entry: ScriptMeta) {
    const clean: ScriptMeta = {}
    if (entry.genres?.length) clean.genres = [...new Set(entry.genres.map((g) => g.trim()).filter(Boolean))]
    if (entry.genders && Object.keys(entry.genders).length) clean.genders = entry.genders
    if (entry.medium) clean.medium = entry.medium
    if (clean.genres?.length || clean.genders || clean.medium) this.data[path] = clean
    else delete this.data[path]
    this.save()
  }

  // full replace (the Edit-details modal saves everything at once)
  set(path: string, m: { genres: string[]; genders: Record<string, Gender>; medium?: string }) {
    this.put(path, { genres: m.genres, genders: m.genders, medium: m.medium })
  }
  // partial updates (inline row edits) that preserve the other fields
  setGenres(path: string, genres: string[]) {
    this.put(path, { ...this.data[path], genres })
  }
  setMedium(path: string, medium: string | undefined) {
    this.put(path, { ...this.data[path], medium })
  }

  // follow a renamed file so its metadata isn't orphaned
  rename(oldPath: string, newPath: string) {
    const m = this.data[oldPath]
    if (!m) return
    delete this.data[oldPath]
    this.data[newPath] = m
    this.save()
  }

  // every distinct genre assigned across the library, for the filter rail
  allGenres(): string[] {
    const set = new Set<string>()
    for (const m of Object.values(this.data)) for (const g of m.genres ?? []) set.add(g)
    return [...set].sort((a, b) => a.localeCompare(b))
  }
}
