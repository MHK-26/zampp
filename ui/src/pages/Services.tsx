import { useState } from 'react'
import { post } from '../api.ts'
import { FileEditor, StateBadge } from '../components.tsx'
import { formatUptime, useBusy } from '../hooks.ts'
import type { PageProps } from '../App.tsx'

export function Services({ status, refresh, notify }: PageProps) {
  const { busy, run } = useBusy()
  const [editing, setEditing] = useState<string | null>(null)
  if (!status) return <div className="empty">Loading…</div>
  const act = (id: string, action: string) => run(id, () => post(`/api/v1/services/${encodeURIComponent(id)}/${action}`).then(refresh), (e) => notify('error', e.message))
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>State</th>
            <th>Version</th>
            <th>Ports</th>
            <th>PID</th>
            <th>Uptime</th>
            <th>Config</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {status.services.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {s.description}
                </div>
              </td>
              <td>
                <StateBadge service={s} />
              </td>
              <td>
                {s.version ?? '—'}
                <div className="muted" style={{ fontSize: 12 }}>
                  {s.source}
                </div>
              </td>
              <td className="mono">{s.ports.join(', ') || '—'}</td>
              <td className="mono">{s.pid ?? '—'}</td>
              <td>{formatUptime(s.startedAt)}</td>
              <td>
                {s.configs.map((c) => (
                  <button key={c.path} className="btn sm" onClick={() => setEditing(c.path)} style={{ marginRight: 4 }}>
                    {c.name}
                  </button>
                ))}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {s.running ? (
                  <>
                    <button className="btn sm" disabled={busy[s.id]} onClick={() => act(s.id, 'stop')}>
                      Stop
                    </button>{' '}
                    <button className="btn sm" disabled={busy[s.id]} onClick={() => act(s.id, 'restart')}>
                      Restart
                    </button>
                  </>
                ) : (
                  <button className="btn sm primary" disabled={busy[s.id]} onClick={() => act(s.id, 'start')}>
                    {busy[s.id] ? 'Starting…' : s.installed ? 'Start' : 'Install & start'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 12 }}>
        Services run as your user, bind to 127.0.0.1 only, and keep running after you close this panel. Configuration is rendered from templates into <code>{status.home}/etc</code> on every start.
      </p>
      {editing && <FileEditor path={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
