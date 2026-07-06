import { app, ipcMain } from 'electron'
import { platform, arch, release } from 'os'

// ---- In-app feedback → hosted form endpoint ----
//
// SETUP (one time): create a free form at https://formspree.io, then paste its
// endpoint URL below (it looks like https://formspree.io/f/abcdwxyz). Each
// submission emails you AND lands in the Formspree dashboard. Until this is set,
// the Settings feedback form tells the user it's unavailable.
export const FEEDBACK_ENDPOINT = 'https://formspree.io/f/xnjkwkyv'

// A small ring buffer of recent runtime errors (main + renderer-reported), attached
// to every feedback submission so crashes and failures reach the developer without
// the user having to copy anything.
export const RECENT_MAX = 25
const recent: string[] = []
export function noteError(where: string, err: unknown): void {
  const raw = err instanceof Error ? err.stack || err.message : String(err)
  recent.push(`[${where}] ${raw.split('\n').slice(0, 4).join(' | ')}`)
  while (recent.length > RECENT_MAX) recent.shift()
}
export function recentErrors(): string[] {
  return recent
}

export interface FeedbackInput {
  message: string
  email?: string
  kind?: string // 'feedback' | 'bug' | 'idea'
}

// Assemble the JSON body posted to the form endpoint. Pure (env injected), so the
// diagnostics attachment is unit-tested without electron/os.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function buildFeedbackBody(
  input: FeedbackInput,
  env: { version: string; platform: string; arch: string; release: string; errors: string[] }
): Record<string, unknown> {
  const email = (input.email || '').trim()
  const body: Record<string, unknown> = {
    message: input.message.trim(),
    // NON-special key: Formspree validates its own `email`/`_replyto` fields and
    // 422s anything that isn't an address, so the (optional) user email rides here
    userEmail: email || 'not provided',
    kind: input.kind || 'feedback',
    app: `Scripty ${env.version}`,
    system: `${env.platform} ${env.release} (${env.arch})`,
    recentErrors: env.errors.slice(-15), // the 15 most recent, oldest first
    _subject: `Scripty ${input.kind || 'feedback'} — v${env.version}`
  }
  // set Formspree's reply-to ONLY for a real address, so replies reach the user
  if (EMAIL_RE.test(email)) body._replyto = email
  return body
}

export type FeedbackResult = { ok: true } | { ok: false; error: string }

// getErrors supplies app-level errors (e.g. the engine's failed-parse list) which
// are merged with the runtime ring buffer for the diagnostics attachment.
export function registerFeedback(getErrors: () => string[]): void {
  // observe unhandled promise rejections (safe — does not alter crash behavior)
  process.on('unhandledRejection', (e) => noteError('unhandledRejection', e))
  ipcMain.on('note-error', (_e, where: string, msg: string) => noteError(where || 'renderer', msg))

  ipcMain.handle('feedback-send', async (_e, input: FeedbackInput): Promise<FeedbackResult> => {
    if (!FEEDBACK_ENDPOINT) return { ok: false, error: 'not_configured' }
    if (!input?.message?.trim()) return { ok: false, error: 'empty' }
    const body = buildFeedbackBody(input, {
      version: app.getVersion(),
      platform: platform(),
      arch: arch(),
      release: release(),
      errors: [...recent, ...safe(getErrors)]
    })
    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
      })
      return res.ok ? { ok: true } : { ok: false, error: 'http_' + res.status }
    } catch {
      return { ok: false, error: 'network' }
    }
  })
}

function safe(fn: () => string[]): string[] {
  try {
    return fn() || []
  } catch {
    return []
  }
}
