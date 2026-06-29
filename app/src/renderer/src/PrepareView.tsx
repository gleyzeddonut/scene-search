import { useEffect, useState } from 'react'
import { api, Scene, SceneDetail, sceneBlocks } from './api'

function mmss(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function PrepareView({ scene, onBack }: { scene: Scene; onBack: () => void }) {
  const [data, setData] = useState<SceneDetail | null>(null)
  const [role, setRole] = useState('')
  const [rehearse, setRehearse] = useState(false)
  const [dialogueOnly, setDialogueOnly] = useState(localStorage.getItem('sceneView') === 'dialogue')
  const setView = (v: boolean) => {
    setDialogueOnly(v)
    localStorage.setItem('sceneView', v ? 'dialogue' : 'full')
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
  const blocks = dialogueOnly ? all.filter((b) => b.type === 'cue') : all
  const roles = Array.from(new Set(all.flatMap((b) => (b.type === 'cue' ? [b.who] : []))))
  const name = scene.script_name.replace(/\.[^.]+$/, '')

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
              <button key={r} className={'chip' + (r === role ? ' on' : '')} onClick={() => setRole(r)}>
                {r}
              </button>
            ))}
          </div>
          <button className={'chip' + (rehearse ? ' on' : '')} onClick={() => setRehearse((v) => !v)}>
            {rehearse ? 'Rehearse: on' : 'Rehearse: off'}
          </button>
          <span className="vtoggle">
            <span className={!dialogueOnly ? 'on' : ''} onClick={() => setView(false)}>Full scene</span>
            <span className={dialogueOnly ? 'on' : ''} onClick={() => setView(true)}>Dialogue</span>
          </span>
        </div>
      </div>

      <div className="sides-scroll">
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
      </div>

      <div className="prep-foot">
        <button className="ghost" onClick={onBack}>← Back to results</button>
        <span className="muted">Est. {mmss(data.est_seconds)} at performance pace</span>
        <button className="btn-accent" onClick={() => api.exportSides('sides', name)}>
          Export sides PDF
        </button>
      </div>
    </div>
  )
}
