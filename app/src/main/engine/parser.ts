import type { Scene, SceneBlock, LayoutLine } from './types'

// Bump whenever the parsing logic changes (this file, formats.ts, extract.ts).
// The persisted index records the version it was built with; on startup the
// engine compares it to this and forces a full re-parse of every file (not just
// changed ones) so parser improvements actually reach already-indexed scripts.
export const PARSER_VERSION = 9

// optional leading scene-number column (incl. "SC. 5.A5" from gutter numbers
// some PDF extractors place at the start of the heading line), an optional glued
// opening transition ("FADE IN: INT: CAFÉ"), and the amateur "INT:" colon form
export const SCENE_RE = /^\s*(?:FADE\s+IN\s*[:.]?\s*)?(?:SC\.?\s*)?(?:\d+[\dA-Za-z.]*[.)]?[\s*]+)?(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT|EXT|I\/E|E\/I)[.:\s]/i
// (the ordinal lookahead spares real location names like "30TH STREET STATION")
const SCENE_NUM_PREFIX = /^\s*(?:SC\.?\s*)?(?!\d+(?:ST|ND|RD|TH)\b)\d+[\dA-Za-z.]*[.)]?[\s*]+/i
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
  let h = squish(raw.replace(/^\s*FADE\s+IN\s*[:.]?\s*/i, '').replace(SCENE_NUM_PREFIX, ''))
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
    '|^(?:SC|SCENE|EPISODE|EP)\\.?\\s+\\d+[A-Za-z]?$' + // bare scene/episode labels
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
// Exported for cleanLayout's cue-column detection.
export function isCueShaped(t: string): boolean {
  // drop surrounding quotes first so a quoted line of dialogue ("...LYING!") isn't
  // mistaken for a cue by the trailing-punctuation guard below
  const base = squish(t.replace(PAREN_RE, '')).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  // real names are at most ~40 chars ("PORT AUTHORITY INFORMATION OFFICER" is 34)
  // and never contain a 3+ digit run — an ALL-CAPS insert like a sign with a phone
  // number does ("BURNHAM & ASSOCIATES REALTY 555-0195")
  if (!base || /[a-z]/.test(base) || base.length > 40 || /\d{3,}/.test(base)) return false
  // digit-named characters ("3", "1-2") — no letters at all, but a valid speaker
  if (!/[A-Z]/.test(base)) return /^\d{1,2}(?:-\d{1,2})?$/.test(base)
  if ('.!?'.includes(base[base.length - 1])) return false
  if (isNonCue(base)) return false
  const words = base.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 5
}

// the absolute words above, plus the relative/transition times a slug can also end
// with ("- CONTINUOUS", "- MOMENTS LATER"), plus qualified forms TV scripts use
// ("- THAT NIGHT", "- NEXT DAY", "- LATER THAT NIGHT"). Built from TOD_CORE so the
// word list lives in one place; "SAME TIME" precedes "SAME" so the longer match wins.
const TIME_OF_DAY_RE = new RegExp(
  '(?:--?|–|—)\\s*(?:(?:LATER\\s+)?(?:THE\\s+)?(?:NEXT|THAT|SAME)\\s+(?:' + TOD_CORE + ')' +
    '|' + TOD_CORE + '|CONTINUOUS|LATER|MOMENTS LATER|SAME TIME|SAME|MAGIC HOUR)\\s*$',
  'i'
)
const isAllCaps = (t: string) => /[A-Z]/.test(t) && !/[a-z]/.test(t.replace(PAREN_RE, ''))
// bare scene labels some sides use instead of slugs ("SCENE 2", "BEGIN SCENE 2")
const SCENE_LABEL_RE = /^(?:BEGIN\s+)?SCENE\s+\d+[A-Za-z]?:?$/i

// a REAL heading: an INT./EXT. slug, a SCENE-n label, or an ALL-CAPS location with
// a time-of-day suffix — content that only occurs in actual scripts. (The
// after-transition guess in isHeading is NOT real: "SHIP TO:" on a mailing label
// satisfies it exactly like "CUT TO:" would.)
function isRealHeading(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // A dotless "INT/EXT " slug (shorthand some scripts use) must be a caps-y line —
  // prose acronyms ("INT EQ PY means WAIVE INTEREST…" in a financial doc) are not
  // scenes. The dotted/colon forms (INT. / INT:) may be any case ("INT. Hospital Room.").
  if (SCENE_RE.test(text)) {
    return /(?:\b(?:INT|EXT)[.:]|\bI\/E\b|\bE\/I\b|INT\.?\/EXT|EXT\.?\/INT)/i.test(text) || isAllCaps(t)
  }
  if (SCENE_LABEL_RE.test(t)) return true
  return isAllCaps(t) && TIME_OF_DAY_RE.test(t)
}

// Does this document carry any script-exclusive marker? A real heading anywhere,
// or a standalone "FADE IN" line (sketch scripts open with FADE IN: and a bare
// location that only the after-transition guess can catch — but no mailing label,
// tax form, or slide deck ever says FADE IN).
function hasScriptMarker(lines: string[]): boolean {
  return lines.some((l) => isRealHeading(l) || (/\bFADE\s+IN\b/i.test(l) && l.trim().length <= 12))
}

// A scene heading is a REAL heading (above), or the first short ALL-CAPS location
// right after a transition ("FADE IN:" → location) — that guess recovers scripts
// that don't use INT./EXT., but only counts when the document has a real heading
// somewhere (the parsers reject documents made ONLY of guessed headings).
function isHeading(text: string, afterTransition: boolean): boolean {
  if (isRealHeading(text)) return true
  const t = text.trim()
  if (!t || !isAllCaps(t)) return false
  return afterTransition && t.split(/\s+/).filter(Boolean).length <= 9
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
  const freqBase = Math.min(...[...counts].filter(([, c]) => c >= maxC * 0.12).map(([b]) => b))
  // Sides excerpts are mostly dialogue, so the dialogue column can dominate the
  // frequency count and pull freqBase a full column right of the true margin — which
  // classifies every spoken line as indent-0 action. Real INT./EXT. slugs sit flush
  // to the true margin, so when they sit a full COLUMN left of freqBase (~48pt+),
  // trust them instead (median, so one stray can't drag the base off). A smaller gap
  // is a production slug's scene-number column (~30pt), NOT a wrong freqBase —
  // anchoring there pushes real action over the dialogue threshold.
  const headXs = lines.filter((l) => SCENE_RE.test(l.text)).map((l) => bucket(l.x)).sort((a, b) => a - b)
  const headBase = headXs.length ? headXs[headXs.length >> 1] : Infinity
  const base = headBase <= freqBase - 48 ? headBase : freqBase

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
  const prefix: LayoutLine[] = [] // lines before the first heading (sides often start mid-scene)
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
        topY: l.y, // heading baseline, points from the page top → preview scroll target
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
    if (!current) {
      prefix.push(l)
      continue
    }
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
  // if EVERY heading was an after-transition guess and nothing marks this document
  // as a script, it isn't one — "SHIP TO:" on a mailing label fabricates scenes
  // exactly like "CUT TO:" would. Return nothing; the strictly-gated fallbacks decide.
  if (scenes.length && !hasScriptMarker(lines.map((l) => l.text))) return []
  // dialogue that PRECEDES the first heading (an excerpt that starts mid-scene) —
  // recover it as a synthetic leading scene, under the same dialogue-heavy gate as a
  // fully headingless doc, so a title page or synopsis never becomes a scene
  if (scenes.length && prefix.length) {
    const pre = parseHeadingless(prefix, 3)
    if (pre.length) return [...pre, ...scenes].map((s, i) => ({ ...s, index: i + 1 }))
  }
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
  const prefix: string[] = [] // lines before the first heading (sides often start mid-scene)

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
    if (!current) {
      prefix.push(raw)
      continue
    }
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
  // same no-script-marker rejection as parseLayout (the mailing-label case)
  if (scenes.length && !hasScriptMarker(lines)) return []
  // same mid-scene-start recovery as parseLayout: a dialogue-heavy excerpt before
  // the first heading becomes a synthetic leading scene; anything else is dropped
  if (scenes.length && prefix.some((l) => l.trim())) {
    const pre = parseScenesHeadingless(prefix.join('\n'), 3)
    if (pre.length) return [...pre, ...scenes].map((s, i) => ({ ...s, index: i + 1 }))
  }
  return scenes
}

// Accept a synthesized single scene only if it genuinely reads like dialogue: at
// least two name-shaped speakers (alphabetic, no digits — so an ISBN or a spaced-out
// "DA Y 8 1" page label doesn't count) and at least minLines lines. Keeps prose docs
// (journals, transcripts, ad copy) parsing to nothing.
function dialogueHeavy(scenes: Scene[], minLines = 2): Scene[] {
  if (scenes.length !== 1 || scenes[0].lines.length < minLines) return []
  // spoken lines are short; a bill/ledger "reads" as caps-y labels each followed by
  // a few-hundred-word blob — require at least half the lines to be speech-length
  const lines = scenes[0].lines
  const short = lines.filter(([, t]) => t.split(/\s+/).length <= 60).length
  if (short < lines.length / 2) return []
  // spoken text is prose: mostly letters, mostly sentence case. Labels and forms
  // (shipping labels, 1099s) read as digit-dense ALL-CAPS values instead.
  const text = lines.map(([, t]) => t).join(' ')
  const digits = (text.match(/\d/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  if (digits > (digits + letters) * 0.12) return []
  const lower = lines.filter(([, t]) => /[a-z]/.test(t)).length
  if (lower < lines.length / 2) return []
  const realNames = scenes[0].characters.filter(
    (c) => !/\d/.test(c) && (c.match(/[A-Za-zÀ-ÿ]/g)?.length ?? 0) >= 2
  )
  return realNames.length >= 2 ? scenes : []
}

// Fallback for audition sides that have dialogue but NO scene heading at all:
// prepend a synthetic heading so the whole document parses as one scene, and keep
// it only if it really reads like dialogue. Returns [] otherwise.
// minLines: the pre-heading (prefix) recovery passes 3 — a production title page
// fabricates up to TWO cue/dialogue pairs (show title + draft label), which the
// whole-document floor of 2 would let through.
export function parseHeadingless(lines: LayoutLine[], minLines = 2): Scene[] {
  if (!lines.length) return []
  const x = lines.reduce((m, l) => Math.min(m, l.x), Infinity) // reduce, not spread
  return dialogueHeavy(parseLayout([{ text: 'SCENE 1', x, y: lines[0].y, page: lines[0].page }, ...lines]), minLines)
}
export function parseScenesHeadingless(text: string, minLines = 2): Scene[] {
  if (!text.trim()) return []
  return dialogueHeavy(parseScenes('SCENE 1\n' + text), minLines)
}

// Some commercials / AV scripts put the cue inline with a colon ("MOM: Nature.")
// instead of on its own line, so the normal parsers find no dialogue. As a last resort
// (only when everything else yielded no dialogue), rewrite those lines into ordinary
// cue + dialogue lines and reparse. Only speaker-style names qualify — technical labels
// (SFX, SUPER, TITLE…) and transitions (CUT TO:) are left as action. ALL-CAPS names
// qualify outright; a mixed-case name ("Man: …") must RECUR to count as a speaker, so
// one-off "Warning: …" prose never reads as dialogue.
const COLON_CUE_RE = /^\s*([A-Za-z][A-Za-z0-9 .'#/&-]{0,28}):[ \t]+(\S.*?)\s*$/
const MIXED_NAME_RE = /^[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,2}$/
const COLON_LABEL_RE =
  /^(SFX|VFX|FX|MUSIC|MUS|SOT|SUPER|SUPERS|TITLE|CARD|LOGO|TAG|DISCLAIMER|LEGAL|CHYRON|GRAPHIC|TEXT|PACK ?SHOT|NOTE|WARNING|REMEMBER|SETTING|LOCATION|SLATE|SYNOPSIS|SCENE|START|END|CHAPTER|PART|ACT|EPISODE|DISCUSSION|AGENDA|OVERVIEW|OBJECTIVES?|SUMMARY|HOMEWORK|INTRODUCTIONS?|CLASS|WEEK|SESSION|SURVEY|BREAK)$/
export function parseColonDialogue(text: string): Scene[] {
  const lines = text.split('\n')
  const matches = lines.map((l) => l.match(COLON_CUE_RE))
  const counts = new Map<string, number>()
  for (const m of matches) if (m) counts.set(normalizeCharacter(m[1]), (counts.get(normalizeCharacter(m[1])) || 0) + 1)
  const out: string[] = []
  let hits = 0
  for (let i = 0; i < lines.length; i++) {
    const m = matches[i]
    if (m) {
      const name = normalizeCharacter(m[1])
      const speakerShaped = isCueShaped(m[1]) || (MIXED_NAME_RE.test(m[1].trim()) && (counts.get(name) || 0) >= 2)
      if (speakerShaped && !isNonCue(name) && !COLON_LABEL_RE.test(name) && !TRANSITION_RE.test(m[1])) {
        out.push(name, m[2]) // cue on its own line, then the dialogue below it
        hits++
        continue
      }
    }
    out.push(lines[i])
  }
  if (hits < 2) return [] // need a real exchange
  const rewritten = out.join('\n')
  // colon scripts often still use real INT./EXT. slugs — keep them when they exist.
  // Gated on a genuine slug line: without one, parseScenes can only fabricate a
  // heading out of an after-transition ALL-CAPS line (a rewritten cue), so go
  // straight to the synthetic-single-scene path instead.
  if (lines.some((l) => SCENE_RE.test(l))) {
    const withHeads = parseScenes(rewritten).filter((s) => s.blocks.length > 0)
    if (withHeads.some((s) => s.lines.length)) return withHeads.map((s, i) => ({ ...s, index: i + 1 }))
  }
  return parseScenesHeadingless(rewritten)
}
