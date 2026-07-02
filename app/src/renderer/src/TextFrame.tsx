import { useEffect, useMemo, useState } from 'react'

// Shows a plain-text script (.txt/.fountain) as its REAL file content — the parsed
// preview drops anything outside a recognized scene (title pages, notes), so for
// full fidelity we read the raw bytes and render them verbatim, like Finder. Goes
// in a sandboxed iframe (no scripts) so the text can't be interpreted as markup.
const PAGE_CSS = `
  :root { color-scheme: light dark }
  html, body { margin: 0 }
  body {
    font: 13px/1.6 'Courier Prime', ui-monospace, monospace;
    color: #1a1a1a; background: #fff; padding: 36px 42px;
  }
  @media (prefers-color-scheme: dark) { body { color: #e6e6ea; background: #1d1e23 } }
  pre { margin: 0; white-space: pre-wrap; word-wrap: break-word }
`
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function TextFrame({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    setText(null)
    setErr(false)
    window.scripty
      .readFile(path)
      .then((bytes) => {
        if (!alive) return
        setText(new TextDecoder().decode(bytes as Uint8Array))
      })
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [path])

  const srcDoc = useMemo(
    () =>
      text == null
        ? ''
        : `<!doctype html><html><head><meta charset="utf-8">` +
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
          `<style>${PAGE_CSS}</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`,
    [text]
  )

  if (err) return <div className="dnote">Couldn’t open this file.</div>
  if (text == null) return <div className="dnote">Loading…</div>
  return (
    <div className="pdfwrap">
      <iframe className="pdfframe docframe" title="Document" sandbox="" srcDoc={srcDoc} />
    </div>
  )
}
