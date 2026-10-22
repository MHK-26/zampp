import { join, resolve } from 'node:path'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import type { AppContext } from './context.ts'
import { exists } from './provision.ts'
import { siteSchema, upsertSite, removeSite as removeSiteFromState, type Site, type SiteInput } from './state.ts'
import { defaultPhp, phpSocket } from './php.ts'
import { applyManagedBlock, readHosts, writeHostsPrivileged, type HostEntry } from './hosts.ts'
import { ensureSiteCertificate, certificateFiles } from './tls.ts'
import { ServiceError } from './services/types.ts'

export function siteHost(site: Site, tld: string): string {
  return `${site.name}.${tld}`
}

export function siteUrl(ctx: AppContext, site: Site): string {
  const { httpPort, httpsPort } = ctx.state.settings.web
  const host = siteHost(site, ctx.state.settings.tld)
  if (site.tls) return httpsPort === 443 ? `https://${host}/` : `https://${host}:${httpsPort}/`
  return httpPort === 80 ? `http://${host}/` : `http://${host}:${httpPort}/`
}

export function sitePhpVersion(ctx: AppContext, site: Site): string | null {
  if (site.php && ctx.state.php.some((p) => p.version === site.php)) return site.php
  return defaultPhp(ctx)?.version ?? null
}

export async function renderSiteConf(ctx: AppContext, site: Site): Promise<string> {
  const version = sitePhpVersion(ctx, site)
  if (!version) throw new ServiceError('no_php', 'No PHP version is installed')
  const host = siteHost(site, ctx.state.settings.tld)
  const certs = certificateFiles(ctx, host)
  const tls = site.tls && (await exists(certs.cert)) && (await exists(certs.key))
  return ctx.renderTemplate('vhost.conf.tpl', {
    name: site.name,
    host,
    aliases: site.aliases.join(' '),
    root: site.root,
    phpSocket: phpSocket(ctx, version),
    httpPort: ctx.state.settings.web.httpPort,
    httpsPort: ctx.state.settings.web.httpsPort,
    logs: ctx.paths.logs,
    tls,
    certFile: certs.cert,
    keyFile: certs.key,
  })
}

export async function anySiteUsesTls(ctx: AppContext): Promise<boolean> {
  for (const site of ctx.state.sites) {
    if (!site.tls) continue
    const certs = certificateFiles(ctx, siteHost(site, ctx.state.settings.tld))
    if ((await exists(certs.cert)) && (await exists(certs.key))) return true
  }
  return false
}

/** Rewrites etc/sites/*.conf from state so Apache config always mirrors the model. */
export async function writeSiteConfigs(ctx: AppContext): Promise<void> {
  await mkdir(ctx.paths.sitesEtc, { recursive: true })
  const existing = (await readdir(ctx.paths.sitesEtc)).filter((f) => f.endsWith('.conf'))
  await Promise.all(existing.map((f) => rm(join(ctx.paths.sitesEtc, f), { force: true })))
  for (const site of ctx.state.sites) {
    await writeFile(join(ctx.paths.sitesEtc, `${site.name}.conf`), await renderSiteConf(ctx, site), 'utf8')
  }
}

export function hostEntries(ctx: AppContext): HostEntry[] {
  const names = ctx.state.sites.flatMap((s) => [siteHost(s, ctx.state.settings.tld), ...s.aliases])
  if (names.length === 0) return []
  return [
    { ip: '127.0.0.1', hostnames: names },
    { ip: '::1', hostnames: names },
  ]
}

export interface HostsSyncResult {
  readonly changed: boolean
  readonly written: boolean
  readonly error: string | null
}

/** Bring /etc/hosts in line with the sites list. Needs an admin prompt only when something changed. */
export async function syncHosts(ctx: AppContext): Promise<HostsSyncResult> {
  let current: string
  try {
    current = await readHosts()
  } catch (error: unknown) {
    return { changed: false, written: false, error: error instanceof Error ? error.message : String(error) }
  }
  const next = applyManagedBlock(current, hostEntries(ctx))
  if (next === current) return { changed: false, written: false, error: null }
  try {
    await writeHostsPrivileged(next)
    return { changed: true, written: true, error: null }
  } catch (error: unknown) {
    return { changed: true, written: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const STARTER_INDEX = `<?php
// Your new zampp site. Replace this file with your project.
echo '<h1>' . htmlspecialchars($_SERVER['HTTP_HOST'] ?? 'site') . ' works</h1>';
echo '<p>PHP ' . PHP_VERSION . ' &middot; document root ' . htmlspecialchars(__DIR__) . '</p>';
`

export async function addSite(ctx: AppContext, input: SiteInput): Promise<Site> {
  const site = siteSchema.parse({ ...input, root: resolve(input.root) })
  if (site.php && !ctx.state.php.some((p) => p.version === site.php)) {
    throw new ServiceError('unknown_php', `PHP ${site.php} is not installed`)
  }
  if (!(await exists(site.root))) {
    await mkdir(site.root, { recursive: true })
    await writeFile(join(site.root, 'index.php'), STARTER_INDEX, 'utf8')
  }
  if (site.tls) await ensureSiteCertificate(ctx, siteHost(site, ctx.state.settings.tld))
  await ctx.update((s) => upsertSite(s, site))
  await writeSiteConfigs(ctx)
  return site
}

export type SitePatch = { [K in keyof SiteInput]?: SiteInput[K] | undefined }

export async function updateSite(ctx: AppContext, name: string, patch: SitePatch): Promise<Site> {
  const current = ctx.state.sites.find((s) => s.name === name)
  if (!current) throw new ServiceError('not_found', `Site "${name}" does not exist`)
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<SiteInput>
  const merged: SiteInput = { ...current, ...defined, name }
  return addSite(ctx, merged)
}

export async function removeSite(ctx: AppContext, name: string): Promise<void> {
  if (!ctx.state.sites.some((s) => s.name === name)) throw new ServiceError('not_found', `Site "${name}" does not exist`)
  await ctx.update((s) => removeSiteFromState(s, name))
  await writeSiteConfigs(ctx)
}
