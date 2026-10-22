import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { AppContext, PROJECT_ROOT } from '../core/context.ts'
import { Supervisor } from '../core/supervisor.ts'
import { allServices } from '../core/services/index.ts'
import { HttpError, Router, sendError, sendJson } from './http.ts'
import { registerRoutes } from './routes/index.ts'
import { tailFile } from './logs.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

export interface ServerHandle {
  readonly port: number
  readonly url: string
  close(): Promise<void>
}

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function presentedToken(req: IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  return url.searchParams.get('token')
}

export async function startServer(ctx: AppContext, options: { port?: number; uiDir?: string } = {}): Promise<ServerHandle> {
  const sup = new Supervisor(ctx, () => allServices(ctx))
  const router = new Router()
  registerRoutes(router, ctx, sup)
  const uiDir = options.uiDir ?? join(PROJECT_ROOT, 'ui', 'dist')
  const port = options.port ?? ctx.state.settings.panel.port

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/v1/health') return sendJson(res, 200, { data: { ok: true } })
        if (!tokenMatches(presentedToken(req, url), ctx.secrets.token)) {
          throw new HttpError(401, 'unauthorized', 'Missing or invalid token. Run `zampp ui` to open the panel with a valid token.')
        }
        const matched = router.match(req.method ?? 'GET', url.pathname)
        if (!matched) throw new HttpError(404, 'not_found', `No route for ${req.method} ${url.pathname}`)
        const result = await matched.handler(req, res, matched.params, url)
        if (!res.headersSent) sendJson(res, result === undefined ? 204 : 200, result === undefined ? '' : { data: result })
        return
      }
      await serveStatic(uiDir, url.pathname, res)
    } catch (error: unknown) {
      if (!res.headersSent) sendError(res, error)
      else res.end()
    }
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/ws/logs' || !tokenMatches(presentedToken(req, url), ctx.secrets.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const file = url.searchParams.get('file')
    if (!file || !isAllowedLogFile(ctx, file)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void tailFile(ws, file)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close()
        server.close(() => resolve())
      }),
  }
}

/** Only files inside the zampp logs directory may be tailed. */
export function isAllowedLogFile(ctx: AppContext, file: string): boolean {
  const resolved = normalize(file)
  return resolved.startsWith(`${ctx.paths.logs}/`) && !resolved.includes('/../')
}

async function serveStatic(uiDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(uiDir, safe)
  if (!file.startsWith(uiDir)) throw new HttpError(403, 'forbidden', 'Forbidden')
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
    await stat(file)
  } catch {
    file = join(uiDir, 'index.html')
    try {
      await stat(file)
    } catch {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>zampp</title><body style="font-family:system-ui;padding:2rem"><h1>zampp API is running</h1><p>The control panel has not been built. Run <code>npm run build:ui</code> in the zampp folder, or use the CLI.</p>')
      return
    }
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable' })
  createReadStream(file).pipe(res)
}
