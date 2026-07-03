// Throwaway: full Library reindex of the real folder → list of indexed scripts.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { Library } from './library'

it('full pipeline index list', async () => {
  const lib = new Library()
  await lib.reindex(['/Users/dangleyzer/Downloads/Scripts'], { force: true })
  const rows = (lib.toJSON().scripts as { name: string; sceneCount: number }[])
    .filter((s) => s.sceneCount > 0)
    .map((s) => s.name)
    .sort()
  writeFileSync(process.env.LIST_OUT!, rows.join('\n'))
  console.log('indexed scripts:', rows.length)
}, 900000)
