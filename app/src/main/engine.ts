import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { createServer } from 'net'
import { join } from 'path'
import { app } from 'electron'

export interface EngineHandle {
  port: number
  token: string
  proc: ChildProcess
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function waitForHealth(port: number, token: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { 'X-Scripty-Token': token }
      })
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 100))
  }
  throw new Error('engine did not start')
}

export async function startEngine(): Promise<EngineHandle> {
  const port = await freePort()
  const token = randomBytes(16).toString('hex')
  // dev: run the repo venv python; prod (Phase 2) will use the bundled binary
  const repoRoot = join(app.getAppPath(), '..')
  const python = join(repoRoot, '.venv', 'bin', 'python')
  const proc = spawn(
    python,
    ['-m', 'scenesearch.service', '--port', String(port), '--token', token],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  proc.stderr?.on('data', (d) => console.error('[engine]', d.toString()))
  await waitForHealth(port, token)
  return { port, token, proc }
}
