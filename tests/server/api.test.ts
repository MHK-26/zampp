import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppContext } from '../../src/core/context.ts'
import { startServer, type ServerHandle } from '../../src/server/index.ts'
import { upsertPhp } from '../../src/core/state.ts'

let ctx: AppContext
let handle: ServerHandle
let home: string

const api = (path: string, init: RequestInit = {}, token = ctx.secrets.token) =>
  fetch(`${handle.url.replace(/\/$/, '')}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

before(async () => {
  process.env.ZAMPP_SKIP_HOSTS = '1'
  home = await mkdtemp(join(tmpdir(), 'zampp-api-'))
  ctx = await AppContext.create({ env: { ZAMPP_HOME: home } })
  await ctx.update((s) => upsertPhp(s, { version: '8.5.0', source: 'custom', fpm: '/nonexistent/php-fpm' }))
  handle = await startServer(ctx, { port: 0, uiDir: join(home, 'no-ui') })
})

after(async () => {
  await handle.close()
})

test('health is public, everything else needs the token', async () => {
  const health = await fetch(`${handle.url}api/v1/health`)
  assert.equal(health.status, 200)
  const denied = await fetch(`${handle.url}api/v1/status`)
  assert.equal(denied.status, 401)
  const body = (await denied.json()) as { error: { code: string } }
  assert.equal(body.error.code, 'unauthorized')
  const wrong = await api('/api/v1/status', {}, 'x'.repeat(64))
  assert.equal(wrong.status, 401)
  const viaQuery = await fetch(`${handle.url}api/v1/status?token=${ctx.secrets.token}`)
  assert.equal(viaQuery.status, 200)
})

test('status lists services, settings and urls', async () => {
  const res = await api('/api/v1/status')
  assert.equal(res.status, 200)
  const { data } = (await res.json()) as { data: { services: { id: string }[]; settings: { tld: string }; urls: { mail: string } } }
  assert.deepEqual(data.services.map((s) => s.id), ['apache', 'php-fpm:8.5.0', 'mariadb', 'mailpit'])
  assert.equal(data.settings.tld, 'test')
  assert.ok(data.urls.mail.includes('8025'))
})

test('sites: create, read, validate, conflict, delete', async () => {
  const created = await api('/api/v1/sites', { method: 'POST', body: JSON.stringify({ name: 'shop', root: join(home, 'shop') }) })
  assert.equal(created.status, 201)
  const { data } = (await created.json()) as { data: { site: { host: string; url: string }; hosts: { error: string | null } } }
  assert.equal(data.site.host, 'shop.test')
  assert.equal(data.site.url, 'http://shop.test/')
  assert.ok(data.hosts.error?.includes('skipped'))

  const dup = await api('/api/v1/sites', { method: 'POST', body: JSON.stringify({ name: 'shop', root: join(home, 'shop') }) })
  assert.equal(dup.status, 409)

  const invalid = await api('/api/v1/sites', { method: 'POST', body: JSON.stringify({ name: 'Bad Name', root: '' }) })
  assert.equal(invalid.status, 422)
  const invalidBody = (await invalid.json()) as { error: { code: string; details: { field: string }[] } }
  assert.equal(invalidBody.error.code, 'validation_error')
  assert.ok(invalidBody.error.details.some((d) => d.field === 'name'))

  const badJson = await api('/api/v1/sites', { method: 'POST', body: '{nope' })
  assert.equal(badJson.status, 400)

  const list = await api('/api/v1/sites')
  const sites = ((await list.json()) as { data: { name: string }[] }).data
  assert.deepEqual(sites.map((s) => s.name), ['shop'])

  const patched = await api('/api/v1/sites/shop', { method: 'PATCH', body: JSON.stringify({ aliases: ['www.shop.test'] }) })
  assert.equal(patched.status, 200)

  const removed = await api('/api/v1/sites/shop', { method: 'DELETE' })
  assert.equal(removed.status, 204)
  const missing = await api('/api/v1/sites/shop')
  assert.equal(missing.status, 404)
})

test('settings patch reports which services need a restart', async () => {
  const res = await api('/api/v1/settings', { method: 'PATCH', body: JSON.stringify({ web: { engine: 'apache', httpPort: 8080, httpsPort: 8443 } }) })
  assert.equal(res.status, 200)
  const { data } = (await res.json()) as { data: { settings: { web: { httpPort: number } }; restartRequired: string[] } }
  assert.equal(data.settings.web.httpPort, 8080)
  assert.deepEqual(data.restartRequired, ['apache'])
  const bad = await api('/api/v1/settings', { method: 'PATCH', body: JSON.stringify({ tld: 'NOPE!' }) })
  assert.equal(bad.status, 422)
})

test('db credentials expose the generated password only to token holders', async () => {
  const res = await api('/api/v1/db/credentials')
  const { data } = (await res.json()) as { data: { user: string; password: string; port: number } }
  assert.equal(data.user, 'root')
  assert.equal(data.password, ctx.secrets.dbRootPassword)
  assert.equal(data.port, 3306)
})

test('file reads are confined to the zampp home', async () => {
  const outside = await api(`/api/v1/files?path=${encodeURIComponent('/etc/passwd')}`)
  assert.equal(outside.status, 403)
  const traversal = await api(`/api/v1/files?path=${encodeURIComponent(`${home}/../../etc/passwd`)}`)
  assert.equal(traversal.status, 403)
})

test('unknown routes and services return 404 with the error envelope', async () => {
  const res = await api('/api/v1/nothing')
  assert.equal(res.status, 404)
  const svc = await api('/api/v1/services/ghost')
  assert.equal(svc.status, 404)
})
