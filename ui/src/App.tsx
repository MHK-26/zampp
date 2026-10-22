import { useState } from 'react'
import { ApiError, post, setToken } from './api.ts'
import { useHashRoute, useStatus } from './hooks.ts'
import { Alert } from './components.tsx'
import { Dashboard } from './pages/Dashboard.tsx'
import { Services } from './pages/Services.tsx'
import { Sites } from './pages/Sites.tsx'
import { Php } from './pages/Php.tsx'
import { Database } from './pages/Database.tsx'
import { Mail } from './pages/Mail.tsx'
import { Logs } from './pages/Logs.tsx'
import { Ports } from './pages/Ports.tsx'
import { Settings } from './pages/Settings.tsx'
import { Doctor } from './pages/Doctor.tsx'

const NAV: { id: string; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'services', label: 'Services', icon: '⚙' },
  { id: 'sites', label: 'Sites', icon: '◎' },
  { id: 'php', label: 'PHP', icon: '𝑃' },
  { id: 'database', label: 'Database', icon: '⛁' },
  { id: 'mail', label: 'Mail', icon: '✉' },
  { id: 'logs', label: 'Logs', icon: '≣' },
  { id: 'ports', label: 'Ports', icon: '⇄' },
  { id: 'doctor', label: 'Doctor', icon: '✚' },
  { id: 'settings', label: 'Settings', icon: '☰' },
]

export function App() {
  const { status, error, refresh } = useStatus()
  const [route, go] = useHashRoute()
  const [flash, setFlash] = useState<{ kind: 'error' | 'ok' | 'warn'; text: string } | null>(null)
  const [stackBusy, setStackBusy] = useState(false)

  if (error instanceof ApiError && error.status === 401) return <TokenGate onSaved={refresh} />

  const running = status?.services.filter((s) => s.running).length ?? 0
  const total = status?.services.length ?? 0
  const allUp = total > 0 && running === total

  const stack = async (action: 'start' | 'stop') => {
    setStackBusy(true)
    try {
      const result = await post<{ failed?: { id: string; error: string }[] }>(`/api/v1/stack/${action}`)
      if (action === 'start' && result?.failed && result.failed.length > 0) {
        setFlash({ kind: 'warn', text: result.failed.map((f) => `${f.id}: ${f.error}`).join(' · ') })
      } else {
        setFlash({ kind: 'ok', text: action === 'start' ? 'Stack started' : 'Stack stopped' })
      }
      await refresh()
    } catch (e) {
      setFlash({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setStackBusy(false)
    }
  }

  const page = (() => {
    const props = { status, refresh, notify: (kind: 'error' | 'ok' | 'warn', text: string) => setFlash({ kind, text }) }
    switch (route) {
      case 'services':
        return <Services {...props} />
      case 'sites':
        return <Sites {...props} />
      case 'php':
        return <Php {...props} />
      case 'database':
        return <Database {...props} />
      case 'mail':
        return <Mail {...props} />
      case 'logs':
        return <Logs {...props} />
      case 'ports':
        return <Ports {...props} />
      case 'doctor':
        return <Doctor {...props} />
      case 'settings':
        return <Settings {...props} />
      default:
        return <Dashboard {...props} go={go} />
    }
  })()

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">z</span> zampp <small>v{status?.version ?? '…'}</small>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <a key={item.id} href={`#/${item.id}`} className={route === item.id ? 'active' : ''}>
              <span aria-hidden>{item.icon}</span> {item.label}
              {item.id === 'services' && total > 0 && <span className={`dot ${allUp ? 'on' : running > 0 ? '' : 'off'}`} />}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <div className="foot">
          {status?.home && (
            <>
              <div className="mono" title={status.home}>
                {status.home.replace(/^\/Users\/[^/]+/, '~')}
              </div>
            </>
          )}
          {running}/{total} services running
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{NAV.find((n) => n.id === route)?.label ?? 'Dashboard'}</h1>
          <div className="actions">
            {status && (
              <>
                <a className="btn" href={status.urls.web} target="_blank" rel="noreferrer">
                  Open localhost ↗
                </a>
                <button className="btn primary" disabled={stackBusy || allUp} onClick={() => stack('start')}>
                  {stackBusy ? 'Working…' : 'Start all'}
                </button>
                <button className="btn" disabled={stackBusy || running === 0} onClick={() => stack('stop')}>
                  Stop all
                </button>
              </>
            )}
          </div>
        </div>
        {error && !(error instanceof ApiError && error.status === 401) && <Alert kind="error">Cannot reach the zampp API: {error.message}. Is `zampp ui` running?</Alert>}
        {flash && (
          <Alert kind={flash.kind} onClose={() => setFlash(null)}>
            {flash.text}
          </Alert>
        )}
        {page}
      </main>
    </div>
  )
}

function TokenGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="token-gate card">
      <h3>Connect to zampp</h3>
      <p className="muted">This panel talks to the local zampp API, which requires the access token from your machine.</p>
      <p>
        Easiest: run <code>zampp ui</code> in a terminal. It opens this page with the token attached. Or paste the <code>token</code> value from <code>~/.zampp/secrets.json</code>:
      </p>
      <div className="field">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="token" spellCheck={false} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn primary"
          disabled={value.trim().length < 32}
          onClick={() => {
            setToken(value.trim())
            onSaved()
          }}
        >
          Connect
        </button>
      </div>
    </div>
  )
}

export interface PageProps {
  status: import('./api.ts').Status | null
  refresh: () => Promise<void>
  notify: (kind: 'error' | 'ok' | 'warn', text: string) => void
}
