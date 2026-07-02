// Throwaway: dump layout lines (x, y, text) for one file for offline debugging.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { extractLayout } from './extract'

it.skipIf(!process.env.DUMP_FILE)('dump layout', async () => {
  const { lines, pageCount } = await extractLayout(process.env.DUMP_FILE!)
  const out = lines.map((l) => `p${l.page} x=${Math.round(l.x)} y=${Math.round(l.y)} | ${l.text}`).join('\n')
  writeFileSync(process.env.DUMP_OUT || '/tmp/dump.txt', `pages=${pageCount}\n` + out)
  console.log('dumped', lines.length, 'lines')
}, 120000)
