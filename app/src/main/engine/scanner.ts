import { readdir } from 'node:fs/promises'
import { join, extname, basename, resolve } from 'node:path'
import { homedir } from 'node:os'

export const SCRIPT_EXTENSIONS = new Set(['.pdf', '.fountain', '.fdx', '.txt', '.docx'])
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git', 'Caches', 'Library'])

export function defaultRoots(): string[] {
  const h = homedir()
  return [
    join(h, 'Downloads'),
    join(h, 'Desktop'),
    join(h, 'Documents'),
    join(h, 'Library/Mobile Documents/com~apple~CloudDocs/Documents')
  ]
}

interface Opts {
  ignoreDirs?: string[]
  shouldCancel?: () => boolean
  onError?: (path: string, err: unknown) => void
}

export async function* iterCandidates(roots: string[], opts: Opts = {}): AsyncGenerator<string> {
  const ignored = new Set((opts.ignoreDirs || []).map((p) => resolve(p)))
  const seen = new Set<string>()
  for (const root of roots) {
    if (ignored.has(resolve(root))) continue
    yield* walk(root, ignored, seen, opts)
  }
}

async function* walk(
  dir: string,
  ignored: Set<string>,
  seen: Set<string>,
  opts: Opts
): AsyncGenerator<string> {
  if (opts.shouldCancel?.()) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    opts.onError?.(dir, e)
    return
  }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (
        ent.name.startsWith('.') ||
        SKIP_DIRS.has(ent.name) ||
        ent.name.endsWith('.app') ||
        ignored.has(resolve(full))
      )
        continue
      yield* walk(full, ignored, seen, opts)
    } else if (ent.isFile()) {
      if (ent.name.startsWith('.')) continue
      if (!SCRIPT_EXTENSIONS.has(extname(ent.name).toLowerCase())) continue
      const rp = resolve(full)
      if (seen.has(rp)) continue
      seen.add(rp)
      yield full
    }
    if (opts.shouldCancel?.()) return
  }
}

export { basename }
