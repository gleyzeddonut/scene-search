import { useEffect, useRef, useState } from 'react'
import { Scene, SceneDetail, sceneBlocks, isPdf } from './api'
import { PdfFrame } from './PdfFrame'

const MIN_W = 380
const MIN_H = 320

type Rect = { x: number; y: number; w: number; h: number }
type Mode = 'move' | 'resize' | null

// Finder-style Quick Look: a floating preview the user can drag by its header
// and resize from the bottom-right corner. A shield over the window during a
// drag keeps the PDF iframe from swallowing mouse events.
export function QuickLook({
  scene,
  detail,
  onClose
}: {
  scene: Scene
  detail: SceneDetail | null
  onClose: () => void
}) {
  const [rect, setRect] = useState<Rect>(() => {
    const w = Math.min(900, Math.round(window.innerWidth * 0.86))
    const h = Math.round(window.innerHeight * 0.86)
    return { x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2), w, h }
  })
  const [mode, setMode] = useState<Mode>(null)
  const start = useRef({ mx: 0, my: 0, rect: rect })

  const begin = (m: Exclude<Mode, null>) => (e: React.MouseEvent) => {
    e.preventDefault()
    start.current = { mx: e.clientX, my: e.clientY, rect }
    setMode(m)
  }

  useEffect(() => {
    if (!mode) return
    const onMove = (e: MouseEvent) => {
      const { mx, my, rect: r } = start.current
      const dx = e.clientX - mx
      const dy = e.clientY - my
      if (mode === 'move') {
        const x = Math.min(Math.max(r.x + dx, 8 - r.w + 160), window.innerWidth - 160)
        const y = Math.min(Math.max(r.y + dy, 0), window.innerHeight - 48)
        setRect((p) => ({ ...p, x, y }))
      } else {
        const w = Math.min(Math.max(r.w + dx, MIN_W), window.innerWidth - r.x - 8)
        const h = Math.min(Math.max(r.h + dy, MIN_H), window.innerHeight - r.y - 8)
        setRect((p) => ({ ...p, w, h }))
      }
    }
    const onUp = () => setMode(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [mode])

  const blocks = detail ? sceneBlocks(detail) : []

  return (
    <div
      className="ql-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ql-panel" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
        <div className="ql-head" onMouseDown={begin('move')}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ql-title">{scene.script_name.replace(/\.[^.]+$/, '')}</div>
            <div className="ql-sub">
              {scene.heading}
              {scene.page ? ` · p.${scene.page}` : ''}
            </div>
          </div>
          <button
            className="ql-close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            title="Close (Space / Esc)"
          >
            ✕
          </button>
        </div>
        <div className="ql-body">
          {isPdf(scene.script_path) ? (
            <PdfFrame path={scene.script_path} page={scene.page} />
          ) : (
            <div className="dcard ql-scene">
              <div className="h">{scene.heading}</div>
              {detail === null ? (
                <div className="dnote">Loading scene…</div>
              ) : blocks.length === 0 ? (
                <div className="dnote">No text could be read from this scene.</div>
              ) : (
                blocks.map((b, i) =>
                  b.type === 'cue' ? (
                    <div key={i}>
                      <div className="dcue">{b.who}</div>
                      <div className="dtext">{b.text}</div>
                    </div>
                  ) : (
                    <div key={i} className="daction">
                      {b.text}
                    </div>
                  )
                )
              )}
            </div>
          )}
        </div>
        <div className="ql-resize" onMouseDown={begin('resize')} title="Drag to resize" />
      </div>
      {mode && <div className="ql-shield" style={{ cursor: mode === 'move' ? 'move' : 'nwse-resize' }} />}
    </div>
  )
}
