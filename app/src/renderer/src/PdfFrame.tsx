import { useEffect, useRef, useState } from 'react'

// Loads PDF bytes via IPC into a blob URL for Chromium's PDF viewer. To avoid a
// flicker when the selection changes, it double-buffers: the visible iframe stays
// up until the next page/file has fully loaded in a second iframe, then swaps.
export function PdfFrame({
  path,
  page,
  top,
  nonce
}: {
  path: string
  page?: number
  top?: number // PDF-points y of the scene heading → scroll it near the top of the view
  nonce?: string | number
}) {
  const [url, setUrl] = useState('') // blob URL; reused across page changes within a file
  const [err, setErr] = useState(false)
  const blob = useRef<{ path: string; url: string } | null>(null)
  const [srcs, setSrcs] = useState(['', '']) // two iframe buffers
  const [active, setActive] = useState(0) // which buffer is shown

  useEffect(() => {
    let alive = true
    setErr(false)
    window.scripty
      .readFile(path)
      .then((bytes) => {
        if (!alive) return
        const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
        if (blob.current) URL.revokeObjectURL(blob.current.url)
        blob.current = { path, url: u }
        setUrl(u)
      })
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [path]) // re-read only when the file changes

  useEffect(
    () => () => {
      if (blob.current) URL.revokeObjectURL(blob.current.url)
    },
    []
  )

  // #toolbar=0&navpanes=0 hides Chromium's PDF toolbar + side panel. Always pin a
  // page; when we know the scene heading's y (top), use view=FitH so the scene starts
  // near the top of the view instead of the page top (it's often mid/bottom of a page).
  // Chromium reads `view=FitH,<v>` as a scroll offset DOWN from the page top, in
  // screen pixels at 100% zoom (PDF points × 96/72) — NOT the spec's from-bottom
  // points, which only named destinations get. `top` is the heading's baseline in
  // points from the page TOP; back off ~12pt for the heading's own text height so
  // the slug sits flush at the top of the view. A per-scene token forces a fresh scroll.
  const view = top != null ? `&view=FitH,${Math.max(0, Math.round((top - 12) * (96 / 72)))}` : ''
  const target = url
    ? url + `#toolbar=0&navpanes=0&page=${page || 1}${view}${nonce != null ? `&n=${nonce}` : ''}`
    : ''

  // load the next target into the hidden buffer; it becomes visible on its onLoad
  useEffect(() => {
    if (!target || srcs[active] === target) return
    const back = 1 - active
    if (srcs[back] === target) {
      setActive(back)
      return
    }
    setSrcs((s) => {
      const n = [...s]
      n[back] = target
      return n
    })
  }, [target, active, srcs])

  if (err) return <div className="dnote">Couldn’t open this PDF.</div>
  if (!url) return <div className="dnote">Loading PDF…</div>

  return (
    <div className="pdfwrap">
      {[0, 1].map((i) =>
        srcs[i] ? (
          <iframe
            // keyed by src: the targets differ only in their #fragment, and changing
            // an existing iframe's src to a fragment-only variation is a SAME-document
            // navigation — the PDF plugin neither reloads nor re-applies the scroll
            // params, freezing each buffer at its first-loaded position. A fresh
            // element per target forces a real load (the double-buffer hides it).
            key={`${i}:${srcs[i]}`}
            src={srcs[i]}
            title="Script PDF"
            className="pdfframe"
            onLoad={() => {
              if (i !== active && srcs[i] === target) setActive(i)
            }}
            style={{ opacity: i === active ? 1 : 0, zIndex: i === active ? 2 : 1, pointerEvents: i === active ? 'auto' : 'none' }}
          />
        ) : null
      )}
    </div>
  )
}
