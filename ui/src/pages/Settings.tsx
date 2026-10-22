import { useEffect, useState } from 'react'
import { patch, post, type Settings as SettingsT } from '../api.ts'
import { Alert } from '../components.tsx'
import type { PageProps } from '../App.tsx'

export function Settings({ status, refresh, notify }: PageProps) {
  const [form, setForm] = useState<SettingsT | null>(null)
  const [restart, setRestart] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (status && !form) setForm(status.settings)
  }, [status])
  if (!form || !status) return <div className="empty">Loading…</div>

  const num = (v: string) => Math.max(1, Math.min(65535, Number(v) || 0))
  const save = async () => {
    setSaving(true)
    try {
      const result = await patch<{ settings: SettingsT; restartRequired: string[] }>('/api/v1/settings', form)
      setForm(result.settings)
      setRestart(result.restartRequired)
      notify('ok', 'Settings saved')
      await refresh()
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  const restartNow = async () => {
    setSaving(true)
    try {
      for (const id of restart) {
        const ids = id === 'php-fpm' ? status.services.filter((s) => s.id.startsWith('php-fpm:')).map((s) => s.id) : [id]
        for (const real of ids) if (status.services.find((s) => s.id === real)?.running) await post(`/api/v1/services/${encodeURIComponent(real)}/restart`)
      }
      setRestart([])
      await refresh()
      notify('ok', 'Services restarted')
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {restart.length > 0 && (
        <Alert kind="warn" onClose={() => setRestart([])}>
          Restart {restart.join(', ')} to apply.{' '}
          <button className="btn sm" onClick={restartNow} disabled={saving}>
            Restart now
          </button>
        </Alert>
      )}
      <div className="two">
        <div className="card">
          <h3>Domains</h3>
          <div className="form">
            <div className="field">
              <label>Top-level domain for sites</label>
              <input value={form.tld} onChange={(e) => setForm({ ...form, tld: e.target.value.toLowerCase() })} spellCheck={false} />
              <span className="hint">
                <code>.test</code> is reserved for exactly this (RFC 6761). Avoid <code>.dev</code> and <code>.app</code>: browsers force HTTPS on them.
              </span>
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Ports</h3>
          <div className="form">
            <div className="two">
              <div className="field">
                <label>HTTP</label>
                <input type="number" value={form.web.httpPort} onChange={(e) => setForm({ ...form, web: { ...form.web, httpPort: num(e.target.value) } })} />
              </div>
              <div className="field">
                <label>HTTPS</label>
                <input type="number" value={form.web.httpsPort} onChange={(e) => setForm({ ...form, web: { ...form.web, httpsPort: num(e.target.value) } })} />
              </div>
              <div className="field">
                <label>Database</label>
                <input type="number" value={form.db.port} onChange={(e) => setForm({ ...form, db: { ...form.db, port: num(e.target.value) } })} />
              </div>
              <div className="field">
                <label>Database engine</label>
                <select value={form.db.engine} onChange={(e) => setForm({ ...form, db: { ...form.db, engine: e.target.value as 'mariadb' | 'mysql' } })}>
                  <option value="mariadb">MariaDB (what XAMPP ships)</option>
                  <option value="mysql">Oracle MySQL (brew install mysql)</option>
                </select>
              </div>
              <div className="field">
                <label>SMTP (Mailpit)</label>
                <input type="number" value={form.mail.smtpPort} onChange={(e) => setForm({ ...form, mail: { ...form.mail, smtpPort: num(e.target.value) } })} />
              </div>
              <div className="field">
                <label>Mailpit web</label>
                <input type="number" value={form.mail.httpPort} onChange={(e) => setForm({ ...form, mail: { ...form.mail, httpPort: num(e.target.value) } })} />
              </div>
              <div className="field">
                <label>Control panel</label>
                <input type="number" value={form.panel.port} onChange={(e) => setForm({ ...form, panel: { port: num(e.target.value) } })} />
              </div>
            </div>
            <span className="hint">Ports below 1024 need administrator rights on most systems; zampp falls back to 8080/8443 automatically when they are denied.</span>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Autostart</h3>
        <p className="muted">Services started by <code>zampp start</code> and the Start all button.</p>
        <div className="inline">
          {['apache', 'php-fpm', 'mariadb', 'mailpit'].map((id) => (
            <label key={id} className="inline">
              <input
                type="checkbox"
                checked={form.autostart.includes(id)}
                onChange={(e) => setForm({ ...form, autostart: e.target.checked ? [...form.autostart, id] : form.autostart.filter((x) => x !== id) })}
              />
              {id}
            </label>
          ))}
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button className="btn" onClick={() => setForm(status.settings)} disabled={saving}>
          Reset
        </button>
      </div>
    </>
  )
}
