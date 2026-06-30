import { useEffect, useState } from 'react'
import { api } from './api'

const SUGGESTED = [
  'Drama', 'Comedy', 'Thriller', 'Romance', 'Horror', 'Sci-Fi',
  'Action', 'Fantasy', 'Mystery', 'Crime', 'Family', 'Coming-of-Age'
]
const GENDERS: [string, string][] = [['W', 'female'], ['M', 'male'], ['U', 'unknown']]

// Manual per-script metadata: genre tags + character-gender overrides.
export function EditDetailsModal({
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
  const [fileName, setFileName] = useState(stem0)
  const [loaded, setLoaded] = useState(false)
  const [genres, setGenres] = useState<string[]>([])
  const [cast, setCast] = useState<string[]>([])
  const [genders, setGenders] = useState<Record<string, string>>({})
  const [medium, setMedium] = useState('')
  const [mediums, setMediums] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api
      .getMeta(path)
      .then((m) => {
        setGenres(m.genres)
        setCast(m.cast.map((c) => c.name))
        setGenders(Object.fromEntries(m.cast.map((c) => [c.name, c.gender])))
        setMedium(m.medium)
        setMediums(m.mediums)
      })
      .finally(() => setLoaded(true))
  }, [path])

  const toggleGenre = (g: string) =>
    setGenres((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))
  const addCustom = () => {
    const v = custom.trim()
    if (v && !genres.some((g) => g.toLowerCase() === v.toLowerCase())) setGenres((c) => [...c, v])
    setCustom('')
  }
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      // rename the file first (if changed) — engine.rename moves the index + metadata
      // to the new path, which we then save the edited details against
      let target = path
      const newStem = fileName.trim()
      if (newStem && newStem !== stem0) {
        const r = await api.renameScript(path, newStem)
        if (!r.ok) {
          setBusy(false)
          setErr(
            r.error === 'exists'
              ? 'A file with that name already exists.'
              : r.error === 'busy'
                ? 'Library is indexing — try again in a moment.'
                : 'Couldn’t rename the file.'
          )
          return
        }
        target = r.path ?? path
      }
      await api.setMeta(target, { genres, genders, medium: medium || undefined })
      onDone('Saved details')
    } catch {
      setBusy(false)
      setErr('Couldn’t save.')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Edit details</div>

        {!loaded ? (
          <div className="dnote">Loading…</div>
        ) : (
          <div className="ed-body">
            <div className="ed-sec">File name</div>
            <div className="rename-row">
              <input
                className="rename-input"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                }}
              />
              {ext && <span className="rename-ext">{ext}</span>}
            </div>

            <div className="ed-sec">Medium</div>
            <div className="ed-suggest">
              <button className={'chip' + (medium === '' ? ' on' : '')} onClick={() => setMedium('')}>
                None
              </button>
              {mediums.map((md) => (
                <button
                  key={md}
                  className={'chip' + (medium === md ? ' on' : '')}
                  onClick={() => setMedium(md)}
                >
                  {md}
                </button>
              ))}
            </div>

            <div className="ed-sec">Genres</div>
            <div className="ed-tags">
              {genres.length ? (
                genres.map((g) => (
                  <span key={g} className="fchip">
                    {g}
                    <span className="x" onClick={() => toggleGenre(g)}>✕</span>
                  </span>
                ))
              ) : (
                <span className="muted">No genres yet — add some below.</span>
              )}
            </div>
            <div className="ed-suggest">
              {SUGGESTED.filter((g) => !genres.includes(g)).map((g) => (
                <button key={g} className="chip" onClick={() => toggleGenre(g)}>+ {g}</button>
              ))}
            </div>
            <div className="ed-custom">
              <input
                className="rename-input"
                placeholder="Add your own…"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCustom()
                }}
              />
              <button className="ghost" onClick={addCustom}>Add</button>
            </div>

            <div className="ed-sec">Cast — gender</div>
            {cast.length ? (
              <div className="ed-cast">
                {cast.map((nm) => (
                  <div key={nm} className="ed-castrow">
                    <span className="ed-name" title={nm}>{nm}</span>
                    <span className="seg-gender">
                      {GENDERS.map(([lab, val]) => (
                        <button
                          key={val}
                          className={genders[nm] === val ? 'on' : ''}
                          onClick={() => setGenders((cur) => ({ ...cur, [nm]: val }))}
                        >
                          {lab}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No speaking characters detected.</div>
            )}
          </div>
        )}

        {err && <div className="rename-err">{err}</div>}
        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={save} disabled={busy || !loaded}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
