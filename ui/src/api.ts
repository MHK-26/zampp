export interface NamedFile {
  name: string
  path: string
}
export interface ServiceStatus {
  id: string
  name: string
  description: string
  installed: boolean
  version: string | null
  source: string | null
  running: boolean
  pid: number | null
  ports: number[]
  startedAt: string | null
  logs: NamedFile[]
  configs: NamedFile[]
}
export interface Site {
  name: string
  root: string
  php?: string
  tls: boolean
  aliases: string[]
  createdAt: string
  host: string
  url: string
  phpEffective: string | null
}
export interface Settings {
  tld: string
  web: { engine: 'apache'; httpPort: number; httpsPort: number }
  php: { default?: string }
  db: { engine: 'mariadb' | 'mysql'; port: number }
  mail: { smtpPort: number; httpPort: number }
  panel: { port: number }
  autostart: string[]
}
export interface Status {
  version: string
  home: string
  settings: Settings
  services: ServiceStatus[]
  sites: Site[]
  urls: { web: string; adminer: string; mail: string }
}
export interface InstalledPhp {
  version: string
  source: 'static-php' | 'homebrew' | 'custom'
  fpm: string
  cli?: string
}
export interface PhpVersions {
  installed: InstalledPhp[]
  default: string | null
  available: string[]
}
export interface Credentials {
  host: string
  port: number
  user: string
  password: string
  socket: string
  dsn: string
}
export interface Listener {
  command: string
  pid: number
  user: string
  address: string
  port: number
}
export interface Check {
  id: string
  title: string
  level: 'ok' | 'warn' | 'fail'
  detail: string
  fix?: string
}
export interface HostsSyncResult {
  changed: boolean
  written: boolean
  error: string | null
}

export class ApiError extends Error {
  code: string
  status: number
  details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const TOKEN_KEY = 'zampp.token'

function bootstrapToken(): string {
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get('token')
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl)
    } catch {
      /* private mode */
    }
    url.searchParams.delete('token')
    window.history.replaceState({}, '', url.toString())
    return fromUrl
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export let token = bootstrapToken()

export function setToken(value: string): void {
  token = value
  try {
    localStorage.setItem(TOKEN_KEY, value)
  } catch {
    /* ignore */
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string; details?: unknown } }
  if (!res.ok) {
    const err = body.error ?? { code: 'http_error', message: `HTTP ${res.status}` }
    throw new ApiError(res.status, err.code, err.message, err.details)
  }
  return body.data as T
}

export const post = <T,>(path: string, data?: unknown) => api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) })
export const patch = <T,>(path: string, data: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(data) })
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })

export function openLogSocket(file: string): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return new WebSocket(`${proto}://${window.location.host}/ws/logs?file=${encodeURIComponent(file)}&token=${encodeURIComponent(token)}`)
}
