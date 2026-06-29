# Pure-JS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python sidecar with TypeScript engine modules in the Electron main process (called over IPC), so Scripty is a pure Electron+React app with no Python, no PyInstaller, no HTTP/CORS/token layer, and no native modules.

**Architecture:** Engine logic lives in `app/src/main/engine/` (pure TS), holds an in-memory index persisted as JSON in `userData`, and is exposed to the renderer via `ipcMain.handle` + preload. The React UI is unchanged except `api.ts` switches from `fetch` to `ipcRenderer.invoke`.

**Tech Stack:** TypeScript, Electron 31, React 18, vitest, pdfjs-dist (legacy/Node build), mammoth, fast-xml-parser.

## Global Constraints

- **Parity first:** behavior matches the current Python engine; no new parser heuristics. The Python suite is the reference spec.
- **No native modules.** Index is JSON in `app.getPath('userData')/scripty/`.
- **Engine runs in the Electron main process**; renderer talks to it via IPC (no token, no localhost HTTP).
- Script extensions: `.pdf .fountain .fdx .txt .docx`. Skip dirs: `node_modules __pycache__ .git Caches Library` and `*.app`.
- Runtime estimate: **130 wpm**.
- Final version: **1.6.0** (app + drop engine `version.py`).
- `npx vitest run` is runnable by the agent; `npm run dev` / electron-builder are **user-run** (build guardrail).

---

### Task 1: vitest + engine scaffolding

**Files:**
- Modify: `app/package.json`
- Create: `app/vitest.config.ts`
- Create: `app/src/main/engine/types.ts`

**Interfaces:**
- Produces: `Scene`, `SceneBlock`, `SceneMatch`, `Folders` types used by every later task; a `vitest` runner.

- [ ] **Step 1: Add deps + test script**

In `app/package.json` add to `devDependencies`: `"vitest": "^2.1.0"`, and to `dependencies`: `"pdfjs-dist": "^4.7.76"`, `"mammoth": "^1.8.0"`, `"fast-xml-parser": "^4.5.0"`. Add to `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: vitest config**

`app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/main/engine/**/*.test.ts'] }
})
```

- [ ] **Step 3: shared types**

`app/src/main/engine/types.ts`:
```ts
export type SceneBlock = { type: 'action'; text: string } | { type: 'cue'; who: string; text: string }

export interface Scene {
  heading: string
  index: number
  page: number
  characters: string[]
  lines: [string, string][]
  blocks: SceneBlock[]
}

export interface SceneMatch {
  script_path: string
  script_name: string
  heading: string
  page: number
  char_count: number
  characters: string[]
  pairing: string | null
  scene_index: number
  est_seconds: number
}

export interface Folders {
  roots: string[]
  ignored: string[]
}
```

- [ ] **Step 4: Install + verify vitest runs**

Run: `cd app && npm install && npx vitest run`
Expected: installs; vitest reports "No test files found" (exit 0) — config works.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/vitest.config.ts app/src/main/engine/types.ts
git commit -m "chore: vitest + engine scaffolding for JS migration"
```

---

### Task 2: gender.ts

**Files:**
- Create: `app/src/main/engine/data/names_gender.json` (copied)
- Create: `app/src/main/engine/gender.ts`
- Test: `app/src/main/engine/gender.test.ts`

**Interfaces:**
- Produces: `guessGender(name: string): 'male'|'female'|'unknown'`, `scenePairing(names: string[]): string | null`.

- [ ] **Step 1: Copy the names data**

Run: `mkdir -p app/src/main/engine/data && cp scenesearch/screenplay/names_gender.json app/src/main/engine/data/names_gender.json`

- [ ] **Step 2: Write the failing test**

`app/src/main/engine/gender.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { guessGender, scenePairing } from './gender'

describe('gender', () => {
  it('reads the names table', () => {
    expect(guessGender('JOHN')).toBe('male')
    expect(guessGender('MARY')).toBe('female')
  })
  it('falls back to role words', () => {
    expect(guessGender('WAITRESS')).toBe('female')
    expect(guessGender('OLD MAN')).toBe('male')
  })
  it('unknown when no signal', () => {
    expect(guessGender('ZZQX')).toBe('unknown')
  })
  it('pairs two-person scenes', () => {
    expect(scenePairing(['JOHN', 'MARY'])).toBe('MW')
    expect(scenePairing(['JOHN', 'MIKE'])).toBe('MM')
    expect(scenePairing(['MARY', 'EVE'])).toBe('WW')
    expect(scenePairing(['JOHN', 'ZZQX'])).toBe('has_unknown')
    expect(scenePairing(['JOHN'])).toBe(null)
    expect(scenePairing(['A', 'B', 'C'])).toBe(null)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd app && npx vitest run src/main/engine/gender.test.ts`
Expected: FAIL (cannot find `./gender`).

- [ ] **Step 4: Implement**

`app/src/main/engine/gender.ts`:
```ts
import table from './data/names_gender.json'

const NAMES = table as Record<string, string>

const ROLE_GENDER: Record<string, string> = {
  man: 'male', woman: 'female', boy: 'male', girl: 'female', guy: 'male', gal: 'female',
  gentleman: 'male', lady: 'female', mother: 'female', father: 'male', mom: 'female',
  mum: 'female', dad: 'male', husband: 'male', wife: 'female', son: 'male',
  daughter: 'female', brother: 'male', sister: 'female', grandmother: 'female',
  grandfather: 'male', grandma: 'female', grandpa: 'male', grandson: 'male',
  granddaughter: 'female', aunt: 'female', uncle: 'male', niece: 'female', nephew: 'male',
  king: 'male', queen: 'female', prince: 'male', princess: 'female', waiter: 'male',
  waitress: 'female', actor: 'male', actress: 'female', businessman: 'male',
  businesswoman: 'female', policeman: 'male', policewoman: 'female', widow: 'female',
  widower: 'male', bride: 'female', groom: 'male', girlfriend: 'female', boyfriend: 'male',
  stepmother: 'female', stepfather: 'male', mr: 'male', mrs: 'female', ms: 'female',
  sir: 'male', madam: 'female', maam: 'female'
}

const strip = (s: string) => s.replace(/^[.,'"]+|[.,'"]+$/g, '')

function fromTable(name: string): string {
  if (!name) return 'unknown'
  const first = strip(name.split(/\s+/)[0].toLowerCase())
  return NAMES[first] ?? 'unknown'
}

function roleGender(name: string): string {
  const found = new Set<string>()
  for (const tok of name.split(/\s+/)) {
    const key = strip(tok.toLowerCase())
    if (key in ROLE_GENDER) found.add(ROLE_GENDER[key])
  }
  return found.size === 1 ? [...found][0] : 'unknown'
}

export function guessGender(name: string): string {
  const g = fromTable(name)
  return g !== 'unknown' ? g : roleGender(name)
}

export function scenePairing(characters: string[]): string | null {
  const g = characters.map(guessGender)
  if (g.length !== 2) return null
  if (g.includes('unknown')) return 'has_unknown'
  if (g[0] === 'male' && g[1] === 'male') return 'MM'
  if (g[0] === 'female' && g[1] === 'female') return 'WW'
  return 'MW'
}
```

Also ensure `app/tsconfig` allows JSON imports: in `app/tsconfig.node.json` (the main-process config) set `"resolveJsonModule": true` under compilerOptions if not present.

- [ ] **Step 5: Run to verify it passes**

Run: `cd app && npx vitest run src/main/engine/gender.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/engine/gender.ts app/src/main/engine/gender.test.ts app/src/main/engine/data app/tsconfig.node.json
git commit -m "feat(engine): port gender inference to TS"
```

---

### Task 3: runtime.ts

**Files:**
- Create: `app/src/main/engine/runtime.ts`, `app/src/main/engine/runtime.test.ts`

**Interfaces:**
- Produces: `sceneWordCount(lines: [string,string][]): number`, `estimateSeconds(words: number): number`.

- [ ] **Step 1: Write the failing test**

`app/src/main/engine/runtime.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sceneWordCount, estimateSeconds } from './runtime'

describe('runtime', () => {
  it('counts words', () => {
    expect(sceneWordCount([['A', 'one two three'], ['B', 'four five']])).toBe(5)
  })
  it('estimates seconds at 130 wpm', () => {
    expect(estimateSeconds(130)).toBe(60)
    expect(estimateSeconds(0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/main/engine/runtime.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/engine/runtime.ts`:
```ts
const WPM = 130

export function sceneWordCount(lines: [string, string][]): number {
  return lines.reduce((n, [, text]) => n + text.split(/\s+/).filter(Boolean).length, 0)
}

export function estimateSeconds(words: number): number {
  return Math.round((words / WPM) * 60)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/main/engine/runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/engine/runtime.ts app/src/main/engine/runtime.test.ts
git commit -m "feat(engine): port runtime estimate to TS"
```

---

### Task 4: parser.ts

**Files:**
- Create: `app/src/main/engine/parser.ts`, `app/src/main/engine/parser.test.ts`

**Interfaces:**
- Consumes: `Scene`, `SceneBlock` from `types.ts`.
- Produces: `parseScenes(text: string): Scene[]`.

- [ ] **Step 1: Write the failing tests**

`app/src/main/engine/parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseScenes } from './parser'

describe('parseScenes', () => {
  it('detects scenes and characters', () => {
    const s = parseScenes('INT. DINER - DAY\n\nNEIL\nCoffee.\n\nEADY\nSure.\n\nEXT. STREET - NIGHT\n\nVINCE\nHi.\n')
    expect(s.map((x) => x.heading)).toEqual(['INT. DINER - DAY', 'EXT. STREET - NIGHT'])
    expect(s[0].characters).toEqual(['NEIL', 'EADY'])
  })
  it('captures dialogue lines', () => {
    const s = parseScenes('INT. ROOM - DAY\n\nJOHN\nHello there.\n\nMARY\nGo away,\nplease.\n')[0]
    expect(s.lines).toEqual([['JOHN', 'Hello there.'], ['MARY', 'Go away, please.']])
  })
  it('captures action + cue blocks in order', () => {
    const s = parseScenes('INT. ROOM - DAY\n\nA man enters and sits.\n\nJOHN\nHello there.\n\nShe looks away.\n')[0]
    expect(s.blocks).toEqual([
      { type: 'action', text: 'A man enters and sits.' },
      { type: 'cue', who: 'JOHN', text: 'Hello there.' },
      { type: 'action', text: 'She looks away.' }
    ])
  })
  it('handles numbered headings and empty text', () => {
    expect(parseScenes('')).toEqual([])
    expect(parseScenes('12  INT. OFFICE - DAY\n\nBOB\nHi.\n')[0].heading).toBe('INT. OFFICE - DAY')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/main/engine/parser.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement (faithful port of parse_scenes)**

`app/src/main/engine/parser.ts`:
```ts
import type { Scene, SceneBlock } from './types'

const SCENE_RE = /^\s*(?:\d+[A-Za-z]?[.)]?\s+)?(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT|EXT|I\/E|E\/I)[.\s]/i
const SCENE_NUM_PREFIX = /^\s*\d+[A-Za-z]?[.)]?\s+/
const TRANSITION_RE = /\b(FADE IN|FADE OUT|FADE TO BLACK|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE TO)\b/
const CUE_RE = /^[ \t]*[A-Z][A-Z0-9 .'\-]{0,30}(\([^)]*\))?[ \t]*$/
const PAREN_RE = /\([^)]*\)/g

const squish = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')

function normalizeCharacter(text: string): string {
  return squish(text.replace(PAREN_RE, '')).toUpperCase()
}

function nextNonEmpty(lines: string[], start: number): string | null {
  for (let j = start; j < lines.length; j++) if (lines[j].trim()) return lines[j]
  return null
}

function isCue(line: string): boolean {
  const stripped = line.trim()
  if (!stripped || SCENE_RE.test(line) || TRANSITION_RE.test(stripped)) return false
  if (!CUE_RE.test(line)) return false
  const name = normalizeCharacter(stripped)
  if (name && '.!?'.includes(name[name.length - 1])) return false
  const words = name.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 4 && /[A-Za-z]/.test(name)
}

export function parseScenes(text: string): Scene[] {
  if (!text) return []
  const hasPages = text.includes('\f')
  const lines = text.split('\n')
  const scenes: Scene[] = []
  let current: Scene | null = null
  let seen = new Set<string>()
  let page = 1
  let skipUntil = 0
  let action: string[] = []

  const flushAction = () => {
    if (current) {
      const joined = action.join(' ').trim()
      if (joined) current.blocks.push({ type: 'action', text: joined } as SceneBlock)
    }
    action = []
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    page += (raw.match(/\f/g) || []).length
    if (i < skipUntil) continue
    if (SCENE_RE.test(raw)) {
      flushAction()
      current = {
        heading: squish(raw.replace(SCENE_NUM_PREFIX, '')),
        index: scenes.length + 1,
        page: hasPages ? page : 0,
        characters: [],
        lines: [],
        blocks: []
      }
      scenes.push(current)
      seen = new Set()
      continue
    }
    if (!current) continue
    if (!raw.trim()) {
      flushAction()
      continue
    }
    if (isCue(raw)) {
      const nxt = nextNonEmpty(lines, i + 1)
      if (nxt === null || SCENE_RE.test(nxt)) {
        action.push(raw.trim())
        continue
      }
      flushAction()
      const name = normalizeCharacter(raw)
      if (!seen.has(name)) {
        seen.add(name)
        current.characters.push(name)
      }
      const said: string[] = []
      let j = i + 1
      while (j < lines.length) {
        const n = lines[j]
        if (!n.trim()) break
        if (SCENE_RE.test(n) || isCue(n)) break
        said.push(n.trim())
        j++
      }
      const joined = said.join(' ')
      if (said.length) current.lines.push([name, joined])
      current.blocks.push({ type: 'cue', who: name, text: joined } as SceneBlock)
      skipUntil = j
      continue
    }
    action.push(raw.trim())
  }
  flushAction()
  return scenes
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/main/engine/parser.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add app/src/main/engine/parser.ts app/src/main/engine/parser.test.ts
git commit -m "feat(engine): port screenplay parser to TS"
```

---

### Task 5: extract.ts

**Files:**
- Create: `app/src/main/engine/extract.ts`, `app/src/main/engine/extract.test.ts`

**Interfaces:**
- Produces: `extractPaginated(path: string): Promise<string>`, `ExtractionError`.

- [ ] **Step 1: Write the failing tests** (formats we can create in-test)

`app/src/main/engine/extract.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractPaginated } from './extract'

const d = mkdtempSync(join(tmpdir(), 'scripty-'))

describe('extract', () => {
  it('reads plaintext / fountain', async () => {
    const p = join(d, 'a.fountain')
    writeFileSync(p, 'INT. ROOM - DAY\n\nBOB\nHi.\n')
    expect(await extractPaginated(p)).toContain('INT. ROOM')
  })
  it('reads fdx Text nodes', async () => {
    const p = join(d, 'a.fdx')
    writeFileSync(
      p,
      '<?xml version="1.0"?><FinalDraft><Content>' +
        '<Paragraph Type="Scene Heading"><Text>INT. OFFICE - DAY</Text></Paragraph>' +
        '<Paragraph Type="Character"><Text>MICHAEL</Text></Paragraph>' +
        '<Paragraph Type="Dialogue"><Text>Sit.</Text></Paragraph>' +
        '</Content></FinalDraft>'
    )
    const t = await extractPaginated(p)
    expect(t).toContain('INT. OFFICE - DAY')
    expect(t).toContain('MICHAEL')
  })
  it('throws for unsupported extension', async () => {
    const p = join(d, 'a.xyz')
    writeFileSync(p, 'nope')
    await expect(extractPaginated(p)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/main/engine/extract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/engine/extract.ts`:
```ts
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

export class ExtractionError extends Error {}

const MAX_PAGES = 400
const MAX_CHARS = 400_000

async function extractPdf(path: string): Promise<string> {
  // legacy build runs in Node on the main thread (no worker needed for text)
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  const data = new Uint8Array(await readFile(path))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise
  const parts: string[] = []
  const pages = Math.min(doc.numPages, MAX_PAGES)
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // group items into lines using their y position
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const it of content.items as any[]) {
      const y = Math.round(it.transform[5])
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y)!.push({ x: it.transform[4], s: it.str })
    }
    const ys = [...rows.keys()].sort((a, b) => b - a)
    const text = ys
      .map((y) => rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join('').trimEnd())
      .join('\n')
    parts.push(text)
    if (parts.reduce((n, p) => n + p.length, 0) >= MAX_CHARS) break
  }
  return parts.join('\f').slice(0, MAX_CHARS)
}

async function extractDocx(path: string): Promise<string> {
  const mammoth: any = await import('mammoth')
  const { value } = await mammoth.extractRawText({ path })
  return String(value).slice(0, MAX_CHARS)
}

async function extractFdx(path: string): Promise<string> {
  const { XMLParser } = await import('fast-xml-parser')
  const xml = await readFile(path, 'utf-8')
  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: '#text' })
  const tree = parser.parse(xml)
  const texts: string[] = []
  const walk = (node: any) => {
    if (node == null) return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'Text') {
          if (Array.isArray(v)) v.forEach((x) => texts.push(typeof x === 'string' ? x : (x?.['#text'] ?? '')))
          else texts.push(typeof v === 'string' ? v : ((v as any)?.['#text'] ?? ''))
        } else walk(v)
      }
    }
  }
  walk(tree)
  return texts.filter(Boolean).join('\n').slice(0, MAX_CHARS)
}

export async function extractPaginated(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  try {
    if (ext === '.pdf') return await extractPdf(path)
    if (ext === '.docx') return await extractDocx(path)
    if (ext === '.fdx') return await extractFdx(path)
    if (ext === '.txt' || ext === '.fountain') return (await readFile(path, 'utf-8')).slice(0, MAX_CHARS)
  } catch (e) {
    throw new ExtractionError(`${path}: ${(e as Error).message}`)
  }
  throw new ExtractionError(`${path}: unsupported extension '${ext}'`)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/main/engine/extract.test.ts`
Expected: PASS (fountain, fdx, unsupported). PDF/docx are exercised by the library tests via generated fixtures and the dev smoke test.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/engine/extract.ts app/src/main/engine/extract.test.ts
git commit -m "feat(engine): port text extraction (pdfjs/mammoth/xml/fs)"
```

---

### Task 6: scanner.ts

**Files:**
- Create: `app/src/main/engine/scanner.ts`, `app/src/main/engine/scanner.test.ts`

**Interfaces:**
- Produces: `SCRIPT_EXTENSIONS: Set<string>`, `defaultRoots(): string[]`, async generator `iterCandidates(roots, opts)` where `opts = { ignoreDirs?: string[]; shouldCancel?: () => boolean; onError?: (path: string, err: unknown) => void }`.

- [ ] **Step 1: Write the failing tests**

`app/src/main/engine/scanner.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { iterCandidates } from './scanner'

async function collect(roots: string[], opts = {}) {
  const out: string[] = []
  for await (const p of iterCandidates(roots, opts)) out.push(p)
  return out
}

describe('scanner', () => {
  it('finds scripts and skips others', async () => {
    const d = mkdtempSync(join(tmpdir(), 's-'))
    writeFileSync(join(d, 'a.fountain'), 'x')
    writeFileSync(join(d, 'b.jpg'), 'x')
    mkdirSync(join(d, 'node_modules'))
    writeFileSync(join(d, 'node_modules', 'c.txt'), 'x')
    const got = await collect([d])
    expect(got.map((p) => p.split('/').pop())).toEqual(['a.fountain'])
  })
  it('reports unreadable root', async () => {
    const errs: string[] = []
    await collect([join(tmpdir(), 'does-not-exist-xyz')], { onError: (p: string) => errs.push(p) })
    expect(errs.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/main/engine/scanner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/engine/scanner.ts`:
```ts
import { readdir } from 'node:fs/promises'
import { join, extname, basename, resolve } from 'node:path'
import { homedir } from 'node:os'

export const SCRIPT_EXTENSIONS = new Set(['.pdf', '.fountain', '.fdx', '.txt', '.docx'])
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git', 'Caches', 'Library'])

export function defaultRoots(): string[] {
  const h = homedir()
  return [
    join(h, 'Downloads'),
    join(h, 'Desktop'),
    join(h, 'Documents'),
    join(h, 'Library/Mobile Documents/com~apple~CloudDocs/Documents')
  ]
}

interface Opts {
  ignoreDirs?: string[]
  shouldCancel?: () => boolean
  onError?: (path: string, err: unknown) => void
}

export async function* iterCandidates(roots: string[], opts: Opts = {}): AsyncGenerator<string> {
  const ignored = new Set((opts.ignoreDirs || []).map((p) => resolve(p)))
  const seen = new Set<string>()
  for (const root of roots) {
    if (ignored.has(resolve(root))) continue
    yield* walk(root, ignored, seen, opts)
  }
}

async function* walk(
  dir: string,
  ignored: Set<string>,
  seen: Set<string>,
  opts: Opts
): AsyncGenerator<string> {
  if (opts.shouldCancel?.()) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    opts.onError?.(dir, e)
    return
  }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (
        ent.name.startsWith('.') ||
        SKIP_DIRS.has(ent.name) ||
        ent.name.endsWith('.app') ||
        ignored.has(resolve(full))
      )
        continue
      yield* walk(full, ignored, seen, opts)
    } else if (ent.isFile()) {
      if (ent.name.startsWith('.')) continue
      if (!SCRIPT_EXTENSIONS.has(extname(ent.name).toLowerCase())) continue
      const rp = resolve(full)
      if (seen.has(rp)) continue
      seen.add(rp)
      yield full
    }
    if (opts.shouldCancel?.()) return
  }
}

export { basename }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/main/engine/scanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/engine/scanner.ts app/src/main/engine/scanner.test.ts
git commit -m "feat(engine): port folder scanner to TS"
```

---

### Task 7: library.ts (in-memory index)

**Files:**
- Create: `app/src/main/engine/library.ts`, `app/src/main/engine/library.test.ts`

**Interfaces:**
- Consumes: `extractPaginated`, `parseScenes`, `scenePairing`, `guessGender`, `sceneWordCount`, `estimateSeconds`, `iterCandidates`, types.
- Produces: class `Library` with: `reindex(folders, opts?)`, `query(filter)`, `getScene(path, index)`, `addFile(path)`, `scriptCount()`, `sceneCount()`, `toJSON()/fromJSON()`, and module fn `canonicalKey(name)`. Row types: `ScriptRow { path, name, mtime, sceneCount, pinned }`, `SceneRow { path, name, index, heading, page, charCount, characters, pairing, est, dialogue, content }`.

- [ ] **Step 1: Write the failing tests**

`app/src/main/engine/library.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Library, canonicalKey } from './library'

const SCRIPT = 'INT. DINER - DAY\n\nNEIL\nCoffee.\n\nEADY\nSure.\n\nEXT. STREET - NIGHT\n\nVINCE\nHi.\n'
const tmp = () => mkdtempSync(join(tmpdir(), 'lib-'))

describe('Library', () => {
  it('indexes scripts and scenes', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.fountain'), SCRIPT)
    const lib = new Library()
    await lib.reindex([d])
    expect(lib.scriptCount()).toBe(1)
    expect(lib.sceneCount()).toBe(2)
  })
  it('query filters by char count and returns gendered pairing', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.fountain'), SCRIPT)
    const lib = new Library(); await lib.reindex([d])
    const two = lib.query({ minChars: 2, maxChars: 2 })
    expect(two.map((m) => m.heading)).toEqual(['INT. DINER - DAY'])
    expect(two[0].scene_index).toBe(1)
  })
  it('getScene returns content blocks', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.fountain'), 'INT. OFFICE - DAY\n\nMICHAEL\nSit.\n')
    const lib = new Library(); await lib.reindex([d])
    const m = lib.query({ minChars: 1 })[0]
    const s = lib.getScene(m.script_path, m.scene_index)!
    expect(s.lines[0]).toEqual({ who: 'MICHAEL', text: 'Sit.' })
  })
  it('folds re-download copies', async () => {
    const d = tmp()
    writeFileSync(join(d, 'Wedding.fountain'), SCRIPT)
    writeFileSync(join(d, 'Wedding (1).fountain'), SCRIPT)
    const lib = new Library(); await lib.reindex([d])
    expect(lib.scriptCount()).toBe(2)
    const rows = lib.query({ minChars: 1 })
    expect(rows.length).toBe(2)
    expect(rows.every((r) => !r.script_name.includes('(1)'))).toBe(true)
  })
  it('survives one bad file', async () => {
    const d = tmp()
    writeFileSync(join(d, 'good.fountain'), SCRIPT)
    writeFileSync(join(d, 'bad.fountain'), SCRIPT)
    const lib = new Library()
    ;(lib as any)._extract = async (p: string) => {
      if (p.endsWith('bad.fountain')) throw new Error('boom')
      return SCRIPT
    }
    await lib.reindex([d])
    expect(lib.scriptCount()).toBe(1)
  })
  it('addFile detects duplicates and rejects non-scripts', async () => {
    const d = tmp(); const f = join(d, 'x.fountain'); writeFileSync(f, SCRIPT)
    const lib = new Library()
    expect(await lib.addFile(f)).toBe('added')
    expect(await lib.addFile(f)).toBe('exists')
    const n = join(d, 'note.md'); writeFileSync(n, 'hi')
    expect(await lib.addFile(n)).toBe('not_script')
  })
  it('canonicalKey strips copy suffixes', () => {
    expect(canonicalKey('Heat (1).pdf')).toBe('heat.pdf')
    expect(canonicalKey('Heat copy.pdf')).toBe('heat.pdf')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/main/engine/library.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/engine/library.ts`:
```ts
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { extractPaginated as realExtract } from './extract'
import { parseScenes } from './parser'
import { scenePairing, guessGender } from './gender'
import { sceneWordCount, estimateSeconds } from './runtime'
import { iterCandidates, SCRIPT_EXTENSIONS } from './scanner'
import type { SceneMatch, SceneBlock } from './types'

const PAREN_NUM = /\s*\(\d+\)$/
const COPY = /\s+copy(\s+\d+)?$/i

export function canonicalKey(filename: string): string {
  const dot = filename.lastIndexOf('.')
  let stem = dot >= 0 ? filename.slice(0, dot) : filename
  const ext = dot >= 0 ? filename.slice(dot) : ''
  let prev: string | null = null
  while (prev !== stem) {
    prev = stem
    stem = stem.replace(PAREN_NUM, '').replace(COPY, '')
  }
  return (stem.trim() + ext).toLowerCase()
}

interface ScriptRow { path: string; name: string; mtime: number; sceneCount: number; pinned: boolean }
interface SceneRow {
  path: string; name: string; index: number; heading: string; page: number
  charCount: number; characters: string[]; pairing: string | null; est: number
  dialogue: [string, string][]; content: SceneBlock[]
}

interface ReindexOpts {
  ignoreDirs?: string[]
  progress?: (name: string) => void
  shouldCancel?: () => boolean
  onError?: (path: string, err: unknown) => void
}

export class Library {
  private scripts = new Map<string, ScriptRow>()
  private scenes: SceneRow[] = []
  // overridable for tests
  _extract = realExtract

  scriptCount(): number {
    let n = 0
    for (const s of this.scripts.values()) if (s.sceneCount > 0) n++
    return n
  }
  sceneCount(): number {
    return this.scenes.length
  }

  toJSON() {
    return { scripts: [...this.scripts.values()], scenes: this.scenes }
  }
  fromJSON(data: { scripts: ScriptRow[]; scenes: SceneRow[] }) {
    this.scripts = new Map(data.scripts.map((s) => [s.path, s]))
    this.scenes = data.scenes
  }

  private async indexFile(path: string): Promise<void> {
    const rp = resolve(path)
    let mtime = 0
    try {
      mtime = (await stat(rp)).mtimeMs
    } catch {
      return
    }
    const existing = this.scripts.get(rp)
    if (existing && Math.abs(existing.mtime - mtime) < 1) return
    let text = ''
    try {
      text = await this._extract(rp)
    } catch {
      text = '' // unreadable → 0 scenes
    }
    const parsed = parseScenes(text)
    this.deleteScript(rp)
    this.scripts.set(rp, { path: rp, name: basename(rp), mtime, sceneCount: parsed.length, pinned: false })
    for (const s of parsed) {
      this.scenes.push({
        path: rp, name: basename(rp), index: s.index, heading: s.heading, page: s.page,
        charCount: s.characters.length, characters: s.characters, pairing: scenePairing(s.characters),
        est: estimateSeconds(sceneWordCount(s.lines)), dialogue: s.lines, content: s.blocks
      })
    }
  }

  private deleteScript(rp: string) {
    this.scripts.delete(rp)
    this.scenes = this.scenes.filter((s) => s.path !== rp)
  }

  async reindex(folders: string[], opts: ReindexOpts = {}): Promise<void> {
    const present = new Set<string>()
    let cancelled = false
    for await (const path of iterCandidates(folders, {
      ignoreDirs: opts.ignoreDirs,
      shouldCancel: opts.shouldCancel,
      onError: opts.onError
    })) {
      if (opts.shouldCancel?.()) { cancelled = true; break }
      present.add(resolve(path))
      try {
        await this.indexFile(path)
      } catch (e) {
        opts.onError?.(path, e) // never let one bad file abort the index
      }
      opts.progress?.(basename(path))
    }
    if (cancelled || opts.shouldCancel?.()) return
    for (const [path, row] of [...this.scripts]) {
      if (!present.has(path) && !row.pinned) this.deleteScript(path)
    }
  }

  query(f: { minChars?: number; maxChars?: number; pairing?: string | null }): SceneMatch[] {
    let rows = this.scenes.filter((s) => {
      if (f.minChars != null && s.charCount < f.minChars) return false
      if (f.maxChars != null && s.charCount > f.maxChars) return false
      if (f.pairing != null && s.pairing !== f.pairing) return false
      return true
    })
    // fold re-download copies: keep the representative (shortest name) per canonical key
    const rep = new Map<string, string>()
    const repName = new Map<string, string>()
    for (const s of rows) {
      const key = canonicalKey(s.name)
      if (!repName.has(key) || s.name.length < repName.get(key)!.length) {
        rep.set(key, s.path)
        repName.set(key, s.name)
      }
    }
    rows = rows.filter((s) => rep.get(canonicalKey(s.name)) === s.path)
    rows.sort((a, b) => (a.name === b.name ? a.index - b.index : a.name < b.name ? -1 : 1))
    return rows.map((s) => ({
      script_path: s.path, script_name: s.name, heading: s.heading, page: s.page,
      char_count: s.charCount, characters: s.characters, pairing: s.pairing,
      scene_index: s.index, est_seconds: s.est
    }))
  }

  getScene(path: string, index: number) {
    const s = this.scenes.find((x) => x.path === path && x.index === index)
    if (!s) return null
    return {
      heading: s.heading,
      characters: s.characters.map((n) => ({ name: n, gender: guessGender(n) })),
      lines: s.dialogue.map(([who, text]) => ({ who, text })),
      content: s.content,
      est_seconds: s.est
    }
  }

  async addFile(path: string): Promise<'added' | 'exists' | 'not_script' | 'unreadable'> {
    const rp = resolve(path)
    const ext = rp.slice(rp.lastIndexOf('.')).toLowerCase()
    if (!SCRIPT_EXTENSIONS.has(ext)) return 'not_script'
    if (this.scripts.has(rp)) return 'exists'
    try {
      await this.indexFile(rp)
    } catch {
      return 'unreadable'
    }
    const row = this.scripts.get(rp)
    if (!row) return 'unreadable'
    if (row.sceneCount === 0) {
      this.deleteScript(rp)
      return 'not_script'
    }
    row.pinned = true
    return 'added'
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/main/engine/library.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/main/engine/library.ts app/src/main/engine/library.test.ts
git commit -m "feat(engine): in-memory Library (index/query/fold/addFile)"
```

---

### Task 8: store.ts (settings + index persistence + migration)

**Files:**
- Create: `app/src/main/engine/store.ts`, `app/src/main/engine/store.test.ts`

**Interfaces:**
- Produces: `Settings` class (`getRoots()/setRoots()/getIgnored()/setIgnored()`, returns `null` when never set) backed by a JSON file; `loadIndex(dir): {scripts,scenes}|null` and `saveIndex(dir, data)`; `migrateLegacySettings(userDir)`.

- [ ] **Step 1: Write the failing test**

`app/src/main/engine/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Settings, saveIndex, loadIndex } from './store'

describe('store', () => {
  it('roots are null until set, then persist', () => {
    const d = mkdtempSync(join(tmpdir(), 'st-'))
    const s = new Settings(join(d, 'settings.json'))
    expect(s.getRoots()).toBe(null)
    s.setRoots(['/a', '/b'])
    expect(new Settings(join(d, 'settings.json')).getRoots()).toEqual(['/a', '/b'])
  })
  it('index round-trips', () => {
    const d = mkdtempSync(join(tmpdir(), 'st-'))
    expect(loadIndex(d)).toBe(null)
    saveIndex(d, { scripts: [{ path: '/a', name: 'a', mtime: 1, sceneCount: 1, pinned: false }], scenes: [] })
    expect(loadIndex(d)!.scripts[0].name).toBe('a')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/main/engine/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/engine/store.ts`:
```ts
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
  getRoots() { return this.getList('roots') }
  setRoots(v: string[]) { this.setList('roots', v) }
  getIgnored() { return this.getList('ignored') }
  setIgnored(v: string[]) { this.setList('ignored', v) }
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/main/engine/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/engine/store.ts app/src/main/engine/store.test.ts
git commit -m "feat(engine): settings + JSON index persistence (+legacy migration)"
```

---

### Task 9: engine façade + IPC handlers + preload

**Files:**
- Create: `app/src/main/engine/engine.ts` (was `app/src/main/engine.ts` — replace the old sidecar one)
- Modify: `app/src/main/index.ts`, `app/src/preload/index.ts`

**Interfaces:**
- Consumes: `Library`, `Settings`, `loadIndex/saveIndex/migrateLegacySettings`, `defaultRoots`.
- Produces: `Engine` singleton with methods mirroring the IPC routes; `ipcMain.handle` for each; preload `window.scripty.engine.*`.

- [ ] **Step 1: Delete the old sidecar engine + write the façade**

Delete `app/src/main/engine.ts` (the PyInstaller/sidecar spawner). Create `app/src/main/engine/engine.ts`:
```ts
import { app } from 'electron'
import { join } from 'node:path'
import { Library } from './library'
import { Settings, loadIndex, saveIndex, migrateLegacySettings, ensureDir } from './store'
import { defaultRoots } from './scanner'

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
        characters: m.characters.map((n) => ({ name: n, gender: require('./gender').guessGender(n) }))
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
    ;(async () => {
      try {
        await this.lib.reindex(roots, {
          ignoreDirs: ignored,
          progress: () => { this.state.scanned++ },
          shouldCancel: () => this.state.cancel,
          onError: (p) => { if (p) { bad.add(p); this.state.errors = [...bad].sort() } }
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
    return { result, name: require('node:path').basename(path) }
  }
}
```

- [ ] **Step 2: Register IPC + start engine (replace sidecar wiring in index.ts)**

In `app/src/main/index.ts`: remove the `startEngine`/`EngineHandle`/`enginePromise`/`engine-info` sidecar code and the `before-quit` engine kill. Add near the top:
```ts
import { Engine } from './engine/engine'
let engine: Engine
```
In `registerIpc()` add (and keep `read-file`, `export-sides`, `app-version`, `check-updates`, `pick-folder`):
```ts
  ipcMain.handle('eng:getFolders', () => engine.getFolders())
  ipcMain.handle('eng:setFolders', (_e, r: string[], ig: string[]) => engine.setFolders(r, ig))
  ipcMain.handle('eng:stats', () => engine.stats())
  ipcMain.handle('eng:scenes', (_e, f) => engine.scenes(f))
  ipcMain.handle('eng:scene', (_e, p: string, i: number) => engine.scene(p, i))
  ipcMain.handle('eng:reindex', () => engine.reindex())
  ipcMain.handle('eng:reindexStatus', () => engine.reindexStatus())
  ipcMain.handle('eng:reindexStop', () => engine.reindexStop())
  ipcMain.handle('eng:add', (_e, p: string) => engine.add(p))
  ipcMain.handle('eng:open', (_e, p: string) => { shell.openPath(p); return { ok: true } })
  ipcMain.handle('eng:reveal', (_e, p: string) => { shell.showItemInFolder(p); return { ok: true } })
```
In `createWindow()` replace the `enginePromise = startEngine()` block with:
```ts
  engine = new Engine()
```
The renderer no longer needs `engine-info`; remove that handler.

- [ ] **Step 3: Preload — expose the engine methods**

In `app/src/preload/index.ts` add to the exposed object:
```ts
  engine: {
    getFolders: () => ipcRenderer.invoke('eng:getFolders'),
    setFolders: (r: string[], ig: string[]) => ipcRenderer.invoke('eng:setFolders', r, ig),
    stats: () => ipcRenderer.invoke('eng:stats'),
    scenes: (f: unknown) => ipcRenderer.invoke('eng:scenes', f),
    scene: (p: string, i: number) => ipcRenderer.invoke('eng:scene', p, i),
    reindex: () => ipcRenderer.invoke('eng:reindex'),
    reindexStatus: () => ipcRenderer.invoke('eng:reindexStatus'),
    reindexStop: () => ipcRenderer.invoke('eng:reindexStop'),
    add: (p: string) => ipcRenderer.invoke('eng:add', p),
    open: (p: string) => ipcRenderer.invoke('eng:open', p),
    reveal: (p: string) => ipcRenderer.invoke('eng:reveal', p)
  }
```
Remove `engineInfo` from preload.

- [ ] **Step 4: Typecheck**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: errors only in `api.ts` (fixed next task) — note them; the main/preload should type-check.

- [ ] **Step 5: Commit**

```bash
git add app/src/main app/src/preload
git commit -m "feat: in-process engine façade + IPC (replaces the sidecar)"
```

---

### Task 10: renderer api.ts → IPC

**Files:**
- Modify: `app/src/renderer/src/api.ts`

**Interfaces:**
- Consumes: `window.scripty.engine.*`.
- Produces: same `api` object shape the views already use (so Browse/Prepare/Library/Settings are untouched).

- [ ] **Step 1: Replace transport**

In `app/src/renderer/src/api.ts`: delete `init()`, `base`, `token`, and the `call()` fetch helper. Update the global `Window['scripty']` type to drop `engineInfo` and add the `engine` object (mirror the preload signatures, returning `Promise<any>`). Rewrite `api` to call IPC:
```ts
export const api = {
  getFolders: () => window.scripty.engine.getFolders() as Promise<{ roots: string[]; ignored: string[] }>,
  setFolders: (roots: string[], ignored: string[]) => window.scripty.engine.setFolders(roots, ignored),
  reindex: () => window.scripty.engine.reindex(),
  reindexStop: () => window.scripty.engine.reindexStop(),
  reindexStatus: () =>
    window.scripty.engine.reindexStatus() as Promise<{
      running: boolean; scanned: number; scripts: number; scenes: number; errors: string[]
    }>,
  stats: () => window.scripty.engine.stats() as Promise<{ scripts: number; scenes: number }>,
  scenes: (p: { min_chars?: number; max_chars?: number; pairing?: string; search?: string }) =>
    window.scripty.engine.scenes(p) as Promise<{ scenes: Scene[] }>,
  getScene: (path: string, index: number) =>
    window.scripty.engine.scene(path, index) as Promise<SceneDetail>,
  addScript: (path: string) =>
    window.scripty.engine.add(path) as Promise<{ result: 'added' | 'exists' | 'not_script' | 'unreadable'; name: string }>,
  openFile: (path: string) => window.scripty.engine.open(path),
  revealFile: (path: string) => window.scripty.engine.reveal(path),
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
```

- [ ] **Step 2: App.tsx no longer awaits init()**

In `app/src/renderer/src/App.tsx`: the startup `init().then(...)` becomes an immediate-ready (the engine is in-process, always available). Replace the init effect body with:
```ts
    setReady(true)
    window.scripty.onOpenSettings(() => setSettingsOpen(true))
```
and remove the `import { init } from './api'` (keep `api`). Remove `failed`/`Couldn't start the engine` (no async engine to fail) — or keep `failed` unused; simplest: drop the `failed` state and its branch.

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/api.ts app/src/renderer/src/App.tsx
git commit -m "feat: renderer talks to the in-process engine over IPC (no fetch)"
```

---

### Task 11: delete the Python engine + sidecar packaging

**Files:**
- Delete: `scenesearch/`, `tests/` (Python), `packaging/scripty-engine.spec`, `packaging/engine_entry.py`, `packaging/build_engine.sh`, `requirements.txt`, `pytest`/venv refs
- Modify: `app/electron-builder.yml`, `packaging/build_app.sh`, `app/package.json` (version), `.gitignore`, `README.md`, `app/src/main/engine.ts` (already deleted), `app/src/main/updater.ts` (unchanged)

**Interfaces:** none (cleanup).

- [ ] **Step 1: Remove Python + engine packaging**

```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
git rm -r scenesearch tests packaging/scripty-engine.spec packaging/engine_entry.py packaging/build_engine.sh requirements.txt 2>/dev/null
```
Remove the `dist-engine`/`.venv-intel` lines from `.gitignore`.

- [ ] **Step 2: electron-builder — drop engine extraResources**

In `app/electron-builder.yml` remove the entire `extraResources:` block (the engine-arm64/engine-x64 entries). Keep the rest (sign/notarize/icon/entitlements/publish).

- [ ] **Step 3: Simplify build_app.sh**

Replace `packaging/build_app.sh` body with:
```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && cd .. && pwd)"
cd "$ROOT/app"
PUBLISH="${PUBLISH:-never}"
npx electron-vite build && npx electron-builder --mac --arm64 --x64 --publish "$PUBLISH"
echo "Done -> app/dist/"
```

- [ ] **Step 4: Version bump + README**

Set `app/package.json` `"version": "1.6.0"`. In `README.md` replace the Python/PyInstaller sections with the new flow (`cd app && npm install`, `npm run dev`, `./packaging/build_app.sh`), and the test command `cd app && npx vitest run`.

- [ ] **Step 5: Full engine test pass + typecheck**

Run: `cd app && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all engine tests pass; typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Python sidecar + PyInstaller packaging; bump to 1.6.0"
```

---

### Task 12: dev smoke test + packaged build (user-run)

**Files:** none.

**Interfaces:** the running app.

- [ ] **Step 1: Dev smoke test (user)**

User runs `cd app && npm install && npm run dev`. Verify: window opens instantly (no "Starting engine…"); Library lists folders (carried from the old settings) + stats; Re-index runs and counts climb; Browse shows scenes; PDF view renders; drag-drop adds a file; Prepare works. Paste any Console errors.

- [ ] **Step 2: Packaged build (user)**

User runs `./packaging/build_app.sh` (then `PUBLISH=always ...` with `GH_TOKEN` to release 1.6.0). Verify the `.app` launches, indexes a real folder (with the macOS permission prompt), and is dramatically smaller than 1.5.x.

- [ ] **Step 3: Agent verification**

After the user reports a build, the agent runs `codesign --verify` + `spctl -a -vv` on `app/dist/mac-arm64/Scripty.app` and confirms `accepted / Notarized`.

---

## Self-Review

**Spec coverage:** extract (pdfjs/mammoth/xml/fs) → Task 5; parser → Task 4; gender → Task 2; runtime → Task 3; scanner → Task 6; library (in-memory, fold, cancel, addFile, bad-file resilience, pinned prune) → Task 7; store (JSON persistence + legacy settings migration) → Task 8; IPC façade + main/preload → Task 9; renderer IPC swap → Task 10; delete Python + packaging + 1.6.0 → Task 11; smoke/build → Task 12. Parity, no-native-modules, 130 wpm, extensions/skip-dirs, vitest-runnable — all covered. ✓

**Placeholder scan:** No TBDs; every code step has complete code. The only deferred items are the explicit Non-Goals (heuristics/OCR), not placeholders. ✓

**Type consistency:** `Scene/SceneBlock/SceneMatch` (Task 1) consumed by parser (4), library (7), engine (9). `guessGender/scenePairing` (2) used by library (7) + engine (9). `extractPaginated` (5) used by library (7, overridable as `_extract`). `iterCandidates(roots, {ignoreDirs,shouldCancel,onError})` (6) used by library (7). `Library.{reindex,query,getScene,addFile,toJSON,fromJSON,scriptCount,sceneCount}` (7) used by engine (9). `Settings`, `loadIndex/saveIndex/migrateLegacySettings` (8) used by engine (9). IPC channel names `eng:*` consistent across main (9) and preload (9) and api (10). `api` object shape unchanged for the views (10). ✓
