import type { PageProps } from '../App.tsx'

export function Mail({ status }: PageProps) {
  if (!status) return <div className="empty">Loading…</div>
  const mail = status.services.find((s) => s.id === 'mailpit')
  return (
    <>
      <div className="two">
        <div className="card">
          <h3>
            Mailpit {mail && <span className={`badge ${mail.running ? 'on' : 'off'}`}>{mail.running ? 'running' : 'stopped'}</span>}
          </h3>
          <p className="muted">
            Every PHP <code>mail()</code> call and anything sent to SMTP <code>127.0.0.1:{status.settings.mail.smtpPort}</code> is captured here. Nothing is delivered to the outside world.
          </p>
          <div className="row">
            <a className="btn primary" href={status.urls.mail} target="_blank" rel="noreferrer">
              Open inbox ↗
            </a>
          </div>
        </div>
        <div className="card">
          <h3>Configure your app</h3>
          <div className="field">
            <label>PHP mail() — already wired</label>
            <pre className="snippet">{`sendmail_path = "~/.zampp/bin/mailpit/mailpit sendmail -S 127.0.0.1:${status.settings.mail.smtpPort}"`}</pre>
          </div>
          <div className="field">
            <label>Laravel / Symfony / anything SMTP</label>
            <pre className="snippet">{`MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT=${status.settings.mail.smtpPort}
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null`}</pre>
          </div>
          <div className="field">
            <label>WordPress</label>
            <pre className="snippet">{`// wp-config.php or a tiny plugin
add_action('phpmailer_init', fn($m) => [$m->isSMTP(), $m->Host = '127.0.0.1', $m->Port = ${status.settings.mail.smtpPort}]);`}</pre>
          </div>
        </div>
      </div>
      {mail?.running && (
        <div className="section">
          <h2>Inbox</h2>
          <iframe title="Mailpit" src={status.urls.mail} style={{ width: '100%', height: '65vh', border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
        </div>
      )}
    </>
  )
}
