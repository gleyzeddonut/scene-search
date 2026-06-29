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
