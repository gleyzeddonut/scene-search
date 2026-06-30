import { useEffect, useMemo, useState } from 'react'

// Renders a .docx as its real document content: mammoth converts it to HTML in the
// main process; we drop that into a sandboxed iframe (no scripts) styled like a
// page, so the preview shows the actual document rather than the parsed scenes.
const PAGE_CSS = `
  :root { color-scheme: light dark }
  html, body { margin: 0 }
  body {
    font: 15px/1.6 'Times New Roman', Georgia, serif;
    color: #1a1a1a; background: #fff;
    padding: 40px 46px; max-width: 760px; margin: 0 auto;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6ea; background: #1d1e23 }
    a { color: #9db4ff }
  }
  p { margin: 0 0 10px }
  h1,h2,h3 { font-family: 'Space Grotesk', system-ui, sans-serif; line-height: 1.25 }
  img { max-width: 100%; height: auto }
  table { border-collapse: collapse }
  td, th { border: 1px solid #bbb; padding: 4px 8px }
`

export function DocFrame({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    setHtml(null)
    setErr(false)
    window.scripty
      .renderDoc(path)
      .then((h) => {
        if (!alive) return
        if (h == null) setErr(true)
        else setHtml(h)
      })
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [path])

  // full self-contained document so the sandboxed iframe renders it standalone. A CSP
  // blocks remote subresources — mammoth inlines images as data: URIs, so a malicious
  // .docx can't beacon out a remote <img> (the sandbox already blocks scripts).
  const srcDoc = useMemo(
    () =>
      html == null
        ? ''
        : `<!doctype html><html><head><meta charset="utf-8">` +
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
          `<style>${PAGE_CSS}</style></head><body>${html}</body></html>`,
    [html]
  )

  if (err) return <div className="dnote">Couldn’t open this document.</div>
  if (html == null) return <div className="dnote">Loading document…</div>
  return (
    <div className="pdfwrap">
      <iframe className="pdfframe docframe" title="Document" sandbox="" srcDoc={srcDoc} />
    </div>
  )
}
