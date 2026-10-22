import { useEffect, useState } from 'react'
import { api, post, type Check } from '../api.ts'
import { StateBadge } from '../components.tsx'
import { formatUptime, useBusy } from '../hooks.ts'
import type { PageProps } from '../App.tsx'

export function Dashboard({ status, refresh, notify, go }: PageProps & { go: (r: string) => void }) {
  const { busy, run } = useBusy()
  const [checks, setChecks] = useState<Check[] | null>(null)
  useEffect(() => {
    api<Check[]>('/api/v1/doctor').then(setChecks).catch(() => setChecks(null))
  }, [status?.services.map((s) => `${s.id}:${s.running}`).join()])

  if (!status) return <div className="empty">Loading…</div>
  const failing = checks?.filter((c) => c.level === 'fail') ?? []

  return (
    <>
      {failing.length > 0 && (
        <div className="alert warn">
          <span>!</span>
          <div>
            {failing.length} problem{failing.length > 1 ? 's' : ''} found: {failing.map((c) => c.title).join(', ')}. <a href="#/doctor">Open Doctor</a>
          </div>
        </div>
      )}
      <div className="grid">
        {status.services.map((s) => (
          <div className="card" key={s.id}>
            <h3>
              {s.name} <StateBadge service={s} />
            </h3>
            <div className="meta">
              {s.version ?? '—'} {s.source ? `· ${s.source}` : ''}
              {s.ports.length > 0 && <> · :{s.ports.join(' :')}</>}
              {s.running && s.startedAt && <> · up {formatUptime(s.startedAt)}</>}
            </div>
            <div className="row">
              {s.running ? (
                <>
                  <button className="btn sm" disabled={busy[s.id]} onClick={() => run(s.id, () => post(`/api/v1/services/${encodeURIComponent(s.id)}/stop`).then(refresh), (e) => notify('error', e.message))}>
                    Stop
                  </button>
                  <button className="btn sm" disabled={busy[s.id]} onClick={() => run(s.id, () => post(`/api/v1/services/${encodeURIComponent(s.id)}/restart`).then(refresh), (e) => notify('error', e.message))}>
                    Restart
                  </button>
                </>
              ) : (
                <button className="btn sm primary" disabled={busy[s.id]} onClick={() => run(s.id, () => post(`/api/v1/services/${encodeURIComponent(s.id)}/start`).then(refresh), (e) => notify('error', e.message))}>
                  {busy[s.id] ? 'Starting…' : s.installed ? 'Start' : 'Install & start'}
                </button>
              )}
              <button className="btn sm" onClick={() => go('logs')}>
                Logs
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Quick links</h2>
        <div className="grid">
          <a className="card" href={status.urls.web} target="_blank" rel="noreferrer">
            <h3>localhost</h3>
            <div className="meta">Welcome page and your files in {status.home}/www</div>
          </a>
          <a className="card" href={status.urls.adminer} target="_blank" rel="noreferrer">
            <h3>Adminer</h3>
            <div className="meta">Database UI, 127.0.0.1:{status.settings.db.port}</div>
          </a>
          <a className="card" href={status.urls.mail} target="_blank" rel="noreferrer">
            <h3>Mailpit</h3>
            <div className="meta">Inbox for every mail() your code sends</div>
          </a>
          <a className="card" href="#/sites">
            <h3>Sites</h3>
            <div className="meta">
              {status.sites.length} site{status.sites.length === 1 ? '' : 's'} on *.{status.settings.tld}
            </div>
          </a>
        </div>
      </div>

      {status.sites.length > 0 && (
        <div className="section">
          <h2>Sites</h2>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Root</th>
                <th>PHP</th>
                <th>HTTPS</th>
              </tr>
            </thead>
            <tbody>
              {status.sites.map((site) => (
                <tr key={site.name}>
                  <td>
                    <a href={site.url} target="_blank" rel="noreferrer">
                      {site.url}
                    </a>
                  </td>
                  <td className="mono">{site.root}</td>
                  <td>{site.phpEffective ?? '—'}</td>
                  <td>{site.tls ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
