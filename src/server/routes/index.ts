import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import type { AppContext } from '../../core/context.ts'
import type { Supervisor } from '../../core/supervisor.ts'
import { HttpError, readJson, type Router } from '../http.ts'
import { startAll, stopAll, ensureWebPorts, afterSiteChange } from '../../core/stack.ts'
import { addSite, updateSite, removeSite, syncHosts, siteUrl, siteHost } from '../../core/sites.ts'
import { siteSchema, settingsSchema } from '../../core/state.ts'
import { detectHomebrewPhp, installStaticPhp, listStaticPhpVersions, defaultPhp } from '../../core/php.ts'
import { listListeners } from '../../core/ports.ts'
import { runDoctor } from '../../core/doctor.ts'
import { PHP_FPM_PREFIX } from '../../core/services/index.ts'
import { ensureSiteCertificate } from '../../core/tls.ts'
import { PROJECT_ROOT } from '../../core/context.ts'

const VERSION: string = JSON.parse(await readFile(`${PROJECT_ROOT}/package.json`, 'utf8')).version

function siteView(ctx: AppContext) {
  return (site: (typeof ctx.state.sites)[number]) => ({ ...site, host: siteHost(site, ctx.state.settings.tld), url: siteUrl(ctx, site), phpEffective: site.php ?? defaultPhp(ctx)?.version ?? null })
}

export function registerRoutes(router: Router, ctx: AppContext, sup: Supervisor): void {
  router.add('GET', '/api/v1/status', async () => ({
    version: VERSION,
    home: ctx.paths.home,
    settings: ctx.state.settings,
    services: await sup.statuses(),
    sites: ctx.state.sites.map(siteView(ctx)),
    urls: {
      web: `http://localhost${ctx.state.settings.web.httpPort === 80 ? '' : `:${ctx.state.settings.web.httpPort}`}/`,
      adminer: `http://localhost${ctx.state.settings.web.httpPort === 80 ? '' : `:${ctx.state.settings.web.httpPort}`}/adminer/`,
      phpmyadmin: `http://localhost${ctx.state.settings.web.httpPort === 80 ? '' : `:${ctx.state.settings.web.httpPort}`}/phpmyadmin/`,
      mail: `http://127.0.0.1:${ctx.state.settings.mail.httpPort}/`,
    },
  }))

  router.add('GET', '/api/v1/services', () => sup.statuses())
  router.add('GET', '/api/v1/services/:id', (_req, _res, p) => sup.status(p.id ?? ''))
  router.add('POST', '/api/v1/services/:id/start', async (_req, _res, p) => {
    if (p.id === 'apache') await ensureWebPorts(ctx, sup, (m) => ctx.log(m))
    return sup.start(p.id ?? '')
  })
  router.add('POST', '/api/v1/services/:id/stop', (_req, _res, p) => sup.stop(p.id ?? ''))
  router.add('POST', '/api/v1/services/:id/restart', (_req, _res, p) => sup.restart(p.id ?? ''))
  router.add('POST', '/api/v1/services/:id/install', async (_req, _res, p) => {
    await sup.install(p.id ?? '')
    return sup.status(p.id ?? '')
  })
  router.add('POST', '/api/v1/stack/start', () => startAll(ctx, sup, (m) => ctx.log(m)))
  router.add('POST', '/api/v1/stack/stop', () => stopAll(sup))

  router.add('GET', '/api/v1/sites', () => ctx.state.sites.map(siteView(ctx)))
  router.add('POST', '/api/v1/sites', async (req, res) => {
    const input = await readJson(req, siteSchema.partial({ tls: true, aliases: true, createdAt: true }))
    if (ctx.state.sites.some((s) => s.name === input.name)) throw new HttpError(409, 'conflict', `Site "${input.name}" already exists`)
    const site = await addSite(ctx, input)
    const hosts = await afterSiteChange(ctx, sup)
    res.statusCode = 201
    return { site: siteView(ctx)(site), hosts }
  })
  router.add('GET', '/api/v1/sites/:name', (_req, _res, p) => {
    const site = ctx.state.sites.find((s) => s.name === p.name)
    if (!site) throw new HttpError(404, 'not_found', `Site "${p.name}" does not exist`)
    return siteView(ctx)(site)
  })
  router.add('PATCH', '/api/v1/sites/:name', async (req, _res, p) => {
    const patch = await readJson(req, siteSchema.omit({ name: true, createdAt: true }).partial())
    const site = await updateSite(ctx, p.name ?? '', patch)
    const hosts = await afterSiteChange(ctx, sup)
    return { site: siteView(ctx)(site), hosts }
  })
  router.add('DELETE', '/api/v1/sites/:name', async (_req, _res, p) => {
    await removeSite(ctx, p.name ?? '')
    await afterSiteChange(ctx, sup)
    return undefined
  })
  router.add('POST', '/api/v1/sites/:name/secure', async (_req, _res, p) => {
    const site = ctx.state.sites.find((s) => s.name === p.name)
    if (!site) throw new HttpError(404, 'not_found', `Site "${p.name}" does not exist`)
    await ensureSiteCertificate(ctx, siteHost(site, ctx.state.settings.tld), (m) => ctx.log(m))
    const updated = await updateSite(ctx, site.name, { tls: true })
    const hosts = await afterSiteChange(ctx, sup)
    return { site: siteView(ctx)(updated), hosts }
  })
  router.add('POST', '/api/v1/hosts/sync', () => syncHosts(ctx))

  router.add('GET', '/api/v1/php/versions', async () => {
    let available: string[] = []
    try {
      available = await listStaticPhpVersions()
    } catch {
      available = []
    }
    return { installed: ctx.state.php, default: defaultPhp(ctx)?.version ?? null, available }
  })
  router.add('POST', '/api/v1/php/versions', async (req, res) => {
    const { version } = await readJson(req, z.object({ version: z.string().min(1) }))
    const installed = await installStaticPhp(ctx, version, (m) => ctx.log(m))
    res.statusCode = 201
    return installed
  })
  router.add('POST', '/api/v1/php/detect', () => detectHomebrewPhp(ctx))
  router.add('PATCH', '/api/v1/php/default', async (req) => {
    const { version } = await readJson(req, z.object({ version: z.string().min(1) }))
    if (!ctx.state.php.some((p) => p.version === version)) throw new HttpError(404, 'not_found', `PHP ${version} is not installed`)
    await ctx.update((s) => ({ ...s, settings: { ...s.settings, php: { default: version } } }))
    const id = `${PHP_FPM_PREFIX}${version}`
    if (!(await sup.status(id)).running) await sup.start(id)
    if ((await sup.status('apache')).running) await sup.restart('apache')
    return { default: version }
  })

  router.add('GET', '/api/v1/db/credentials', () => ({
    host: '127.0.0.1',
    port: ctx.state.settings.db.port,
    user: 'root',
    password: ctx.secrets.dbRootPassword,
    socket: `${ctx.paths.run}/mariadb.sock`,
    dsn: `mysql://root:${encodeURIComponent(ctx.secrets.dbRootPassword)}@127.0.0.1:${ctx.state.settings.db.port}/`,
  }))

  router.add('GET', '/api/v1/ports', () => listListeners())

  router.add('GET', '/api/v1/logs', async () => {
    const statuses = await sup.statuses()
    return statuses.flatMap((s) => s.logs.map((l) => ({ service: s.id, name: l.name, path: l.path })))
  })

  router.add('GET', '/api/v1/configs', async () => {
    const statuses = await sup.statuses()
    return statuses.flatMap((s) => s.configs.map((c) => ({ service: s.id, name: c.name, path: c.path })))
  })
  router.add('GET', '/api/v1/files', async (_req, _res, _p, url) => {
    const path = url.searchParams.get('path') ?? ''
    if (!path.startsWith(`${ctx.paths.home}/`) || path.includes('/../')) throw new HttpError(403, 'forbidden', 'Only files inside the zampp home can be read')
    return { path, content: await readFile(path, 'utf8') }
  })
  router.add('PUT', '/api/v1/files', async (req) => {
    const { path, content } = await readJson(req, z.object({ path: z.string(), content: z.string().max(2 * 1024 * 1024) }))
    if (!path.startsWith(`${ctx.paths.etc}/`) || path.includes('/../')) throw new HttpError(403, 'forbidden', 'Only files inside etc/ can be edited')
    await writeFile(path, content, 'utf8')
    return { path }
  })

  router.add('GET', '/api/v1/doctor', () => runDoctor(ctx, sup))

  router.add('GET', '/api/v1/settings', () => ctx.state.settings)
  router.add('PATCH', '/api/v1/settings', async (req) => {
    const patch = await readJson(req, settingsSchema.partial())
    const before = ctx.state.settings
    const after = await ctx.update((s) => ({ ...s, settings: settingsSchema.parse({ ...s.settings, ...patch }) }))
    const restart: string[] = []
    if (JSON.stringify(before.web) !== JSON.stringify(after.settings.web) || before.tld !== after.settings.tld) restart.push('apache')
    if (before.db.port !== after.settings.db.port || before.db.engine !== after.settings.db.engine) restart.push('mariadb')
    if (JSON.stringify(before.mail) !== JSON.stringify(after.settings.mail)) restart.push('mailpit', 'php-fpm')
    return { settings: after.settings, restartRequired: restart }
  })
}
