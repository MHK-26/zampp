import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultState, loadState, saveState, upsertSite, removeSite, siteSchema, compareVersions, upsertPhp } from '../../src/core/state.ts'
import { loadOrCreateSecrets } from '../../src/core/secrets.ts'
import { resolvePaths } from '../../src/core/paths.ts'

test('defaultState has secure, XAMPP-compatible defaults', () => {
  const s = defaultState()
  assert.equal(s.settings.tld, 'test')
  assert.equal(s.settings.web.httpPort, 80)
  assert.equal(s.settings.db.port, 3306)
  assert.equal(s.settings.mail.smtpPort, 1025)
  assert.deepEqual(s.sites, [])
})

test('loadState returns defaults for a missing file and round-trips a saved state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zampp-state-'))
  const file = join(dir, 'state.json')
  assert.deepEqual(await loadState(file), defaultState())
  const site = siteSchema.parse({ name: 'blog', root: '/tmp/blog' })
  const next = upsertSite(defaultState(), site)
  await saveState(file, next)
  const loaded = await loadState(file)
  assert.equal(loaded.sites.length, 1)
  assert.equal(loaded.sites[0]?.name, 'blog')
  assert.equal(loaded.sites[0]?.tls, false)
  assert.equal(removeSite(loaded, 'blog').sites.length, 0)
  assert.ok((await readFile(file, 'utf8')).endsWith('\n'))
})

test('site names are validated', () => {
  assert.throws(() => siteSchema.parse({ name: 'Bad_Name', root: '/x' }))
  assert.throws(() => siteSchema.parse({ name: '-lead', root: '/x' }))
  assert.ok(siteSchema.parse({ name: 'my-app2', root: '/x' }))
})

test('upsertSite replaces by name and sorts', () => {
  let s = upsertSite(defaultState(), siteSchema.parse({ name: 'zeta', root: '/z' }))
  s = upsertSite(s, siteSchema.parse({ name: 'alpha', root: '/a' }))
  s = upsertSite(s, siteSchema.parse({ name: 'zeta', root: '/z2' }))
  assert.deepEqual(s.sites.map((x) => x.name), ['alpha', 'zeta'])
  assert.equal(s.sites[1]?.root, '/z2')
})

test('php versions sort newest first', () => {
  assert.ok(compareVersions('8.5.8', '8.4.27') > 0)
  assert.ok(compareVersions('8.4', '8.4.0') === 0)
  let s = upsertPhp(defaultState(), { version: '8.3.36', source: 'homebrew', fpm: '/x' })
  s = upsertPhp(s, { version: '8.5.8', source: 'static-php', fpm: '/y' })
  assert.deepEqual(s.php.map((p) => p.version), ['8.5.8', '8.3.36'])
})

test('secrets are generated once with mode 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zampp-secrets-'))
  const file = join(dir, 'secrets.json')
  const a = await loadOrCreateSecrets(file)
  const b = await loadOrCreateSecrets(file)
  assert.equal(a.token, b.token)
  assert.ok(a.token.length >= 64)
  assert.ok(a.dbRootPassword.length >= 16)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
})

test('resolvePaths honours ZAMPP_HOME', () => {
  const p = resolvePaths({ ZAMPP_HOME: '/tmp/zh' })
  assert.equal(p.home, '/tmp/zh')
  assert.equal(p.stateFile, '/tmp/zh/state.json')
  assert.equal(p.sitesEtc, '/tmp/zh/etc/sites')
})
