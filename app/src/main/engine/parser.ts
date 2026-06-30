import type { Scene, SceneBlock, LayoutLine } from './types'

// Bump whenever the parsing logic changes (this file, formats.ts, extract.ts).
// The persisted index records the version it was built with; on startup the
// engine compares it to this and forces a full re-parse of every file (not just
// changed ones) so parser improvements actually reach already-indexed scripts.
export const PARSER_VERSION = 3

// optional leading scene-number column (incl. "SC. 5.A5" from gutter numbers
// some PDF extractors place at the start of the heading line)
export const SCENE_RE = /^\s*(?:SC\.?\s*)?(?:\d+[\dA-Za-z.]*[.)]?[\s*]+)?(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT|EXT|I\/E|E\/I)[.\s]/i
const SCENE_NUM_PREFIX = /^\s*(?:SC\.?\s*)?\d+[\dA-Za-z.]*[.)]?[\s*]+/
// A gutter scene number fused directly onto the END of a word or paren with NO
// space ("TONYA100", "(YD11)2", "CHEMO45", "CLASS6pt", "LATER31pt1"). The lookbehind
// requires a word-char before the fused letter, so a standalone unit label
// ("ROOM B2") is kept. A SPACE-separated trailing number is never touched, so real
// location numbers ("STUDIO 54", "DALLAS, 1963") and TV story-day labels
// ("INT. KITCHEN - DAY 3") survive — those can't be told apart from a gutter number.
const TRAILING_FUSED_NUM = /(?<=[A-Za-z0-9)])([A-Za-z)])\d[\d.]*(?:pt\d*)?$/i
const TRANSITION_RE = /\b(FADE IN|FADE OUT|FADE TO BLACK|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE TO)\b/
const CUE_RE = /^[ \t]*[A-Z][A-Z0-9 .'\-]{0,30}(\([^)]*\))?[ \t]*$/
const PAREN_RE = /\([^)]*\)/g

export const squish = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')

// build a clean heading: drop the leading scene-number column, a trailing revision
// asterisk, and the right-gutter scene number (whether spaced after a time-of-day
// or fused directly onto the last word)
function cleanHeading(raw: string): string {
  let h = squish(raw.replace(SCENE_NUM_PREFIX, ''))
  h = h.replace(/\s*\*+\s*$/, '') // trailing revision mark(s)
  h = h.replace(TRAILING_FUSED_NUM, '$1')
  return h.trimEnd()
}

export function normalizeCharacter(text: string): string {
  return squish(text.replace(PAREN_RE, '')).toUpperCase()
}

// the absolute time-of-day words a slug can end with — shared by the cue filter
// (story-day labels like "DAY 9") and the heading detector, so they stay in sync
const TOD_CORE = 'DAY|NIGHT|MORNING|EVENING|AFTERNOON|DUSK|DAWN|NOON|MIDNIGHT|SUNSET|SUNRISE'

// Short ALL-CAPS lines that look like a character cue but never are: time cuts
// ("MOMENTS LATER", "AN HOUR LATER"), scene/act markers ("END", "END SC 1"),
// story-day labels ("DAY 9", "MAGIC HOUR"), and page/cast-list artifacts. Used to
// keep these out of the character list. (\bLATER$ won't match a name like SLATER.)
const NON_CUE_RE = new RegExp(
  '\\bLATER$' +
    '|^CONTINUOUS$|^CONTINUED$|^SAME(?:\\s+TIME)?$|^MAGIC\\s+HOUR$' +
    '|^(?:' + TOD_CORE + ')\\s+\\d+$' +
    '|^(?:THE\\s+)?END(?:\\s+OF\\s+(?:SCENE|ACT|EPISODE|SHOW))?$' +
    '|^(?:BEGIN|END)\\s+SC(?:ENE)?\\.?\\s*\\d*$|^BACK\\s+TO\\b' +
    '|^OMITTED$|^PAGE\\s+\\d+(?:\\s+OF\\s+\\d+)?$|^\\d+\\s+SCENES?$|^CAST\\s+LIST$|^SET\\s+LIST$'
)
function isNonCue(name: string): boolean {
  return NON_CUE_RE.test(name.trim())
}

function nextNonEmpty(lines: string[], start: number): string | null {
  for (let j = start; j < lines.length; j++) if (lines[j].trim()) return lines[j]
  return null
}

function isCue(line: string): boolean {
  const stripped = line.trim()
  if (!stripped || isHeading(line, false) || TRANSITION_RE.test(stripped)) return false
  if (!CUE_RE.test(line)) return false
  const name = normalizeCharacter(stripped)
  if (name && '.!?'.includes(name[name.length - 1])) return false
  if (isNonCue(name)) return false
  const words = name.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 4 && /[A-Za-z]/.test(name)
}

// A line is "cue-shaped" if it reads like a character name: uppercase, short, no
// sentence-ending punctuation (parentheticals like (V.O.) are stripped first).
function isCueShaped(t: string): boolean {
  // drop surrounding quotes first so a quoted line of dialogue ("...LYING!") isn't
  // mistaken for a cue by the trailing-punctuation guard below
  const base = squish(t.replace(PAREN_RE, '')).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (!base || /[a-z]/.test(base) || !/[A-Z]/.test(base)) return false
  if ('.!?'.includes(base[base.length - 1])) return false
  if (isNonCue(base)) return false
  const words = base.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 5
}

// the absolute words above, plus the relative/transition times a slug can also end
// with ("- CONTINUOUS", "- MOMENTS LATER"). Built from TOD_CORE so the word list
// lives in one place; "SAME TIME" precedes "SAME" so the longer match wins.
const TIME_OF_DAY_RE = new RegExp(
  '(?:--?|–|—)\\s*(' + TOD_CORE + '|CONTINUOUS|LATER|MOMENTS LATER|SAME TIME|SAME|MAGIC HOUR)\\s*$',
  'i'
)
const isAllCaps = (t: string) => /[A-Z]/.test(t) && !/[a-z]/.test(t.replace(PAREN_RE, ''))
// bare scene labels some sides use instead of slugs ("SCENE 2", "BEGIN SCENE 2")
const SCENE_LABEL_RE = /^(?:BEGIN\s+)?SCENE\s+\d+[A-Za-z]?:?$/i

// A scene heading is INT./EXT., a bare SCENE-n label, an ALL-CAPS location with a
// time-of-day suffix ("KITCHEN - NIGHT"), or the first short ALL-CAPS location right
// after a transition ("FADE IN:" → location). Lets us recover scripts that don't
// use INT./EXT.
function isHeading(text: string, afterTransition: boolean): boolean {
  const t = text.trim()
  if (!t) return false
  if (SCENE_RE.test(text)) return true
  if (SCENE_LABEL_RE.test(t)) return true
  if (!isAllCaps(t)) return false
  if (TIME_OF_DAY_RE.test(t)) return true
  if (afterTransition && t.split(/\s+/).filter(Boolean).length <= 9) return true
  return false
}

// Layout-aware parser for PDFs: classify each line by its left indentation rather
// than guessing from ALL-CAPS regex. Margins are derived per-document so it adapts
// to different page geometry. Headings flush-left, dialogue indented, character
// cues indented furthest, transitions/parentheticals handled by content.
export function parseLayout(rawLines: LayoutLine[]): Scene[] {
  const lines = rawLines.filter((l) => l.text.trim())
  if (!lines.length) return []

  // base margin = the smallest left-x that occurs often (ignores stray gutter text)
  const bucket = (x: number) => Math.round(x / 3) * 3
  const counts = new Map<number, number>()
  for (const l of lines) counts.set(bucket(l.x), (counts.get(bucket(l.x)) || 0) + 1)
  const maxC = Math.max(...counts.values())
  const base = Math.min(...[...counts].filter(([, c]) => c >= maxC * 0.12).map(([b]) => b))

  // cue margin = median left-x of indented cue-shaped lines → sets the indent scale
  const cueXs = lines.filter((l) => l.x - base > 24 && isCueShaped(l.text)).map((l) => l.x).sort((a, b) => a - b)
  const cueIndent = Math.max((cueXs.length ? cueXs[cueXs.length >> 1] : base + 144) - base, 48)
  const dialogueMin = cueIndent * 0.2
  const cueMin = cueIndent * 0.6

  type Role = 'CUE' | 'DIALOGUE' | 'PAREN' | 'ACTION'
  const classify = (l: LayoutLine): Role => {
    const t = l.text.trim()
    const indent = l.x - base
    if (t.startsWith('(')) return 'PAREN'
    if (indent >= cueMin && isCueShaped(t)) return 'CUE'
    if (indent >= dialogueMin) return 'DIALOGUE'
    return 'ACTION'
  }

  const scenes: Scene[] = []
  let current: Scene | null = null
  let seen = new Set<string>()
  let action: string[] = []
  let pending: { name: string; said: string[] } | null = null

  const flushAction = () => {
    if (current && action.length) {
      const t = action.join(' ').trim()
      if (t) current.blocks.push({ type: 'action', text: t } as SceneBlock)
    }
    action = []
  }
  const flushDialogue = () => {
    if (!current || !pending) {
      pending = null
      return
    }
    const text = pending.said.join(' ').trim()
    if (text) {
      if (!seen.has(pending.name)) {
        seen.add(pending.name)
        current.characters.push(pending.name)
      }
      current.lines.push([pending.name, text])
      current.blocks.push({ type: 'cue', who: pending.name, text } as SceneBlock)
    } else {
      action.push(pending.name) // a cue with no dialogue is really action
    }
    pending = null
  }

  let afterTransition = false
  for (const l of lines) {
    const t = l.text.trim()
    const flushLeft = l.x - base < cueIndent * 0.5
    if (flushLeft && isHeading(l.text, afterTransition)) {
      flushDialogue()
      flushAction()
      current = {
        heading: cleanHeading(l.text),
        index: scenes.length + 1,
        page: l.page,
        characters: [],
        lines: [],
        blocks: []
      }
      scenes.push(current)
      seen = new Set()
      afterTransition = false
      continue
    }
    if (flushLeft && (TRANSITION_RE.test(t) || /\bTO:$/.test(t))) {
      flushDialogue()
      afterTransition = true // the next flush-left ALL-CAPS line is likely a new scene
      continue
    }
    afterTransition = false
    if (!current) continue
    const role = classify(l)
    if (role === 'CUE') {
      flushDialogue()
      flushAction()
      pending = { name: normalizeCharacter(l.text), said: [] }
    } else if (role === 'DIALOGUE') {
      if (pending) pending.said.push(l.text.trim())
      else action.push(l.text.trim())
    } else if (role === 'ACTION') {
      flushDialogue()
      action.push(l.text.trim())
    }
    // PAREN: ignored (not spoken text, not action)
  }
  flushDialogue()
  flushAction()
  return scenes
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
  let afterTransition = false

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
    if (isHeading(raw, afterTransition)) {
      flushAction()
      current = {
        heading: cleanHeading(raw),
        index: scenes.length + 1,
        page: hasPages ? page : 0,
        characters: [],
        lines: [],
        blocks: []
      }
      scenes.push(current)
      seen = new Set()
      afterTransition = false
      continue
    }
    if (raw.trim() && (TRANSITION_RE.test(raw.trim()) || /\bTO:$/.test(raw.trim()))) {
      flushAction()
      afterTransition = true // the next ALL-CAPS location line is likely a new scene
      continue
    }
    if (raw.trim()) afterTransition = false
    if (!current) continue
    if (!raw.trim()) {
      flushAction()
      continue
    }
    if (isCue(raw)) {
      const nxt = nextNonEmpty(lines, i + 1)
      if (nxt === null || isHeading(nxt, false)) {
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
        if (isHeading(n, false) || isCue(n)) break
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

// Accept a synthesized single scene only if it genuinely reads like dialogue: at
// least two name-shaped speakers (alphabetic, no digits — so an ISBN or a spaced-out
// "DA Y 8 1" page label doesn't count) and at least two lines. Keeps prose docs
// (journals, transcripts, ad copy) parsing to nothing.
function dialogueHeavy(scenes: Scene[]): Scene[] {
  if (scenes.length !== 1 || scenes[0].lines.length < 2) return []
  const realNames = scenes[0].characters.filter(
    (c) => !/\d/.test(c) && (c.match(/[A-Za-zÀ-ÿ]/g)?.length ?? 0) >= 2
  )
  return realNames.length >= 2 ? scenes : []
}

// Fallback for audition sides that have dialogue but NO scene heading at all:
// prepend a synthetic heading so the whole document parses as one scene, and keep
// it only if it really reads like dialogue. Returns [] otherwise.
export function parseHeadingless(lines: LayoutLine[]): Scene[] {
  if (!lines.length) return []
  const x = lines.reduce((m, l) => Math.min(m, l.x), Infinity) // reduce, not spread
  return dialogueHeavy(parseLayout([{ text: 'SCENE 1', x, page: lines[0].page }, ...lines]))
}
export function parseScenesHeadingless(text: string): Scene[] {
  if (!text.trim()) return []
  return dialogueHeavy(parseScenes('SCENE 1\n' + text))
}
