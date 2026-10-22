import { join } from 'node:path'
import { readdir, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppContext } from '../context.ts'
import { brewPrefix, exists, which } from '../provision.ts'
import { tcpReachable } from '../supervisor.ts'
import { defaultPhp, phpSocket } from '../php.ts'
import { writeSiteConfigs, anySiteUsesTls } from '../sites.ts'
import { writeWelcomeSite } from '../www.ts'
import type { ServiceDefinition, Resolved, Launch, NamedFile } from './types.ts'

const execFileAsync = promisify(execFile)

/** Modules we load when present, in dependency order. */
const WANTED_MODULES = [
  'mpm_event',
  'authn_core',
  'authz_core',
  'authz_host',
  'access_compat',
  'mime',
  'log_config',
  'env',
  'headers',
  'setenvif',
  'unixd',
  'dir',
  'alias',
  'rewrite',
  'autoindex',
  'negotiation',
  'filter',
  'deflate',
  'proxy',
  'proxy_fcgi',
  'socache_shmcb',
  'ssl',
  'version',
]

interface HttpdInstall {
  readonly httpd: string
  readonly modulesDir: string
  readonly mimeTypes: string
  readonly source: string
}

export async function findHttpd(): Promise<HttpdInstall | null> {
  const brew = await brewPrefix('httpd')
  if (brew && (await exists(join(brew, 'bin', 'httpd')))) {
    const etc = join(brew, '..', '..', 'etc', 'httpd')
    return { httpd: join(brew, 'bin', 'httpd'), modulesDir: join(brew, 'lib', 'httpd', 'modules'), mimeTypes: join(etc, 'mime.types'), source: 'homebrew' }
  }
  if (await exists('/usr/sbin/httpd')) {
    return { httpd: '/usr/sbin/httpd', modulesDir: '/usr/libexec/apache2', mimeTypes: '/etc/apache2/mime.types', source: 'macOS system' }
  }
  const onPath = (await which('httpd')) ?? (await which('apache2'))
  if (onPath) return { httpd: onPath, modulesDir: '/usr/lib/apache2/modules', mimeTypes: '/etc/mime.types', source: 'system' }
  return null
}

let cachedInstall: HttpdInstall | null | undefined

async function install(): Promise<HttpdInstall | null> {
  if (cachedInstall === undefined) cachedInstall = await findHttpd()
  return cachedInstall
}

export function httpdConfPath(ctx: AppContext): string {
  return join(ctx.paths.etc, 'httpd.conf')
}

export const apacheService: ServiceDefinition = {
  id: 'apache',
  name: 'Apache',
  description: 'Web server (httpd) serving localhost and every site',
  startTimeoutMs: 20_000,
  async resolve(): Promise<Resolved | null> {
    const found = await install()
    if (!found) return null
    let version: string | null = null
    try {
      const { stdout } = await execFileAsync(found.httpd, ['-v'])
      version = /Apache\/(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
    } catch {
      version = null
    }
    return { command: found.httpd, version, source: found.source }
  },
  async install(_ctx, progress): Promise<void> {
    const brew = await which('brew')
    if (!brew) throw new Error('Apache httpd not found and Homebrew is not available to install it')
    progress('Installing httpd with Homebrew (this can take a few minutes)')
    await execFileAsync(brew, ['install', 'httpd'], { maxBuffer: 64 * 1024 * 1024 })
    cachedInstall = undefined
  },
  async prepare(ctx: AppContext, resolved: Resolved): Promise<Launch> {
    const found = await install()
    if (!found) throw new Error('httpd disappeared')
    const present = new Set((await readdir(found.modulesDir)).map((f) => f.replace(/^mod_/, '').replace(/\.so$/, '')))
    const modules = WANTED_MODULES.filter((m) => present.has(m)).map((m) => ({ name: `${m}_module`, path: join(found.modulesDir, `mod_${m}.so`) }))
    const php = defaultPhp(ctx)
    const tls = modules.some((m) => m.name === 'ssl_module') && (await anySiteUsesTls(ctx))
    await mkdir(ctx.paths.sitesEtc, { recursive: true })
    await writeWelcomeSite(ctx)
    await writeSiteConfigs(ctx)
    const conf = await ctx.renderTemplate('httpd.conf.tpl', {
      serverRoot: ctx.paths.home,
      run: ctx.paths.run,
      logs: ctx.paths.logs,
      www: ctx.paths.www,
      sitesEtc: ctx.paths.sitesEtc,
      mimeTypes: found.mimeTypes,
      httpPort: ctx.state.settings.web.httpPort,
      httpsPort: ctx.state.settings.web.httpsPort,
      tls,
      modules,
      phpSocket: php ? phpSocket(ctx, php.version) : '',
    })
    await writeFile(httpdConfPath(ctx), conf, 'utf8')
    return { command: resolved.command, args: ['-f', httpdConfPath(ctx), '-D', 'FOREGROUND'] }
  },
  ports(ctx: AppContext): readonly number[] {
    const { httpPort } = ctx.state.settings.web
    return [httpPort]
  },
  async health(ctx: AppContext): Promise<boolean> {
    return tcpReachable(ctx.state.settings.web.httpPort)
  },
  logs(ctx: AppContext): readonly NamedFile[] {
    return [
      { name: 'error', path: join(ctx.paths.logs, 'apache-error.log') },
      { name: 'access', path: join(ctx.paths.logs, 'apache-access.log') },
    ]
  },
  configs(ctx: AppContext): readonly NamedFile[] {
    return [{ name: 'httpd.conf', path: httpdConfPath(ctx) }]
  },
}

/** Graceful reload after site changes; falls back to nothing when Apache is not running. */
export async function reloadApache(pid: number | null): Promise<void> {
  if (pid === null) return
  try {
    process.kill(pid, 'SIGUSR1')
  } catch {
    /* not running */
  }
}
