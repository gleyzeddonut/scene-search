import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// A NUL byte once slipped into engine.ts (a corrupted string sentinel). It compiled
// and passed every test — but git treated the file as binary (no diffs) and any tool
// that strips NULs would have silently changed behavior. This guard fails loudly if
// a raw NUL (0x00) ever reappears in a source file.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..') // src/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx|css|json|cjs)$/.test(name)) out.push(p)
  }
  return out
}

describe('source hygiene', () => {
  it('no source file contains a raw NUL byte', () => {
    const offenders = walk(SRC).filter((f) => readFileSync(f).includes(0))
    expect(offenders).toEqual([])
  })
})
