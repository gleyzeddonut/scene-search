import { app, ipcMain } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'

// ElevenLabs TTS for the Read-with-me reader. Credit-saving by design:
//  • only the ACTIVE SCENE's partner lines are ever generated (the renderer primes
//    per scene, on demand) — never the whole script
//  • generated audio is cached on DISK per voice+line, so re-rehearsing a scene
//    costs zero credits; only new scenes or a voice change spend
//  • the Turbo model halves the per-character credit cost
//  • playback speed is applied client-side — no regeneration on rate change
// There is deliberately NO fallback: quota/auth failures surface to the UI so the
// user knows exactly why reading stopped.

const MODEL = 'eleven_turbo_v2_5'
const OUTPUT = 'mp3_44100_128'

export type ElevenResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: 'no_key' | 'quota' | 'auth' | 'network' }

const cacheDir = () => join(app.getPath('userData'), 'scripty', 'tts-cache')
const cachePath = (voice: string, text: string) =>
  join(cacheDir(), createHash('sha256').update(`11|${MODEL}|${voice}|${text}`).digest('hex') + '.mp3')

async function say(key: string, text: string, voice: string): Promise<ElevenResult> {
  if (!key) return { ok: false, error: 'no_key' }
  const file = cachePath(voice, text)
  if (existsSync(file)) {
    try {
      return { ok: true, bytes: new Uint8Array(await readFile(file)) } // free — cached
    } catch {
      /* fall through to regeneration */
    }
  }
  let res: Response
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${OUTPUT}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: MODEL })
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  if (!res.ok) {
    // ElevenLabs reports exhausted credits via detail.status ("quota_exceeded")
    let detail = ''
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      /* no body */
    }
    if (/quota_exceeded|character_limit/i.test(detail)) return { ok: false, error: 'quota' }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'auth' }
    return { ok: false, error: 'network' }
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  try {
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(file, bytes)
  } catch {
    /* cache write is best-effort */
  }
  return { ok: true, bytes }
}

// the account's voices (premade + any the user added), for the reader's picker
async function voices(key: string): Promise<{ id: string; name: string }[]> {
  if (!key) return []
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } })
    if (!res.ok) return []
    const data = (await res.json()) as { voices?: { voice_id: string; name: string }[] }
    return (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }))
  } catch {
    return []
  }
}

export function registerEleven(getKey: () => string): void {
  ipcMain.handle('eleven-say', (_e, text: string, voice: string) => say(getKey(), text, voice))
  ipcMain.handle('eleven-voices', () => voices(getKey()))
}
