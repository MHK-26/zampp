import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type Status } from './api.ts'

export function useStatus(intervalMs = 3000) {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const timer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<Status>('/api/v1/status'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    }
  }, [])

  useEffect(() => {
    void refresh()
    timer.current = window.setInterval(() => void refresh(), intervalMs)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [refresh, intervalMs])

  return { status, error, refresh }
}

export function useHashRoute(defaultRoute = 'dashboard'): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || defaultRoute
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return [route, (r: string) => (window.location.hash = `#/${r}`)]
}

export function useBusy() {
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const run = useCallback(async (key: string, fn: () => Promise<unknown>, onError: (e: Error) => void) => {
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      await fn()
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setBusy((b) => ({ ...b, [key]: false }))
    }
  }, [])
  return { busy, run }
}

export function formatUptime(startedAt: string | null): string {
  if (!startedAt) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}
