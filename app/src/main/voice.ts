import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'

// Local neural TTS (Kokoro-82M via onnxruntime) for the Read-with-me reader.
// The ~90 MB quantized model downloads once into userData and is cached there;
// generation runs in-process (~2-3× realtime on Apple silicon), and the renderer
// receives WAV bytes to play. No network after the first download.
//
// PARKED: while Read-with-me is disabled, kokoro-js lives in devDependencies so
// its ~120 MB of ML runtime stays OUT of the packaged app — the dynamic imports
// below then fail fast (status 'error'), which nothing reaches with the UI off.
// To re-enable: move kokoro-js to dependencies and restore the electron-builder
// asarUnpack for onnxruntime-node (see electron-builder.yml).

type KokoroStatus = 'none' | 'cached' | 'loading' | 'ready' | 'error'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
let status: KokoroStatus = 'none'
let tts: { generate: (text: string, opts: { voice: string; speed: number }) => Promise<{ toWav: () => ArrayBuffer }> } | null = null
let loading: Promise<void> | null = null

const cacheDir = () => join(app.getPath('userData'), 'scripty', 'kokoro')
const cacheExists = () => {
  try {
    return existsSync(cacheDir()) && readdirSync(cacheDir()).length > 0
  } catch {
    return false
  }
}

async function load(getWin: () => BrowserWindow | null): Promise<void> {
  if (tts) return
  if (loading) return loading
  status = 'loading'
  loading = (async () => {
    try {
      const { env } = await import('@huggingface/transformers')
      env.cacheDir = cacheDir()
      const { KokoroTTS } = await import('kokoro-js')
      let last = -1
      tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
          // progress of the big .onnx download → renderer progress bar
          if (p.status === 'progress' && p.file?.endsWith('.onnx') && p.total) {
            const pct = Math.round(((p.loaded || 0) / p.total) * 100)
            if (pct !== last) {
              last = pct
              getWin()?.webContents.send('kokoro-progress', pct)
            }
          }
        }
      })) as unknown as typeof tts
      status = 'ready'
    } catch (e) {
      status = 'error'
      tts = null
      console.error('Kokoro failed to load:', e)
    } finally {
      loading = null
    }
  })()
  return loading
}

export function registerVoice(getWin: () => BrowserWindow | null): void {
  status = cacheExists() ? 'cached' : 'none' // 'cached' = downloaded, not yet in memory
  ipcMain.handle('kokoro-status', () => status)
  ipcMain.handle('kokoro-load', async () => {
    await load(getWin)
    return status
  })
  ipcMain.handle('kokoro-say', async (_e, text: string, voice: string, speed: number) => {
    if (!tts) throw new Error('kokoro not loaded')
    const audio = await tts.generate(text, { voice, speed: Math.min(2, Math.max(0.5, speed || 1)) })
    return Buffer.from(audio.toWav()) // → Uint8Array in the renderer
  })
}
