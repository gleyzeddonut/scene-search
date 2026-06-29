import { useEffect, useState } from 'react'
import { api, Scene, SceneDetail } from './api'

function mmss(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function PrepareView({ scene, onBack }: { scene: Scene; onBack: () => void }) {
  const [data, setData] = useState<SceneDetail | null>(null)
  const [role, setRole] = useState('')
  const [rehearse, setRehearse] = useState(false)

  useEffect(() => {
    api.getScene(scene.script_path, scene.scene_index).then((d) => {
      setData(d)
      setRole(d.lines[0]?.who || '')
    })
  }, [scene])

  if (!data) return <div style={{ padding: 40 }}>Loading scene…</div>
  const roles = Array.from(new Set(data.lines.map((l) => l.who)))
  const name = scene.script_name.replace(/\.[^.]+$/, '')

  return (
    <div className="prepare">
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
        </div>
      </div>

      <div className="sides-scroll">
        <div className="sides" id="sides">
          <div className="sides-h">{data.heading}</div>
          {data.lines.map((l, i) => {
            const mine = l.who === role
            return (
              <div key={i}>
                <div className={'cue' + (mine ? ' mine' : '')}>{l.who}</div>
                <div className={'sline' + (mine ? ' mine' : '')}>
                  {mine && rehearse ? '— — — — — —' : l.text}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="prep-foot">
        <button className="ghost" onClick={onBack}>← Back to results</button>
        <span className="muted">Est. {mmss(data.est_seconds)} at performance pace</span>
        <button className="btn primary" onClick={() => api.exportSides('sides', name)}>
          Export sides PDF
        </button>
      </div>
    </div>
  )
}
