import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { AppContext } from '../context.ts'
import { exists } from '../provision.ts'
import { phpEtcDir, phpSocket } from '../php.ts'
import { mailpitBinary } from './mailpit.ts'
import type { ServiceDefinition, Resolved, Launch, NamedFile } from './types.ts'
import type { InstalledPhp } from '../state.ts'

export const PHP_FPM_PREFIX = 'php-fpm:'

export function phpFpmService(php: InstalledPhp): ServiceDefinition {
  const id = `${PHP_FPM_PREFIX}${php.version}`
  return {
    id,
    name: `PHP-FPM ${php.version}`,
    description: `PHP ${php.version} FastCGI process manager (${php.source})`,
    stopSignal: 'SIGQUIT',
    async resolve(): Promise<Resolved | null> {
      if (!(await exists(php.fpm))) return null
      return { command: php.fpm, version: php.version, source: php.source }
    },
    async install(): Promise<void> {
      // Versions are provisioned through src/core/php.ts; nothing to do per service.
    },
    async prepare(ctx: AppContext): Promise<Launch> {
      const etc = phpEtcDir(ctx, php.version)
      const sessions = join(ctx.paths.data, 'php-sessions', php.version)
      await Promise.all([mkdir(etc, { recursive: true }), mkdir(sessions, { recursive: true })])
      const confPath = join(etc, 'php-fpm.conf')
      const iniPath = join(etc, 'php.ini')
      const conf = await ctx.renderTemplate('php-fpm.conf.tpl', {
        version: php.version,
        run: ctx.paths.run,
        logs: ctx.paths.logs,
        socket: phpSocket(ctx, php.version),
      })
      const ini = await ctx.renderTemplate('php.ini.tpl', {
        version: php.version,
        timezone: process.env.TZ && process.env.TZ !== '' ? process.env.TZ : 'UTC',
        mailpit: mailpitBinary(ctx),
        smtpPort: ctx.state.settings.mail.smtpPort,
        sessionDir: sessions,
        extensionDir: '',
        extensions: [],
      })
      await Promise.all([writeFile(confPath, conf, 'utf8'), writeFile(iniPath, ini, 'utf8')])
      return { command: php.fpm, args: ['-F', '-y', confPath, '-c', iniPath] }
    },
    ports(): readonly number[] {
      return []
    },
    async health(ctx: AppContext): Promise<boolean> {
      return exists(phpSocket(ctx, php.version))
    },
    logs(ctx: AppContext): readonly NamedFile[] {
      return [
        { name: 'php-fpm', path: join(ctx.paths.logs, `php-fpm-${php.version}.log`) },
        { name: 'php errors', path: join(ctx.paths.logs, `php-${php.version}-error.log`) },
      ]
    },
    configs(ctx: AppContext): readonly NamedFile[] {
      return [
        { name: 'php.ini', path: join(phpEtcDir(ctx, php.version), 'php.ini') },
        { name: 'php-fpm.conf', path: join(phpEtcDir(ctx, php.version), 'php-fpm.conf') },
      ]
    },
  }
}
