// Branded launch screen. Visible until the app is ready (with a short minimum so
// it's actually seen), then fades out and unmounts.
export function Splash({ out }: { out: boolean }) {
  return (
    <div className={'splash' + (out ? ' out' : '')}>
      <div className="splash-in">
        <div className="splash-logo">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
            <circle cx="9" cy="9" r="6" />
            <line x1="13.5" y1="13.5" x2="17.5" y2="17.5" />
          </svg>
        </div>
        <div className="splash-word">Scripty</div>
        <div className="splash-tag">Find the scene you came for</div>
        <div className="splash-bar">
          <div className="splash-seg" />
        </div>
      </div>
    </div>
  )
}
