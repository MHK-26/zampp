import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppContext } from '../../src/core/context.ts'
import { addSite, removeSite, renderSiteConf, siteHost, siteUrl, hostEntries, writeSiteConfigs } from '../../src/core/sites.ts'
import { upsertPhp } from '../../src/core/state.ts'

async function freshContext() {
  const home = await mkdtemp(join(tmpdir(), 'zampp-home-'))
  const ctx = await AppContext.create({ env: { ZAMPP_HOME: home } })
  await ctx.update((s) => upsertPhp(s, { version: '8.5.8', source: 'static-php', fpm: '/fake/php-fpm', cli: '/fake/php' }))
  return { ctx, home }
}

test('addSite scaffolds the docroot, stores the site and writes an Apache vhost', async () => {
  const { ctx, home } = await freshContext()
  const root = join(home, 'projects', 'blog')
  const site = await addSite(ctx, { name: 'blog', root })
  assert.equal(site.name, 'blog')
  assert.equal(siteHost(site, 'test'), 'blog.test')
  assert.equal(siteUrl(ctx, site), 'http://blog.test/')
  assert.ok((await readFile(join(root, 'index.php'), 'utf8')).includes('zampp'))
  const conf = await readFile(join(ctx.paths.sitesEtc, 'blog.conf'), 'utf8')
  assert.ok(conf.includes('ServerName blog.test'))
  assert.ok(conf.includes(`DocumentRoot "${root}"`))
  assert.ok(conf.includes('php-8.5.8.sock'))
  assert.ok(!conf.includes('SSLEngine'))
  assert.deepEqual(hostEntries(ctx), [
    { ip: '127.0.0.1', hostnames: ['blog.test'] },
    { ip: '::1', hostnames: ['blog.test'] },
  ])
})

test('removeSite deletes the vhost file and the state entry', async () => {
  const { ctx, home } = await freshContext()
  await addSite(ctx, { name: 'a', root: join(home, 'a') })
  await addSite(ctx, { name: 'b', root: join(home, 'b'), aliases: ['alias.local'] })
  assert.deepEqual((await readdir(ctx.paths.sitesEtc)).sort(), ['a.conf', 'b.conf'])
  await removeSite(ctx, 'a')
  assert.deepEqual(await readdir(ctx.paths.sitesEtc), ['b.conf'])
  assert.equal(ctx.state.sites.length, 1)
  await assert.rejects(removeSite(ctx, 'nope'))
})

test('a site pinned to an unknown PHP version is rejected', async () => {
  const { ctx, home } = await freshContext()
  await assert.rejects(addSite(ctx, { name: 'x', root: join(home, 'x'), php: '7.4.33' }), /not installed/)
})

test('renderSiteConf uses non-default ports and aliases', async () => {
  const { ctx, home } = await freshContext()
  await ctx.update((s) => ({ ...s, settings: { ...s.settings, web: { ...s.settings.web, httpPort: 8080 } } }))
  const site = await addSite(ctx, { name: 'shop', root: join(home, 'shop'), aliases: ['www.shop.test'] })
  const conf = await renderSiteConf(ctx, site)
  assert.ok(conf.includes('<VirtualHost 127.0.0.1:8080>'))
  assert.ok(conf.includes('ServerAlias www.shop.test'))
  assert.equal(siteUrl(ctx, site), 'http://shop.test:8080/')
  await writeSiteConfigs(ctx)
})
