import { useEffect, useState } from 'react'
import './styles.css'
import { PdfFrame } from './PdfFrame'
import { api, SceneDetail, sceneBlocks } from './api'

// Full-window preview rendered inside the pop-out Quick Look window. Reuses the
// same PdfFrame (byte-read → blob) as the main preview, so PDFs render reliably.
export function QuickLookView(props: { path: string; sceneIndex: number; page?: number; isPdf: boolean }) {
  const [detail, setDetail] = useState<SceneDetail | null>(null)

  useEffect(() => {
    if (props.isPdf) return
    let active = true
    api
      .getScene(props.path, props.sceneIndex)
      .then((d) => active && setDetail(d))
      .catch(() => active && setDetail(null))
    return () => {
      active = false
    }
  }, [props.path, props.sceneIndex, props.isPdf])

  if (props.isPdf) {
    return (
      <div className="qlview">
        <PdfFrame path={props.path} page={props.page} />
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
