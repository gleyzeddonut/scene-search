import type { SceneBlock, ElevenResult } from './api'

// ---- Read-with-me: the app reads your partner's lines, you deliver yours ----
//
// The engine is a plain async walk over the scene's dialogue with two injected
// seams, so the interaction model can grow without rewriting it:
//  • Speaker — how partner lines are voiced. Tier 1: speechSynthesis (below).
//  • LineGate — how YOUR lines complete. Tier 1: ManualGate (press Space).
//    Tier 2 swaps in a speech-recognition gate that resolves when you've said
//    the line's closing words; the engine doesn't change.

export interface ReaderLine {
  index: number // position in the scene's block list (drives the highlight)
  who: string
  text: string
  mine: boolean
}

export interface Speaker {
  speak(line: ReaderLine): Promise<void>
  cancel(): void
}

// what the reader UI needs from any concrete speaker (system or neural)
export interface VoicedSpeaker extends Speaker {
  rate: number
  fixedVoice: string | null
  assign(names: string[]): void
}

export interface LineGate {
  wait(line: ReaderLine): Promise<void>
  cancel(): void
}

export type ReaderState =
  | { status: 'idle' | 'done'; index: null }
  | { status: 'speaking' | 'yourLine'; index: number }

// the scene's dialogue as reader lines (action blocks are not read in Tier 1)
export function readerLines(blocks: SceneBlock[], role: string): ReaderLine[] {
  const out: ReaderLine[] = []
  blocks.forEach((b, index) => {
    if (b.type === 'cue' && b.text.trim()) out.push({ index, who: b.who, text: b.text, mine: b.who === role })
  })
  return out
}

// Tier 1 gate: your line completes when you advance by hand (Space / click).
// stop() cancels it by resolving — the engine's run-id check makes the stale
// resume a no-op, so a late pass() after stop can't advance anything.
export class ManualGate implements LineGate {
  private release: (() => void) | null = null
  wait(): Promise<void> {
    return new Promise((r) => (this.release = r))
  }
  pass(): void {
    this.release?.()
    this.release = null
  }
  cancel(): void {
    this.pass()
  }
}

export class ReaderEngine {
  private runId = 0
  constructor(
    private lines: ReaderLine[],
    private speaker: Speaker,
    private gate: LineGate,
    private onState: (s: ReaderState) => void
  ) {}

  start(from = 0): void {
    this.interrupt()
    void this.run(++this.runId, from)
  }

  stop(): void {
    this.runId++
    this.interrupt()
    this.onState({ status: 'idle', index: null })
  }

  private interrupt(): void {
    this.speaker.cancel()
    this.gate.cancel()
  }

  private async run(id: number, from: number): Promise<void> {
    for (let i = from; i < this.lines.length; i++) {
      const l = this.lines[i]
      this.onState({ status: l.mine ? 'yourLine' : 'speaking', index: l.index })
      await (l.mine ? this.gate.wait(l) : this.speaker.speak(l))
      if (id !== this.runId) return // stopped or restarted while this line ran
    }
    if (id === this.runId) this.onState({ status: 'done', index: null })
  }
}

// ---- Tier 1 Speaker: the system voices via speechSynthesis ----

// macOS ships dozens of novelty voices (Albert, Zarvox, Bubbles…) that read like a
// prank — never use them. Rank what's installed: downloaded Premium/Enhanced voices
// first (System Settings → Accessibility → Spoken Content → Manage Voices), then the
// stock conversational voices, then any other English voice that isn't a novelty.
const NOVELTY_RE =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|princess|junior|ralph|kathy|fred|grandma|grandpa|rocko|shelley|sandy|eddy|flo|reed/i
const QUALITY_RE = /premium|enhanced|siri/i
const STOCK_GOOD_RE =
  /^(samantha|alex|ava|allison|evan|joelle|nathan|noelle|susan|tom|zoe|daniel|kate|oliver|serena|karen|lee|matilda|moira|tessa|rishi|veena|fiona)\b/i

export function rankVoices(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const en = all.filter((v) => v.lang.toLowerCase().startsWith('en') && !NOVELTY_RE.test(v.name))
  const tier = (v: SpeechSynthesisVoice) => (QUALITY_RE.test(v.name) ? 0 : STOCK_GOOD_RE.test(v.name) ? 1 : 2)
  const best = Math.min(2, ...en.map(tier))
  return en.filter((v) => tier(v) <= Math.max(best, 1)).sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name))
}

// the ranked voice list for pickers (may be empty until voiceschanged fires)
export function availableVoices(): SpeechSynthesisVoice[] {
  return rankVoices(window.speechSynthesis?.getVoices() ?? [])
}

// Each partner character gets a distinct voice, assigned deterministically from the
// ranked pool so a scene always sounds the same on this machine — unless the user
// picked one fixed voice for all partners.
export class SynthSpeaker implements VoicedSpeaker {
  rate = 1
  fixedVoice: string | null = null // a voice name, or null for per-character Auto
  private byWho = new Map<string, SpeechSynthesisVoice>()

  // distinct voices for the partner characters, stable across sessions (voices may
  // load async — call again on voiceschanged; assignments only fill in, never move)
  assign(names: string[]): void {
    const pool = availableVoices()
    if (!pool.length) return
    names.forEach((who, i) => {
      if (!this.byWho.has(who)) this.byWho.set(who, pool[i % pool.length])
    })
  }

  private voiceFor(who: string): SpeechSynthesisVoice | undefined {
    if (this.fixedVoice) {
      const v = (window.speechSynthesis?.getVoices() ?? []).find((x) => x.name === this.fixedVoice)
      if (v) return v
    }
    return this.byWho.get(who)
  }

  speak(line: ReaderLine): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(line.text)
      const voice = this.voiceFor(line.who)
      if (voice) u.voice = voice
      u.rate = this.rate
      u.onend = () => resolve()
      u.onerror = () => resolve() // includes cancel — the engine decides what's next
      window.speechSynthesis.speak(u)
    })
  }

  cancel(): void {
    window.speechSynthesis?.cancel()
  }
}

// ---- Neural Speaker: local Kokoro TTS, generated in the main process ----

// a curated, ordered subset of Kokoro's voices (best conversational ones first)
export const KOKORO_VOICES: [string, string][] = [
  ['af_heart', 'Heart — US woman'],
  ['am_michael', 'Michael — US man'],
  ['af_bella', 'Bella — US woman'],
  ['am_fenrir', 'Fenrir — US man'],
  ['af_nicole', 'Nicole — US woman, soft'],
  ['am_puck', 'Puck — US man'],
  ['af_sky', 'Sky — US woman'],
  ['am_adam', 'Adam — US man'],
  ['bf_emma', 'Emma — UK woman'],
  ['bm_george', 'George — UK man'],
  ['bf_isabella', 'Isabella — UK woman'],
  ['bm_fable', 'Fable — UK man']
]

// Speaks through the local Kokoro model (kokoro-say IPC → WAV bytes → <audio>).
// Generation runs ~2-3× realtime, so prime() renders the scene's partner lines in
// the background ahead of playback — by the time a line is reached it's usually
// already cached and starts instantly.
export class KokoroSpeaker implements VoicedSpeaker {
  rate = 1
  fixedVoice: string | null = null
  private byWho = new Map<string, string>()
  private cache = new Map<string, Promise<Uint8Array>>()
  private playing: HTMLAudioElement | null = null
  private release: (() => void) | null = null
  private cancelled = false
  private primeStop = false

  assign(names: string[]): void {
    names.forEach((who, i) => {
      if (!this.byWho.has(who)) this.byWho.set(who, KOKORO_VOICES[i % KOKORO_VOICES.length][0])
    })
  }

  private voiceFor(who: string): string {
    return this.fixedVoice || this.byWho.get(who) || KOKORO_VOICES[0][0]
  }

  private fetch(line: ReaderLine): Promise<Uint8Array> {
    const voice = this.voiceFor(line.who)
    const key = `${voice}|${this.rate}|${line.text}`
    let p = this.cache.get(key)
    if (!p) {
      p = window.scripty.kokoroSay(line.text, voice, this.rate)
      this.cache.set(key, p)
      p.catch(() => this.cache.delete(key)) // a failed render can be retried
    }
    return p
  }

  // render the whole scene's partner lines in the background, in order
  prime(lines: ReaderLine[]): void {
    this.primeStop = false
    void (async () => {
      for (const l of lines) {
        if (this.primeStop) return
        if (!l.mine) await this.fetch(l).catch(() => {})
      }
    })()
  }

  async speak(line: ReaderLine): Promise<void> {
    this.cancelled = false
    let bytes: Uint8Array
    try {
      bytes = await this.fetch(line)
    } catch {
      return // generation failed — skip the line rather than hang the scene
    }
    if (this.cancelled) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }))
    try {
      await new Promise<void>((resolve) => {
        this.release = resolve
        const a = new Audio(url)
        this.playing = a
        a.onended = () => resolve()
        a.onerror = () => resolve()
        a.play().catch(() => resolve())
      })
    } finally {
      this.playing = null
      this.release = null
      URL.revokeObjectURL(url)
    }
  }

  cancel(): void {
    this.cancelled = true
    this.primeStop = true
    this.playing?.pause()
    this.release?.() // settle the pending speak() so the engine's loop can exit
  }
}

// ---- Premium Speaker: ElevenLabs (user's own API key) ----
//
// Deliberately NO fallback: a quota/auth failure calls onFail exactly once so the
// UI can stop the session and tell the user why, instead of silently switching
// voices mid-scene. Rate is applied at playback (audio.playbackRate), so changing
// speed never spends credits; audio is disk-cached in the main process, so only
// NEW lines (or a voice change) generate.
export type ElevenFail = 'no_key' | 'quota' | 'auth' | 'network'

export class ElevenSpeaker implements VoicedSpeaker {
  rate = 1
  fixedVoice: string | null = null
  onFail: ((kind: ElevenFail) => void) | null = null
  private byWho = new Map<string, string>()
  private cache = new Map<string, Promise<ElevenResult>>()
  private playing: HTMLAudioElement | null = null
  private release: (() => void) | null = null
  private cancelled = false
  private primeStop = false
  private failed = false

  constructor(private voiceIds: string[]) {}

  assign(names: string[]): void {
    if (!this.voiceIds.length) return
    names.forEach((who, i) => {
      if (!this.byWho.has(who)) this.byWho.set(who, this.voiceIds[i % this.voiceIds.length])
    })
  }

  private voiceFor(who: string): string {
    return this.fixedVoice || this.byWho.get(who) || this.voiceIds[0] || ''
  }

  private fail(kind: ElevenFail): void {
    if (this.failed) return // report once — the first failure stops the session
    this.failed = true
    this.primeStop = true
    this.onFail?.(kind)
  }

  private fetch(line: ReaderLine): Promise<ElevenResult> {
    const voice = this.voiceFor(line.who)
    const key = `${voice}|${line.text}` // no rate — speed is a playback effect
    let p = this.cache.get(key)
    if (!p) {
      p = window.scripty.elevenSay(line.text, voice)
      this.cache.set(key, p)
      p.then((r) => {
        if (!r.ok) this.cache.delete(key) // failures can be retried next session
      }).catch(() => this.cache.delete(key))
    }
    return p
  }

  prime(lines: ReaderLine[]): void {
    this.primeStop = false
    void (async () => {
      for (const l of lines) {
        if (this.primeStop || this.failed) return
        if (l.mine) continue
        const r = await this.fetch(l).catch((): ElevenResult => ({ ok: false, error: 'network' }))
        if (!r.ok && (r.error === 'quota' || r.error === 'auth' || r.error === 'no_key')) this.fail(r.error)
      }
    })()
  }

  async speak(line: ReaderLine): Promise<void> {
    this.cancelled = false
    let r: ElevenResult
    try {
      r = await this.fetch(line)
    } catch {
      r = { ok: false, error: 'network' }
    }
    if (!r.ok) {
      this.fail(r.error)
      return
    }
    if (this.cancelled || this.failed) return
    const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'audio/mpeg' }))
    try {
      await new Promise<void>((resolve) => {
        this.release = resolve
        const a = new Audio(url)
        a.playbackRate = this.rate
        this.playing = a
        a.onended = () => resolve()
        a.onerror = () => resolve()
        a.play().catch(() => resolve())
      })
    } finally {
      this.playing = null
      this.release = null
      URL.revokeObjectURL(url)
    }
  }

  cancel(): void {
    this.cancelled = true
    this.primeStop = true
    this.playing?.pause()
    this.release?.()
  }
}
