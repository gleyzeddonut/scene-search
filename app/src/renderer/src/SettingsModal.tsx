export function SettingsModal(props: { theme: string; onTheme: (t: string) => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>
        <div className="set-row">
          <div>
            <div className="set-label">Appearance</div>
            <div className="set-sub">Match the look you prefer.</div>
          </div>
          <div className="seg">
            <span className={props.theme === 'light' ? 'on' : ''} onClick={() => props.onTheme('light')}>Light</span>
            <span className={props.theme === 'dark' ? 'on' : ''} onClick={() => props.onTheme('dark')}>Dark</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
