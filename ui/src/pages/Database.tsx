import { useEffect, useState } from 'react'
import { api, type Credentials } from '../api.ts'
import { CopyButton } from '../components.tsx'
import type { PageProps } from '../App.tsx'

export function Database({ status, notify }: PageProps) {
  const [creds, setCreds] = useState<Credentials | null>(null)
  const [reveal, setReveal] = useState(false)
  useEffect(() => {
    api<Credentials>('/api/v1/db/credentials').then(setCreds).catch((e: Error) => notify('error', e.message))
  }, [])
  if (!creds || !status) return <div className="empty">Loading…</div>
  const db = status.services.find((s) => s.id === 'mariadb')
  const rows: [string, string, boolean][] = [
    ['Host', creds.host, false],
    ['Port', String(creds.port), false],
    ['User', creds.user, false],
    ['Password', creds.password, true],
    ['Socket', creds.socket, false],
  ]
  return (
    <>
      <div className="two">
        <div className="card">
          <h3>
            Credentials {db && <span className={`badge ${db.running ? 'on' : 'off'}`}>{db.running ? 'running' : 'stopped'}</span>}
          </h3>
          <div className="kv">
            {rows.map(([k, v, secret]) => (
              <Row key={k} k={k} v={v} secret={secret} reveal={reveal} />
            ))}
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => setReveal(!reveal)}>
              {reveal ? 'Hide password' : 'Show password'}
            </button>
            <CopyButton value={creds.password} label="Copy password" />
            <a className="btn sm primary" href={status.urls.phpmyadmin} target="_blank" rel="noreferrer">
              Open phpMyAdmin ↗
            </a>
            <a className="btn sm" href={status.urls.adminer} target="_blank" rel="noreferrer">
              Adminer ↗
            </a>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            Unlike XAMPP, root has a password from the first start and the server only listens on 127.0.0.1. The password is generated once and kept in <code>{status.home}/secrets.json</code> (mode 600).
          </p>
        </div>
        <div className="card">
          <h3>Connect from code</h3>
          <div className="field">
            <label>PHP (PDO)</label>
            <pre className="snippet">{`$pdo = new PDO(
  'mysql:host=127.0.0.1;port=${creds.port};dbname=app;charset=utf8mb4',
  'root',
  '${reveal ? creds.password : '••••••••'}'
);`}</pre>
          </div>
          <div className="field">
            <label>DSN / .env</label>
            <pre className="snippet">{reveal ? creds.dsn : creds.dsn.replace(/:[^:@]+@/, ':••••••••@')}</pre>
          </div>
          <div className="field">
            <label>Terminal</label>
            <pre className="snippet">{`zampp db                      # prints these credentials
mariadb -h 127.0.0.1 -P ${creds.port} -u root -p`}</pre>
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ k, v, secret, reveal }: { k: string; v: string; secret: boolean; reveal: boolean }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className={`v ${secret && !reveal ? 'secret' : ''}`}>{secret && !reveal ? '••••••••••••' : v}</div>
      <div>
        <CopyButton value={v} />
      </div>
    </>
  )
}
