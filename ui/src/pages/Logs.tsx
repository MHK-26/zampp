import { useEffect, useRef, useState } from 'react'
import { api, openLogSocket } from '../api.ts'
import type { PageProps } from '../App.tsx'

interface LogEntry {
  service: string
  name: string
  path: string
}

export function Logs({ notify }: PageProps) {
  const [files, setFiles] = useState<LogEntry[]>([])
  const [selected, setSelected] = useState<string>('')
  const [lines, setLines] = useState<string[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<LogEntry[]>('/api/v1/logs')
      .then((list) => {
        setFiles(list)
        const first = list.find((f) => f.service === 'apache' && f.name === 'error') ?? list[0]
        if (first && !selected) setSelected(first.path)
      })
      .catch((e: Error) => notify('error', e.message))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLines([])
    const ws = openLogSocket(selected)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: string; lines?: string[]; text?: string; message?: string }
      if (msg.type === 'init') setLines(msg.lines ?? [])
      if (msg.type === 'append' && !paused) setLines((l) => [...l, ...(msg.text ?? '').split('\n')].slice(-2000))
      if (msg.type === 'error') notify('error', msg.message ?? 'log error')
    }
    ws.onerror = () => notify('error', 'Log stream disconnected')
    return () => ws.close()
  }, [selected, paused])

  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, paused])

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines
  return (
    <>
      <div className="toolbar">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.service} · {f.name}
            </option>
          ))}
        </select>
        <input placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--fg)' }} />
        <button className="btn" onClick={() => setPaused(!paused)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn" onClick={() => setLines([])}>
          Clear
        </button>
        <span className="muted mono" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {selected}
        </span>
      </div>
      <div className="logbox" ref={box}>
        {shown.length === 0 ? <span className="muted">(empty)</span> : shown.join('\n')}
      </div>
    </>
  )
}
