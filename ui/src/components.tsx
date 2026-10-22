import { useEffect, useState, type ReactNode } from 'react'
import { api, type ServiceStatus } from './api.ts'

export function Alert({ kind, children, onClose }: { kind: 'error' | 'warn' | 'ok'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`alert ${kind}`} role="alert">
      <span>{kind === 'error' ? '✖' : kind === 'warn' ? '!' : '✔'}</span>
      <div>{children}</div>
      {onClose && (
        <button className="close" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

export function StateBadge({ service }: { service: ServiceStatus }) {
  if (!service.installed) return <span className="badge warn">not installed</span>
  return <span className={`badge ${service.running ? 'on' : 'off'}`}>{service.running ? 'running' : 'stopped'}</span>
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setDone(true)
        window.setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? 'Copied' : label}
    </button>
  )
}

export function FileEditor({ path, onClose, readOnly = false }: { path: string; onClose: () => void; readOnly?: boolean }) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api<{ content: string }>(`/api/v1/files?path=${encodeURIComponent(path)}`)
      .then((r) => setContent(r.content))
      .catch((e: Error) => setError(e.message))
  }, [path])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="mono">{path}</span>
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        </header>
        {error && <Alert kind="error">{error}</Alert>}
        <textarea value={content ?? 'Loading…'} readOnly={readOnly || content === null} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
        {!readOnly && (
          <footer>
            <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
              Generated files are re-rendered on the next start; edit templates for permanent changes.
            </span>
            <button
              className="btn primary"
              disabled={saving || content === null}
              onClick={async () => {
                setSaving(true)
                try {
                  await api('/api/v1/files', { method: 'PUT', body: JSON.stringify({ path, content }) })
                  onClose()
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setSaving(false)
                }
              }}
            >
              Save
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
