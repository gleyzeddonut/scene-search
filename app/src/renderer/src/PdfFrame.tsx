import { useEffect, useRef, useState } from 'react'

// Loads the PDF bytes via IPC and shows them in a blob URL so Chromium's
// built-in PDF viewer renders it. The blob is reused across page changes within
// the same file, and the current preview stays visible while the next file loads,
// so moving between rows doesn't flash a "Loading…" state.
export function PdfFrame({ path, page }: { path: string; page?: number }) {
  const [url, setUrl] = useState('') // blob URL (no fragment); empty only before the first load
  const [err, setErr] = useState(false)
  const blob = useRef<{ path: string; url: string } | null>(null)

  useEffect(() => {
    let active = true
    setErr(false)
    window.scripty
      .readFile(path)
      .then((bytes) => {
        if (!active) return // a newer selection arrived — ignore this stale read
        const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
        if (blob.current) URL.revokeObjectURL(blob.current.url) // free the previous file
        blob.current = { path, url: u }
        setUrl(u)
      })
      .catch(() => active && setErr(true))
    return () => {
      active = false
    }
  }, [path]) // re-read only when the file changes — page changes reuse the blob

  // revoke the last blob on unmount
  useEffect(
    () => () => {
      if (blob.current) URL.revokeObjectURL(blob.current.url)
    },
    []
  )

  if (err) return <div className="dnote">Couldn’t open this PDF.</div>
  if (!url) return <div className="dnote">Loading PDF…</div>
  // #toolbar=0&navpanes=0 hides Chromium's PDF toolbar (print/download) and side panel
  const src = url + `#toolbar=0&navpanes=0${page ? `&page=${page}` : ''}`
  return <iframe className="pdfframe" src={src} title="Script PDF" />
}
