import { useEffect, useState } from 'react'
import { api, Scene, SceneDetail, sceneBlocks, isPdf, stem } from './api'
import { PdfFrame } from './PdfFrame'

function mmss(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}


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
  const blocks = view === 'dialogue' ? all.filter((b) => b.type === 'cue') : all
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
      </div>

      <div className="sides-scroll">
        {eff === 'pdf' ? (
          <PdfFrame path={active.script_path} page={active.page} nonce={active.scene_index} />
        ) : (
          <div className="sides" id="sides">
            <div className="sides-h">{data.heading}</div>
            {blocks.map((b, i) => {
              if (b.type === 'action') return <div key={i} className="saction">{b.text}</div>
              const mine = b.who === role
              return (
                <div key={i}>
                  <div className={'cue' + (mine ? ' mine' : '')}>{b.who}</div>
                  <div className={'sline' + (mine ? ' mine' : '')}>
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
