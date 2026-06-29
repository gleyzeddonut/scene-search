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
