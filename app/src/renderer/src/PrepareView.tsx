import { useEffect, useState } from 'react'
import { api, Scene, SceneDetail, sceneBlocks, isPdf } from './api'
import { PdfFrame } from './PdfFrame'

function mmss(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function PrepareView({ scene, onBack }: { scene: Scene; onBack: () => void }) {
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

  useEffect(() => {
    api.getScene(scene.script_path, scene.scene_index).then((d) => {
      setData(d)
      const firstCue = sceneBlocks(d).find((b) => b.type === 'cue')
      setRole(firstCue && firstCue.type === 'cue' ? firstCue.who : '')
    })
  }, [scene])

  if (!data) return <div style={{ padding: 40 }}>Loading scene…</div>
  const all = sceneBlocks(data)
  const blocks = view === 'dialogue' ? all.filter((b) => b.type === 'cue') : all
  const roles = Array.from(new Set(all.flatMap((b) => (b.type === 'cue' ? [b.who] : []))))
  const name = scene.script_name.replace(/\.[^.]+$/, '')
  const pdfOk = isPdf(scene.script_path)
  const eff = view === 'pdf' && !pdfOk ? 'full' : view

  return (
    <div className="prepareview">
      <div className="prep-head">
        <div>
          <div className="dheading">{data.heading}</div>
          <div className="dtitle">{name}</div>
        </div>
        <div className="prep-controls">
          <span className="muted">You read</span>
          <div className="chips">
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
          <button
            className={'chip' + (rehearse ? ' on' : '')}
            onClick={() => {
              setRehearse((v) => !v)
              toParser()
            }}
          >
            {rehearse ? 'Rehearse: on' : 'Rehearse: off'}
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
          <PdfFrame path={scene.script_path} page={scene.page} />
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
          <button className="btn-accent" onClick={() => api.openFile(scene.script_path)}>Open file</button>
        ) : (
          <button className="btn-accent" onClick={() => api.exportSides('sides', name)}>Export sides PDF</button>
        )}
      </div>
    </div>
  )
}
