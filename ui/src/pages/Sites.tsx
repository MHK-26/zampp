import { useState } from 'react'
import { del, post, patch, type HostsSyncResult, type Site } from '../api.ts'
import { Alert } from '../components.tsx'
import { useBusy } from '../hooks.ts'
import type { PageProps } from '../App.tsx'

export function Sites({ status, refresh, notify }: PageProps) {
  const { busy, run } = useBusy()
  const [form, setForm] = useState({ name: '', root: '', php: '', tls: false, aliases: '' })
  const [hosts, setHosts] = useState<HostsSyncResult | null>(null)
  if (!status) return <div className="empty">Loading…</div>
  const phpVersions = status.services.filter((s) => s.id.startsWith('php-fpm:')).map((s) => s.id.slice('php-fpm:'.length))
  const defaultRoot = form.name ? `${status.home.replace(/\/\.zampp$/, '')}/Sites/${form.name}` : ''

  const submit = () =>
    run(
      'create',
      async () => {
        const result = await post<{ site: Site; hosts: HostsSyncResult }>('/api/v1/sites', {
          name: form.name.trim().toLowerCase(),
          root: form.root.trim() || defaultRoot,
          ...(form.php ? { php: form.php } : {}),
          tls: form.tls,
          aliases: form.aliases.split(/[\s,]+/).filter(Boolean),
        })
        setHosts(result.hosts)
        setForm({ name: '', root: '', php: '', tls: false, aliases: '' })
        notify('ok', `${result.site.host} is ready at ${result.site.url}`)
        await refresh()
      },
      (e) => notify('error', e.message),
    )

  return (
    <>
      {hosts?.error && (
        <Alert kind="warn" onClose={() => setHosts(null)}>
          The hosts file was not updated ({hosts.error}). Sites will not resolve until it is.{' '}
          <button className="btn sm" onClick={() => run('hosts', () => post<HostsSyncResult>('/api/v1/hosts/sync').then(setHosts), (e) => notify('error', e.message))}>
            Retry (asks for your password)
          </button>
        </Alert>
      )}
      <div className="two">
        <div className="card">
          <h3>New site</h3>
          <div className="form">
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="myapp" spellCheck={false} />
              <span className="hint">
                Becomes <code>{form.name || 'myapp'}.{status.settings.tld}</code>. Lowercase letters, digits, dashes.
              </span>
            </div>
            <div className="field">
              <label>Document root</label>
              <input value={form.root} onChange={(e) => setForm({ ...form, root: e.target.value })} placeholder={defaultRoot || '/path/to/project/public'} spellCheck={false} />
              <span className="hint">Created with a starter index.php if it does not exist.</span>
            </div>
            <div className="two">
              <div className="field">
                <label>PHP version</label>
                <select value={form.php} onChange={(e) => setForm({ ...form, php: e.target.value })}>
                  <option value="">default ({status.settings.php.default ?? phpVersions[0] ?? 'none'})</option>
                  {phpVersions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Aliases</label>
                <input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} placeholder="www.myapp.test" spellCheck={false} />
              </div>
            </div>
            <label className="inline">
              <input type="checkbox" checked={form.tls} onChange={(e) => setForm({ ...form, tls: e.target.checked })} /> HTTPS with a locally trusted certificate (mkcert, admin prompt on first use)
            </label>
            <div>
              <button className="btn primary" disabled={busy.create || !/^[a-z0-9][a-z0-9-]*$/.test(form.name.trim().toLowerCase())} onClick={submit}>
                {busy.create ? 'Creating…' : 'Create site'}
              </button>
            </div>
          </div>
        </div>
        <div className="card">
          <h3>How sites work</h3>
          <p className="muted">
            Each site is an Apache virtual host on <code>127.0.0.1:{status.settings.web.httpPort}</code> with its own PHP-FPM pool, <code>.htaccess</code> support and separate access/error logs. zampp adds <code>{'<name>'}.{status.settings.tld}</code> to <code>/etc/hosts</code> (one admin prompt per change).
          </p>
          <p className="muted">
            Pin a PHP version per site to run legacy and modern projects side by side. HTTPS uses a local certificate authority that your browser trusts after the first install.
          </p>
        </div>
      </div>

      <div className="section">
        <h2>Your sites</h2>
        {status.sites.length === 0 ? (
          <div className="empty">No sites yet. Create one above or run <code>zampp site add myapp</code>.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Root</th>
                <th>PHP</th>
                <th>HTTPS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {status.sites.map((site) => (
                <tr key={site.name}>
                  <td>
                    <a href={site.url} target="_blank" rel="noreferrer">
                      {site.host}
                    </a>
                    {site.aliases.length > 0 && <div className="muted mono">{site.aliases.join(' ')}</div>}
                  </td>
                  <td className="mono">{site.root}</td>
                  <td>
                    <select
                      value={site.php ?? ''}
                      onChange={(e) => run(site.name, () => patch(`/api/v1/sites/${site.name}`, { php: e.target.value || undefined, ...(e.target.value ? {} : {}) }).then(refresh), (err) => notify('error', err.message))}
                      disabled={busy[site.name]}
                    >
                      <option value="">default</option>
                      {phpVersions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {site.tls ? (
                      <span className="badge on">on</span>
                    ) : (
                      <button className="btn sm" disabled={busy[site.name]} onClick={() => run(site.name, () => post(`/api/v1/sites/${site.name}/secure`).then(refresh), (e) => notify('error', e.message))}>
                        Enable
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn sm danger"
                      disabled={busy[site.name]}
                      onClick={() => {
                        if (window.confirm(`Remove ${site.host}? Files in ${site.root} are kept.`)) void run(site.name, () => del(`/api/v1/sites/${site.name}`).then(refresh), (e) => notify('error', e.message))
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
