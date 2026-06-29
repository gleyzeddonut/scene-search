import { XMLParser } from 'fast-xml-parser'
import type { Scene } from './types'
import { SCENE_RE, squish, normalizeCharacter } from './parser'

// ---- Final Draft (.fdx): paragraphs are explicitly typed, so parse them directly ----

function fdxText(p: any): string {
  const t = p?.Text
  if (t == null) return ''
  const arr = Array.isArray(t) ? t : [t]
  return arr.map((x) => (typeof x === 'string' ? x : (x?.['#text'] ?? ''))).join('')
}

export function parseFdx(xml: string): Scene[] {
  let tree: any
  try {
    tree = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' }).parse(xml)
  } catch {
    return []
  }
  const content = tree?.FinalDraft?.Content
  if (!content) return []
  let paras = content.Paragraph
  if (!paras) return []
  if (!Array.isArray(paras)) paras = [paras]

  const scenes: Scene[] = []
  let current: Scene | null = null
  let seen = new Set<string>()
  let pending: string | null = null

  for (const p of paras) {
    const type = (p?.['@_Type'] || 'Action') as string
    const text = squish(fdxText(p))
    if (!text) continue
    if (type === 'Scene Heading') {
      current = { heading: text, index: scenes.length + 1, page: 0, characters: [], lines: [], blocks: [] }
      scenes.push(current)
      seen = new Set()
      pending = null
    } else if (!current) {
      continue
    } else if (type === 'Character') {
      const name = normalizeCharacter(text)
      pending = name
      if (!seen.has(name)) {
        seen.add(name)
        current.characters.push(name)
      }
    } else if (type === 'Dialogue') {
      if (pending) {
        current.lines.push([pending, text])
        current.blocks.push({ type: 'cue', who: pending, text })
      }
    } else if (type === 'Parenthetical' || type === 'Transition') {
      // not part of the spoken line / not an action block
    } else {
      current.blocks.push({ type: 'action', text }) // Action, General, …
    }
  }
  return scenes
}

// ---- Fountain (.fountain): rule-based plain-text screenplay markup ----

function isFountainCharacter(line: string): boolean {
  const base = line.replace(/\([^)]*\)/g, '').trim() // drop (V.O.) etc.
  if (!base || /[a-z]/.test(base) || !/[A-Z]/.test(base)) return false
  return base.length <= 40
}

export function parseFountain(text: string): Scene[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const scenes: Scene[] = []
  let current: Scene | null = null
  let seen = new Set<string>()
  let action: string[] = []

  const flush = () => {
    if (current && action.length) {
      const t = action.join(' ').trim()
      if (t) current.blocks.push({ type: 'action', text: t })
    }
    action = []
  }
  const blank = (i: number) => i < 0 || i >= lines.length || !lines[i].trim()
  const newScene = (heading: string) => {
    flush()
    current = { heading: squish(heading), index: scenes.length + 1, page: 0, characters: [], lines: [], blocks: [] }
    scenes.push(current)
    seen = new Set()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('.') && !line.startsWith('..')) {
      newScene(line.slice(1))
      continue
    }
    if (SCENE_RE.test(lines[i])) {
      newScene(line)
      continue
    }
    if (!current) continue // skip title-page / pre-scene content
    const cur: Scene = current
    if (line.startsWith('>') || /\bTO:$/.test(line)) continue // transition

    let charName: string | null = null
    if (line.startsWith('@')) charName = line.slice(1).trim()
    else if (blank(i - 1) && !blank(i + 1) && isFountainCharacter(line)) charName = line

    if (charName) {
      flush()
      const name = normalizeCharacter(charName)
      if (!seen.has(name)) {
        seen.add(name)
        cur.characters.push(name)
      }
      const said: string[] = []
      let j = i + 1
      while (j < lines.length && lines[j].trim()) {
        const d = lines[j].trim()
        if (!/^\(.*\)$/.test(d)) said.push(d) // skip parentheticals
        j++
      }
      const joined = said.join(' ')
      if (said.length) cur.lines.push([name, joined])
      cur.blocks.push({ type: 'cue', who: name, text: joined })
      i = j - 1
      continue
    }
    action.push(line)
  }
  flush()
  return scenes
}
