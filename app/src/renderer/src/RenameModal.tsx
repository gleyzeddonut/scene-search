import { useState } from 'react'
import { api } from './api'

// Rename a script file (keeps the extension). Triggered from a row's right-click menu.
export function RenameModal({
  path,
  name,
  onClose,
  onDone
}: {
  path: string
  name: string
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  const stem0 = dot > 0 ? name.slice(0, dot) : name
  const [val, setVal] = useState(stem0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    const v = val.trim()
    if (!v) return setErr('Enter a name.')
    if (v === stem0) return onClose()
    setBusy(true)
    setErr('')
    try {
      const r = await api.renameScript(path, v)
      if (r.ok) return onDone(`Renamed to “${v}${ext}”`)
      setBusy(false)
      setErr(
        r.error === 'exists'
          ? 'A file with that name already exists.'
          : r.error === 'busy'
            ? 'Library is indexing — try again in a moment.'
            : 'Couldn’t rename the file.'
      )
    } catch {
      setBusy(false)
      setErr('Couldn’t rename the file.')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Rename file</div>
        <div className="rename-row">
          <input
            autoFocus
            className="rename-input"
            value={val}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') onClose()
            }}
          />
          {ext && <span className="rename-ext">{ext}</span>}
        </div>
        {err && <div className="rename-err">{err}</div>}
        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={submit} disabled={busy}>
            {busy ? 'Renaming…' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  )
}
