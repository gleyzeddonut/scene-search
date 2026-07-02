import { useEffect, useRef, useState } from 'react'
import { api, Scene, SceneDetail, sceneBlocks, isPdf, stem, mmss, getScriptScale, setScriptScale } from './api'
import { PdfFrame } from './PdfFrame'
import { ReaderEngine, ManualGate, SynthSpeaker, KokoroSpeaker, ElevenSpeaker, KOKORO_VOICES, readerLines, availableVoices } from './reader'
import type { ReaderState, ReaderLine, VoicedSpeaker, ElevenFail } from './reader'

const ELEVEN_FAIL_MSG: Record<ElevenFail, string> = {
  no_key: 'Add your ElevenLabs API key in Settings (⌘,) to use ElevenLabs voices.',
  quota: 'You’re out of ElevenLabs credits — Read with me stopped. It’ll work again when your quota renews (or after an upgrade).',
  auth: 'Your ElevenLabs API key was rejected — check it in Settings (⌘,).',
  network: 'Couldn’t reach ElevenLabs — check your connection and try again.'
}

const RATES: [number, string][] = [
  [0.85, 'Slower'],
  [1, 'Normal'],
  [1.15, 'Faster']
]

// Read-with-me is built (system/Kokoro/ElevenLabs speakers, priming, quota
// handling) but parked until the parser is more reliable — flip to re-enable.
const READER_ENABLED = false

// sides text sizes (multiplier on the .sides fonts, persisted via scriptScale)
const TEXT_SIZES: [number, string][] = [
  [0.9, 'S'],
  [1, 'M'],
  [1.15, 'L'],
  [1.3, 'XL']
]

export function PrepareView({
  scene,
  scenes,
  onBack
}: {
  scene: Scene
  scenes: Scene[]
  onBack: () => void
}) {
  // which scene of the script we're preparing; the switcher below changes it
  const [active, setActive] = useState<Scene>(scene)
  const [data, setData] = useState<SceneDetail | null>(null)
  const [role, setRole] = useState('')
  const [rehearse, setRehearse] = useState(false)
  const [view, setViewState] = useState(localStorage.getItem('sceneView') || 'pdf')
  const setView = (v: string) => {
    setViewState(v)
    localStorage.setItem('sceneView', v)
  }
  // jumping straight to a role/rehearse should reveal the parser view
  const toParser = () => {
    if (view === 'pdf') setView('full')
  }
  // sides text size — lives here (not Settings) since it only affects these views
  const [scale, setScale] = useState(getScriptScale())
  const pickScale = (v: number) => {
    setScriptScale(v)
    setScale(v)
  }

  // ---- Read with me: the app voices your partner's lines, waits on yours ----
  const [reading, setReading] = useState(false)
  const [rstate, setRstate] = useState<ReaderState>({ status: 'idle', index: null })
  const [rate, setRateState] = useState(() => {
    const v = parseFloat(localStorage.getItem('readerRate') || '1')
    return Number.isFinite(v) && v > 0 ? v : 1
  })
  const reader = useRef<{ eng: ReaderEngine; gate: ManualGate; speaker: VoicedSpeaker } | null>(null)
  // 'natural' = local Kokoro neural voices (downloads ~90 MB once); 'system' = macOS voices
  const [engine, setEngineState] = useState(localStorage.getItem('readerEngine') || 'natural')
  const [voice, setVoiceState] = useState(localStorage.getItem('readerVoice') || '')
  const [kVoice, setKVoiceState] = useState(localStorage.getItem('readerVoiceKokoro') || '')
  const [eVoice, setEVoiceState] = useState(localStorage.getItem('readerVoiceEleven') || '')
  const [voiceNames, setVoiceNames] = useState<string[]>([])
  const [elevenList, setElevenList] = useState<{ id: string; name: string }[]>([])
  const [voicePrep, setVoicePrep] = useState<number | null>(null) // download % while Kokoro loads
  const [notice, setNotice] = useState('') // why reading stopped (quota / bad key) — no silent fallback
  const startToken = useRef(0) // invalidates an in-flight async start when stopped

  const stopReading = () => {
    startToken.current++
    reader.current?.eng.stop()
    reader.current = null
    setReading(false)
    setVoicePrep(null)
    setRstate({ status: 'idle', index: null })
  }

  const makeSynth = (partners: string[]): SynthSpeaker => {
    const speaker = new SynthSpeaker()
    speaker.rate = rate
    speaker.fixedVoice = voice || null
    speaker.assign(partners)
    setVoiceNames(availableVoices().map((v) => v.name))
    // voices can load async on first use — assign again when they arrive
    window.speechSynthesis?.addEventListener?.(
      'voiceschanged',
      () => {
        speaker.assign(partners)
        setVoiceNames(availableVoices().map((v) => v.name))
      },
      { once: true }
    )
    return speaker
  }

  const startReading = async (blocks: ReturnType<typeof sceneBlocks>) => {
    toParser() // the reader highlights parsed lines, not the PDF
    const lines: ReaderLine[] = readerLines(blocks, role)
    if (!lines.length) return
    const partners = Array.from(new Set(lines.filter((l) => !l.mine).map((l) => l.who)))
    const tok = ++startToken.current
    setNotice('')
    setReading(true)
    let speaker: VoicedSpeaker | null = null
    if (engine === 'eleven') {
      const list = await window.scripty.elevenVoices?.().catch(() => [])
      if (tok !== startToken.current) return
      if (!list?.length) {
        // no key (or a rejected one) — stop with a clear message, never fall back
        stopReading()
        setNotice(ELEVEN_FAIL_MSG.no_key)
        return
      }
      setElevenList(list)
      const el = new ElevenSpeaker(list.map((v) => v.id))
      el.rate = rate
      el.fixedVoice = eVoice || null
      el.assign(partners)
      el.onFail = (kind) => {
        stopReading()
        setNotice(ELEVEN_FAIL_MSG[kind])
      }
      el.prime(lines)
      speaker = el
    } else if (engine === 'natural') {
      setVoicePrep(-1) // indeterminate until download progress arrives (instant when cached)
      const off = window.scripty.onKokoroProgress?.((pct) => setVoicePrep(pct))
      const st = await (window.scripty.kokoroLoad?.() ?? Promise.resolve('error')).catch(() => 'error' as const)
      off?.()
      if (tok !== startToken.current) return // stopped while the model was loading
      setVoicePrep(null)
      if (st === 'ready') {
        const k = new KokoroSpeaker()
        k.rate = rate
        k.fixedVoice = kVoice || null
        k.assign(partners)
        k.prime(lines) // render ahead so playback never waits
        speaker = k
      }
    }
    if (!speaker) speaker = makeSynth(partners) // 'system', or Kokoro failed to load
    if (tok !== startToken.current) return
    const gate = new ManualGate()
    const eng = new ReaderEngine(lines, speaker, gate, setRstate)
    reader.current = { eng, gate, speaker }
    eng.start()
  }
  const setEngine = (v: string) => {
    setEngineState(v)
    localStorage.setItem('readerEngine', v)
    if (reading) stopReading() // flip engines → start the read again
  }
  const setRate = (v: number) => {
    setRateState(v)
    localStorage.setItem('readerRate', String(v))
    if (reader.current) reader.current.speaker.rate = v // applies from the next line
  }
  const setVoice = (name: string) => {
    if (engine === 'natural') {
      setKVoiceState(name)
      localStorage.setItem('readerVoiceKokoro', name)
    } else if (engine === 'eleven') {
      setEVoiceState(name)
      localStorage.setItem('readerVoiceEleven', name)
    } else {
      setVoiceState(name)
      localStorage.setItem('readerVoice', name)
    }
    if (reader.current) reader.current.speaker.fixedVoice = name || null // from the next line
  }

  // Space delivers/advances your line, Esc stops — only while reading
  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault() // don't scroll the sides
        if (rstate.status === 'yourLine') reader.current?.gate.pass()
      } else if (e.key === 'Escape') {
        stopReading()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading, rstate.status])

  // changing scene or role invalidates the session; also stop on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stopReading, [active, role])

  // keep the line being read in view
  useEffect(() => {
    if (rstate.index == null) return
    document.querySelector('.sides .rd-on')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [rstate.index])

  // a fresh "Prepare" from Browse resets which scene is active
  useEffect(() => setActive(scene), [scene])

  // the script's scenes for the switcher (fall back to just the active one)
  const siblings = scenes.length ? scenes : [active]

  useEffect(() => {
    // keep the previous scene visible until the new one loads (no full-view flash,
    // and the scene switcher stays put); the PDF view swaps via PdfFrame's nonce
    let on = true
    api.getScene(active.script_path, active.scene_index).then((d) => {
      if (!on) return
      setData(d)
      const firstCue = sceneBlocks(d).find((b) => b.type === 'cue')
      setRole(firstCue && firstCue.type === 'cue' ? firstCue.who : '')
    })
    return () => {
      on = false
    }
  }, [active])

  if (!data) return <div style={{ padding: 40 }}>Loading scene…</div>
  const all = sceneBlocks(data)
  // keep each block's ORIGINAL index through the Dialogue-view filter, so the
  // reader's highlight lands on the right line in both views
  const visible = all
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => view !== 'dialogue' || b.type === 'cue')
  const roles = Array.from(new Set(all.flatMap((b) => (b.type === 'cue' ? [b.who] : []))))
  const name = stem(active.script_name)
  const pdfOk = isPdf(active.script_path)
  const eff = view === 'pdf' && !pdfOk ? 'full' : view

  return (
    <div className="prepareview">
      <div className="prep-head">
        <div className="prep-id">
          <div className="dheading">{data.heading}</div>
          <div className="dtitle">{name}</div>
          {siblings.length > 1 && (
            <div className="prep-row">
              <span className="prl">Scene</span>
              <div className="prl-chips">
                {siblings.map((s, i) => (
                  <button
                    key={s.scene_index}
                    className={'chip' + (s.scene_index === active.scene_index ? ' on' : '')}
                    title={s.heading}
                    onClick={() => setActive(s)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
          {roles.length > 0 && (
            <div className="prep-row">
              <span className="prl">You read</span>
              <div className="prl-chips">
                {roles.map((r) => (
                  <button
                    key={r}
                    className={'chip' + (r === role ? ' on' : '')}
                    onClick={() => {
                      setRole(r)
                      toParser()
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="prep-controls">
          <div className="prep-controls-row">
          {READER_ENABLED && (
            <button
              className={'rswitch' + (reading ? ' on' : '')}
              role="switch"
              aria-checked={reading}
              title="The app reads your partner’s lines aloud and waits for yours"
              onClick={() => (reading ? stopReading() : startReading(all))}
            >
              <span className="rknob" />
              <span className="rtxt">Read with me</span>
            </button>
          )}
          <button
            className={'rswitch' + (rehearse ? ' on' : '')}
            role="switch"
            aria-checked={rehearse}
            title="Blank out your lines to test recall"
            onClick={() => {
              setRehearse((v) => !v)
              toParser()
            }}
          >
            <span className="rknob" />
            <span className="rtxt">Rehearse</span>
          </button>
          <span className="vtoggle">
            {pdfOk && <span className={eff === 'pdf' ? 'on' : ''} onClick={() => setView('pdf')}>PDF</span>}
            <span className={eff === 'full' ? 'on' : ''} onClick={() => setView('full')}>Full scene</span>
            <span className={eff === 'dialogue' ? 'on' : ''} onClick={() => setView('dialogue')}>Dialogue</span>
          </span>
          </div>
          {/* on its own row below, so appearing/disappearing never shifts the toggles */}
          {eff !== 'pdf' && (
            <span className="vtoggle textsize" title="Text size">
              {TEXT_SIZES.map(([v, label]) => (
                <span key={v} className={Math.abs(scale - v) < 0.01 ? 'on' : ''} onClick={() => pickScale(v)}>
                  {label}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      {reading && (
        <div className="reader-bar">
          <span className={'rdot' + (rstate.status === 'speaking' ? ' live' : rstate.status === 'yourLine' ? ' you' : '')} />
          <span className="reader-status">
            {voicePrep != null
              ? voicePrep >= 0
                ? `Downloading natural voices — ${voicePrep}% (one time, ~90 MB)`
                : 'Preparing natural voices…'
              : rstate.status === 'speaking'
                ? `Reading — ${(all[rstate.index] as { who?: string })?.who ?? ''}`
                : rstate.status === 'yourLine'
                  ? `Your line, ${role} — press Space when you’ve said it`
                  : rstate.status === 'done'
                    ? 'Scene finished'
                    : ''}
          </span>
          <select className="reader-voice" value={engine} onChange={(e) => setEngine(e.target.value)} title="Voice engine">
            <option value="eleven">ElevenLabs</option>
            <option value="natural">Natural voices</option>
            <option value="system">System voices</option>
          </select>
          <select
            className="reader-voice"
            value={engine === 'natural' ? kVoice : engine === 'eleven' ? eVoice : voice}
            onChange={(e) => setVoice(e.target.value)}
            title="Partner voice"
          >
            <option value="">Auto (per character)</option>
            {engine === 'natural'
              ? KOKORO_VOICES.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))
              : engine === 'eleven'
                ? elevenList.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))
                : voiceNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
          </select>
          <span className="seg reader-rate">
            {RATES.map(([v, label]) => (
              <span key={v} className={Math.abs(rate - v) < 0.01 ? 'on' : ''} onClick={() => setRate(v)}>
                {label}
              </span>
            ))}
          </span>
          {rstate.status === 'done' ? (
            <button className="btn-accent" onClick={() => reader.current?.eng.start()}>Read again</button>
          ) : null}
          <button className="ghost" onClick={stopReading}>Stop</button>
        </div>
      )}

      {notice && (
        <div className="reader-bar notice">
          <span className="rdot err" />
          <span className="reader-status">{notice}</span>
          <button className="ghost" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      <div className="sides-scroll">
        {eff === 'pdf' ? (
          <PdfFrame path={active.script_path} page={active.page} top={active.top} nonce={active.scene_index} />
        ) : (
          <div className="sides" id="sides">
            <div className="sides-h">{data.heading}</div>
            {visible.map(({ b, i }) => {
              if (b.type === 'action') return <div key={i} className="saction">{b.text}</div>
              const mine = b.who === role
              const rd = reading && rstate.index === i ? ' rd-on' : ''
              return (
                <div key={i}>
                  <div className={'cue' + (mine ? ' mine' : '') + rd}>{b.who}</div>
                  <div className={'sline' + (mine ? ' mine' : '') + rd}>
                    {mine && rehearse ? '— — — — — —' : b.text}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="prep-foot">
        <button className="ghost" onClick={onBack}>← Back to results</button>
        <span className="muted">Est. {mmss(data.est_seconds)} at performance pace</span>
        {eff === 'pdf' ? (
          <button className="btn-accent" onClick={() => api.openFile(active.script_path)}>Open file</button>
        ) : (
          <button className="btn-accent" onClick={() => api.exportSides('sides', name)}>Export sides PDF</button>
        )}
      </div>
    </div>
  )
}
