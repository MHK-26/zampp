import { useEffect, useState } from 'react'
import { api, patch, post, type PhpVersions } from '../api.ts'
import { useBusy } from '../hooks.ts'
import type { PageProps } from '../App.tsx'

export function Php({ status, refresh, notify }: PageProps) {
  const [data, setData] = useState<PhpVersions | null>(null)
  const [custom, setCustom] = useState('')
  const { busy, run } = useBusy()
  const load = () => api<PhpVersions>('/api/v1/php/versions').then(setData).catch((e: Error) => notify('error', e.message))
  useEffect(() => {
    void load()
  }, [])
  if (!data || !status) return <div className="empty">Loading…</div>

  const install = (version: string) =>
    run(
      `install:${version}`,
      async () => {
        await post('/api/v1/php/versions', { version })
        notify('ok', `PHP ${version} installed`)
        await Promise.all([load(), refresh()])
      },
      (e) => notify('error', e.message),
    )
  const minors = [...new Set(data.available.map((v) => v.split('.').slice(0, 2).join('.')))]
  const running = new Set(status.services.filter((s) => s.running).map((s) => s.id))

  return (
    <>
      <div className="two">
        <div className="card">
          <h3>Installed</h3>
          {data.installed.length === 0 ? (
            <p className="muted">No PHP yet. Install one on the right; zampp also auto-detects Homebrew PHP.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Source</th>
                  <th>FPM</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.installed.map((p) => (
                  <tr key={p.version}>
                    <td>
                      <strong>{p.version}</strong> {p.version === data.default && <span className="badge on">default</span>}{' '}
                      {running.has(`php-fpm:${p.version}`) && <span className="muted" style={{ fontSize: 12 }}>running</span>}
                    </td>
                    <td>{p.source}</td>
                    <td className="mono" title={p.fpm}>
                      {p.fpm.replace(status.home, '~/.zampp')}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.version !== data.default && (
                        <button
                          className="btn sm"
                          disabled={busy[`default:${p.version}`]}
                          onClick={() =>
                            run(
                              `default:${p.version}`,
                              async () => {
                                await patch('/api/v1/php/default', { version: p.version })
                                notify('ok', `Default PHP is now ${p.version} (Apache restarted)`)
                                await Promise.all([load(), refresh()])
                              },
                              (e) => notify('error', e.message),
                            )
                          }
                        >
                          Make default
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row">
            <button className="btn sm" disabled={busy.detect} onClick={() => run('detect', () => post('/api/v1/php/detect').then(() => Promise.all([load(), refresh()])), (e) => notify('error', e.message))}>
              Detect Homebrew PHP
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Install another version</h3>
          <p className="muted">
            Static builds from <a href="https://static-php.dev" target="_blank" rel="noreferrer">static-php-cli</a>: one 15 MB download per version, no Homebrew, no sudo. Includes mysqlnd, pdo_mysql, pdo_sqlite, pdo_pgsql, gd, intl-free mbstring, zip, redis, opcache, curl, openssl, sockets, bcmath.
          </p>
          <div className="row">
            {minors.map((m) => {
              const latest = data.available.find((v) => v.startsWith(`${m}.`)) ?? m
              const installed = data.installed.some((p) => p.version === latest)
              return (
                <button key={m} className="btn" disabled={installed || busy[`install:${latest}`]} onClick={() => install(latest)}>
                  {busy[`install:${latest}`] ? 'Installing…' : installed ? `${latest} ✓` : `PHP ${latest}`}
                </button>
              )
            })}
            {data.available.length === 0 && <span className="muted">Could not reach the static-php index.</span>}
          </div>
          <div className="row">
            <input className="mono" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="exact version, e.g. 8.3.30" style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)' }} />
            <button className="btn" disabled={!custom.trim() || busy[`install:${custom.trim()}`]} onClick={() => install(custom.trim())}>
              Install
            </button>
          </div>
        </div>
      </div>
      <div className="section">
        <h2>Using the CLI</h2>
        <pre className="snippet">{`zampp php list
zampp php install 8.3          # newest 8.3.x
zampp php use 8.3.30           # default for localhost and unpinned sites
zampp site add legacy ~/code/legacy --php 8.1`}</pre>
      </div>
    </>
  )
}
