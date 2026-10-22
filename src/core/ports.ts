import { createServer } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface Listener {
  readonly command: string
  readonly pid: number
  readonly user: string
  readonly address: string
  readonly port: number
}

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolvePromise(false))
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolvePromise(true))
    })
  })
}

/** First free port from the candidates, then scan upwards from the last one. */
export async function findFreePort(candidates: readonly number[], host = '127.0.0.1'): Promise<number> {
  for (const port of candidates) {
    if (await isPortFree(port, host)) return port
  }
  const last = candidates[candidates.length - 1] ?? 8000
  for (let port = last + 1; port < 65535; port += 1) {
    if (await isPortFree(port, host)) return port
  }
  throw new Error('No free TCP port found')
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN` output. Exported for tests. */
export function parseLsof(output: string): Listener[] {
  const listeners: Listener[] = []
  for (const line of output.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 9) continue
    const name = cols[cols.length - 2] === '(LISTEN)' ? cols[cols.length - 3] : cols[cols.length - 1]
    if (!name) continue
    const sep = name.lastIndexOf(':')
    if (sep === -1) continue
    const port = Number(name.slice(sep + 1))
    if (!Number.isInteger(port)) continue
    listeners.push({
      command: cols[0] ?? '',
      pid: Number(cols[1]),
      user: cols[2] ?? '',
      address: name.slice(0, sep),
      port,
    })
  }
  return listeners
}

export async function listListeners(): Promise<Listener[]> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { maxBuffer: 8 * 1024 * 1024 })
    return parseLsof(stdout)
  } catch (error: unknown) {
    // lsof exits 1 when nothing matches; anything else is a real failure.
    if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 1) return []
    throw error
  }
}

export async function whoListens(port: number): Promise<Listener[]> {
  return (await listListeners()).filter((l) => l.port === port)
}
