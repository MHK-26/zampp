import { useEffect, useState } from 'react'
import { api, type Check } from '../api.ts'
import type { PageProps } from '../App.tsx'

export function Doctor({ notify }: PageProps) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    try {
      setChecks(await api<Check[]>('/api/v1/doctor'))
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={load} disabled={busy}>
          {busy ? 'Checking…' : 'Run again'}
        </button>
        <span className="muted">Same checks as <code>zampp doctor</code>.</span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {checks === null ? (
          <div className="empty">Running checks…</div>
        ) : (
          checks.map((c) => (
            <div className="check" key={c.id}>
              <span className={`lvl ${c.level}`}>{c.level === 'ok' ? '✔' : c.level === 'warn' ? '!' : '✖'}</span>
              <strong>{c.title}</strong>
              <div>
                {c.detail}
                {c.fix && <div className="fix">→ {c.fix}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
