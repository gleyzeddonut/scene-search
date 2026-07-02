// Throwaway: which headings does one engine find that the other misses?
import { it } from 'vitest'
import { extractLayout, layoutToText } from './extract'
import { parseLayout, parseScenes } from './parser'

it.skipIf(!process.env.CMP_FILE)('heading diff', async () => {
  const { lines } = await extractLayout(process.env.CMP_FILE!)
  const layout = parseLayout(lines).filter((s) => s.blocks.length)
  const regex = parseScenes(layoutToText(lines)).filter((s) => s.blocks.length)
  const count = (ss: { heading: string }[]) => {
    const m = new Map<string, number>()
    for (const s of ss) m.set(s.heading, (m.get(s.heading) || 0) + 1)
    return m
  }
  const L = count(layout), R = count(regex)
  for (const [h, n] of R) if ((L.get(h) || 0) < n) console.log('REGEX-ONLY', `[${n - (L.get(h) || 0)}x]`, h)
  for (const [h, n] of L) if ((R.get(h) || 0) < n) console.log('LAYOUT-ONLY', `[${n - (R.get(h) || 0)}x]`, h)
}, 120000)
