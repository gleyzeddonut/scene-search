import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export class Settings {
  private data: Record<string, unknown> = {}
  constructor(private path: string) {
    if (existsSync(path)) {
      try {
        this.data = JSON.parse(readFileSync(path, 'utf-8'))
      } catch {
        this.data = {}
      }
    }
  }
  private save() {
    writeFileSync(this.path, JSON.stringify(this.data))
  }
  private getList(k: string): string[] | null {
    const v = this.data[k]
    return Array.isArray(v) ? v.map(String) : null
  }
  private setList(k: string, v: string[]) {
    this.data[k] = v.map(String)
    this.save()
  }
  // scalar prefs (numbers/bools) — always read with a default so a missing or
  // hand-edited/corrupt value can never poison behavior
  getNum(k: string, dflt: number): number {
    const v = this.data[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt
  }
  setNum(k: string, v: number) {
    this.data[k] = v
    this.save()
  }
  getBool(k: string, dflt: boolean): boolean {
    const v = this.data[k]
    return typeof v === 'boolean' ? v : dflt
  }
  setBool(k: string, v: boolean) {
    this.data[k] = v
    this.save()
  }
  getStr(k: string, dflt: string): string {
    const v = this.data[k]
    return typeof v === 'string' ? v : dflt
  }
  setStr(k: string, v: string) {
    this.data[k] = v
    this.save()
  }
  getRoots() { return this.getList('roots') }
  setRoots(v: string[]) { this.setList('roots', v) }
  getIgnored() { return this.getList('ignored') }
  setIgnored(v: string[]) { this.setList('ignored', v) }
  // files the user removed from the library — skipped on re-index so they don't
  // reappear when they sit inside a watched folder
  getHidden() { return this.getList('hidden') ?? [] }
  hide(path: string) { this.setList('hidden', [...new Set([...this.getHidden(), path])]) }
  unhide(path: string) { this.setList('hidden', this.getHidden().filter((p) => p !== path)) }
}

export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function saveIndex(dir: string, data: unknown) {
  ensureDir(dir)
  writeFileSync(join(dir, 'index.json'), JSON.stringify(data))
}

export function loadIndex(dir: string): any | null {
  const p = join(dir, 'index.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

// one-time: carry folders over from the old Python settings file if present
export function migrateLegacySettings(settingsPath: string) {
  const legacy = join(homedir(), '.scripty_settings.json')
  if (!existsSync(settingsPath) && existsSync(legacy)) {
    try {
      copyFileSync(legacy, settingsPath)
    } catch {
      /* ignore */
    }
  }
}
