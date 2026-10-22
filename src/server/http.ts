import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ServiceError } from '../core/services/types.ts'

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export type Params = Record<string, string>
export type Handler = (req: IncomingMessage, res: ServerResponse, params: Params, url: URL) => Promise<unknown> | unknown

interface Route {
  readonly method: string
  readonly pattern: RegExp
  readonly keys: readonly string[]
  readonly handler: Handler
}

/** A deliberately small router: method + path params, JSON in, JSON out. */
export class Router {
  readonly #routes: Route[] = []

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = []
    const pattern = new RegExp(
      `^${path.replace(/\/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key)
        return '/([^/]+)'
      })}/?$`,
    )
    this.#routes.push({ method, pattern, keys, handler })
    return this
  }

  match(method: string, pathname: string): { handler: Handler; params: Params } | null {
    for (const route of this.#routes) {
      if (route.method !== method) continue
      const m = route.pattern.exec(pathname)
      if (!m) continue
      const params: Params = {}
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1] ?? '')
      })
      return { handler: route.handler, params }
    }
    return null
  }
}

export async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > 1024 * 1024) throw new HttpError(413, 'payload_too_large', 'Request body exceeds 1 MB')
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  let parsed: unknown = {}
  if (raw.trim() !== '') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON')
    }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new HttpError(422, 'validation_error', 'Request validation failed', result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message, code: i.code })))
  }
  return result.data
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } })
    return
  }
  if (error instanceof ServiceError) {
    const status = error.code === 'not_found' || error.code === 'unknown_service' ? 404 : error.code === 'port_in_use' ? 409 : 400
    sendJson(res, status, { error: { code: error.code, message: error.message } })
    return
  }
  if (error instanceof z.ZodError) {
    sendJson(res, 422, { error: { code: 'validation_error', message: 'Validation failed', details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) } })
    return
  }
  const message = error instanceof Error ? error.message : 'Unexpected error'
  sendJson(res, 500, { error: { code: 'internal_error', message } })
}
