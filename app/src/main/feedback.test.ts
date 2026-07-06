import { describe, it, expect, vi, beforeEach } from 'vitest'

// feedback.ts imports electron at module load; stub it so the pure helpers import
vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9' }, ipcMain: { handle: () => {} } }))

import { buildFeedbackBody, noteError, recentErrors, RECENT_MAX } from './feedback'

const ENV = { version: '1.2.3', platform: 'darwin', arch: 'arm64', release: '24.5.0', errors: [] as string[] }

describe('buildFeedbackBody', () => {
  it('trims the message, stamps app + system, and defaults a missing email', () => {
    const body = buildFeedbackBody({ message: '  it crashes  ', kind: 'bug' }, ENV)
    expect(body.message).toBe('it crashes')
    // the user email lives under a NON-special key so Formspree never validates it
    expect(body.userEmail).toBe('not provided')
    expect(body._replyto).toBeUndefined() // no reply-to when no real address given
    expect(body.kind).toBe('bug')
    expect(body.app).toBe('Scripty 1.2.3')
    expect(body.system).toBe('darwin 24.5.0 (arm64)')
    expect(body._subject).toContain('1.2.3')
  })
  it('sets the reply-to only for a valid email, and caps the attached error list', () => {
    const errors = Array.from({ length: 40 }, (_, i) => 'e' + i)
    const body = buildFeedbackBody({ message: 'hi', email: '  a@b.com ' }, { ...ENV, errors })
    expect(body.userEmail).toBe('a@b.com')
    expect(body._replyto).toBe('a@b.com') // valid → Formspree can reply to them
    expect((body.recentErrors as string[]).length).toBe(15) // most recent only
    expect((body.recentErrors as string[])[14]).toBe('e39')
  })
  it('does not set a reply-to for a non-address string (would 422 Formspree)', () => {
    const body = buildFeedbackBody({ message: 'hi', email: 'just my name' }, ENV)
    expect(body.userEmail).toBe('just my name')
    expect(body._replyto).toBeUndefined()
  })
})

describe('noteError ring buffer', () => {
  beforeEach(() => recentErrors().length && recentErrors().splice(0)) // no-op; buffer is module-private
  it('records the newest errors and never grows past the cap', () => {
    for (let i = 0; i < RECENT_MAX + 10; i++) noteError('test', new Error('boom ' + i))
    const buf = recentErrors()
    expect(buf.length).toBe(RECENT_MAX)
    expect(buf[buf.length - 1]).toContain('boom ' + (RECENT_MAX + 9))
    expect(buf[0]).toContain('boom 10') // the first 10 fell off
    expect(buf[buf.length - 1]).toMatch(/^\[test\]/)
  })
})
