import { useEffect, useState } from 'react'
import './styles.css'
import { PdfFrame } from './PdfFrame'
import { DocFrame } from './DocFrame'
import { TextFrame } from './TextFrame'
import { api, SceneDetail, sceneBlocks, isDocx, isPlainText } from './api'

type QlScene = { path: string; sceneIndex: number; page?: number; isPdf: boolean; title?: string }

// Full-window preview inside the pop-out Quick Look window. It renders through the
// same PdfFrame (byte-read → blob) as the main preview, and follows the list
// selection in place (the main window sends 'ql-scene' as you arrow through rows).
export function QuickLookView(initial: QlScene) {
  const [scene, setScene] = useState<QlScene>(initial)
  const [detail, setDetail] = useState<SceneDetail | null>(null)

  // follow the selection without reloading the whole window
  useEffect(() => window.scripty.onQuickLookScene?.((p) => setScene(p as QlScene)), [])

  const docx = isDocx(scene.path)
  const txt = isPlainText(scene.path)

  useEffect(() => {
    if (scene.isPdf || docx || txt) return // these render the real file, not parsed text
    let active = true
    api
      .getScene(scene.path, scene.sceneIndex)
      .then((d) => active && setDetail(d))
      .catch(() => active && setDetail(null))
    return () => {
      active = false
    }
  }, [scene.path, scene.sceneIndex, scene.isPdf, docx, txt])

  if (scene.isPdf) {
    return (
      <div className="qlview">
        <PdfFrame path={scene.path} page={scene.page} nonce={scene.sceneIndex} />
      </div>
    )
  }
  if (docx) {
    return (
      <div className="qlview">
        <DocFrame path={scene.path} />
      </div>
    )
  }
  if (txt) {
    return (
      <div className="qlview">
        <TextFrame path={scene.path} />
      </div>
    )
  }

  const blocks = detail ? sceneBlocks(detail) : []
  return (
    <div className="qlview qlscroll">
      <div className="qldoc">
        {detail && <div className="h">{detail.heading}</div>}
        {blocks.length === 0 ? (
          <div className="dnote">{detail === null ? 'Loading…' : 'No text could be read from this scene.'}</div>
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
    </div>
  )
}
