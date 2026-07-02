import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PARSER_VERSION } from './parser'

// Guard for the parser-upgrade contract: the persisted index records the
// PARSER_VERSION it was built with, and the engine re-parses everything when that
// version changes (see PARSER_VERSION in parser.ts). So a change to how scripts
// parse is only delivered to existing users if PARSER_VERSION is bumped.
//
// This snapshot fails whenever any parser source changes, forcing a conscious step:
//   • if the change alters how scripts PARSE → bump PARSER_VERSION in parser.ts
//   • either way → update EXPECTED below to the hash the failure prints
const here = dirname(fileURLToPath(import.meta.url))
const SOURCES = ['parser.ts', 'extract.ts', 'formats.ts']
const EXPECTED = {
  version: 8,
  hash: 'c80c2645cd8a349386a3644b506da1a704b8b818278d15ce9143c7e93c8e94d0'
}

describe('parser version guard', () => {
  it('PARSER_VERSION is reconsidered whenever the parser sources change', () => {
    const h = createHash('sha256')
    for (const f of SOURCES) h.update(readFileSync(join(here, f)))
    const hash = h.digest('hex')

    if (hash !== EXPECTED.hash) {
      throw new Error(
        `Parser sources changed (${SOURCES.join(', ')}).\n` +
          `→ If this changes how scripts PARSE, bump PARSER_VERSION in parser.ts so every\n` +
          `  existing index re-parses on the next launch.\n` +
          `→ Then set EXPECTED in this test to:\n` +
          `    version: ${PARSER_VERSION}, hash: '${hash}'`
      )
    }
    // sources are exactly what the recorded version was last decided against
    expect(PARSER_VERSION).toBe(EXPECTED.version)
  })
})
