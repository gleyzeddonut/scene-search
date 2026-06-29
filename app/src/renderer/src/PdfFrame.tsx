import { useEffect, useState } from 'react'

// Loads the PDF bytes via IPC and shows them in a blob URL so Chromium's
// built-in PDF viewer renders it (no custom protocol / CORS to fight).
export function PdfFrame({ path, page }: { path: string; page?: number }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState(false)

  useEffect(() => {
    let active = true
    let made = ''
    setErr(false)
    setUrl('')
    window.scripty
      .readFile(path)
      .then((bytes) => {
        if (!active) return
        const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
        made = URL.createObjectURL(blob)
        setUrl(made + (page ? `#page=${page}` : ''))
      })
      .catch(() => active && setErr(true))
    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [path, page])

  if (err) return <div className="dnote">Couldn’t open this PDF.</div>
  if (!url) return <div className="dnote">Loading PDF…</div>
  return <iframe className="pdfframe" src={url} title="Script PDF" />
}
