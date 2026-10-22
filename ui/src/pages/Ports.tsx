import { useEffect, useState } from 'react'
import { api, type Listener } from '../api.ts'
import type { PageProps } from '../App.tsx'

export function Ports({ status, notify }: PageProps) {
  const [listeners, setListeners] = useState<Listener[] | null>(null)
  const load = () => api<Listener[]>('/api/v1/ports').then(setListeners).catch((e: Error) => notify('error', e.message))
  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(t)
  }, [])
  if (!listeners || !status) return <div className="empty">Loading…</div>
  const ownPorts = new Map<number, string>()
  for (const s of status.services) for (const p of s.ports) ownPorts.set(p, s.name)
  ownPorts.set(status.settings.panel.port, 'control panel')
  const sorted = [...listeners].sort((a, b) => a.port - b.port)
  return (
    <>
      <p className="muted">
        Every TCP port something on this machine is listening on (<code>lsof</code>). Rows in green belong to zampp. XAMPP users spend hours on "port 80 is in use"; here you can see who has it.
      </p>
      <table>
        <thead>
          <tr>
            <th>Port</th>
            <th>Address</th>
            <th>Process</th>
            <th>PID</th>
            <th>User</th>
            <th>zampp</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, i) => (
            <tr key={`${l.pid}-${l.address}-${l.port}-${i}`}>
              <td className="mono">{l.port}</td>
              <td className="mono">{l.address}</td>
              <td>{l.command}</td>
              <td className="mono">{l.pid}</td>
              <td>{l.user}</td>
              <td>{ownPorts.has(l.port) ? <span className="badge on">{ownPorts.get(l.port)}</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
