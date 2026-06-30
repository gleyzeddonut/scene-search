import { useState } from 'react'

const SUGGESTED = [
  'Drama', 'Comedy', 'Thriller', 'Romance', 'Horror', 'Sci-Fi',
  'Action', 'Fantasy', 'Mystery', 'Crime'
]

// A small dropdown anchored to a Browse-row Genre/Medium cell for quick inline edits
// (no need to open the full Edit-details modal). Medium is single-select; Genre is
// multi-select with an add-your-own field.
export function RowMetaEditor(props: {
  kind: 'genre' | 'medium'
  rect: DOMRect
  genres: string[]
  medium: string | null
  allGenres: string[]
  allMediums: string[]
  onApplyGenres: (genres: string[]) => void
  onApplyMedium: (medium: string | null) => void
  onClose: () => void
}) {
  const [genres, setGenres] = useState<string[]>(props.genres)
  const [custom, setCustom] = useState('')
  // freeze the option order when the dropdown opens — toggling a genre updates only
  // its checkmark, never its position (selected genres don't jump around)
  const [options, setOptions] = useState<string[]>(() => [
    ...new Set([...props.allGenres, ...SUGGESTED, ...props.genres])
  ])

  // position: below the cell, or above when there isn't room
  const openUp = window.innerHeight - props.rect.bottom < 280
  const style: React.CSSProperties = {
    left: Math.min(props.rect.left, window.innerWidth - 232),
    ...(openUp ? { bottom: window.innerHeight - props.rect.top + 4 } : { top: props.rect.bottom + 4 })
  }

  const toggleGenre = (g: string) => {
    const next = genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g]
    setGenres(next)
    props.onApplyGenres(next)
  }
  const addCustom = () => {
    const v = custom.trim()
    if (v && !genres.some((g) => g.toLowerCase() === v.toLowerCase())) {
      const next = [...genres, v]
      setGenres(next)
      if (!options.some((o) => o.toLowerCase() === v.toLowerCase())) setOptions((o) => [...o, v]) // append, don't reorder
      props.onApplyGenres(next)
    }
    setCustom('')
  }

  return (
    <div className="rme-backdrop" onClick={props.onClose}>
      <div className="rme" style={style} onClick={(e) => e.stopPropagation()}>
        {props.kind === 'medium' ? (
          <div className="rme-list">
            <button
              className={'rme-opt' + (!props.medium ? ' on' : '')}
              onClick={() => {
                props.onApplyMedium(null)
                props.onClose()
              }}
            >
              None
            </button>
            {props.allMediums.map((m) => (
              <button
                key={m}
                className={'rme-opt' + (props.medium === m ? ' on' : '')}
                onClick={() => {
                  props.onApplyMedium(m)
                  props.onClose()
                }}
              >
                {m}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="rme-list rme-genres">
              {options.map((g) => (
                <button
                  key={g}
                  className={'rme-opt' + (genres.includes(g) ? ' on' : '')}
                  onClick={() => toggleGenre(g)}
                >
                  <span className="rme-check">{genres.includes(g) ? '✓' : ''}</span>
                  {g}
                </button>
              ))}
            </div>
            <div className="rme-add">
              <input
                autoFocus
                placeholder="Add your own…"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCustom()
                  else if (e.key === 'Escape') props.onClose()
                }}
              />
              <button className="rme-addbtn" onClick={addCustom}>Add</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
