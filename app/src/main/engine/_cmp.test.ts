// Throwaway: compare layout vs regex scene lists for one file.
import { it } from 'vitest'
import { extractLayout, layoutToText } from './extract'
import { parseLayout, parseScenes } from './parser'

it.skipIf(!process.env.CMP_FILE)('compare parses', async () => {
  const { lines } = await extractLayout(process.env.CMP_FILE!)
  const txt = layoutToText(lines)
  const dropEmpty = (ss: any[]) => ss.filter((s) => s.blocks.length > 0)
  const layout = dropEmpty(parseLayout(lines))
  const regex = dropEmpty(parseScenes(txt))
  const show = (name: string, ss: any[]) => {
    console.log(`--- ${name}: ${ss.length} scenes, ${ss.reduce((n, s) => n + s.lines.length, 0)} dlg`)
    for (const s of ss) console.log(`  [${s.lines.length} dlg, p${s.page}] ${s.heading.slice(0, 60)}`)
  }
  show('layout', layout)
  show('regex', regex)
  const l1 = layout[0]?.lines.find((l: [string, string]) => l[1].includes('in this room'))
  console.log('layout JANEY line:', JSON.stringify(l1))
}, 120000)
