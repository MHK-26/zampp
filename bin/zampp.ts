#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { AppContext } from '../src/core/context.ts'
import { Supervisor } from '../src/core/supervisor.ts'
import { allServices } from '../src/core/services/index.ts'
import { startAll, stopAll, ensureProvisioned } from '../src/core/stack.ts'
import { addSite, removeSite, syncHosts, siteUrl, siteHost } from '../src/core/sites.ts'
import { installStaticPhp, detectHomebrewPhp, defaultPhp, listStaticPhpVersions } from '../src/core/php.ts'
import { runDoctor } from '../src/core/doctor.ts'
import { startServer } from '../src/server/index.ts'
import type { ServiceStatus } from '../src/core/services/types.ts'

const HELP = `zampp — the open-source, secure-by-default XAMPP

Usage: zampp <command> [options]

  start                 Provision what is missing and start the whole stack
  stop                  Stop every running service
  restart               Stop, then start
  status                Show services, ports and sites
  ui [--no-open]        Run the control panel API and open it in the browser
  serve                 Run the API only (foreground)
  doctor                Check the environment and explain how to fix problems

  site add <name> [path] [--php <version>] [--tls] [--alias host]...
  site rm <name>
  site list
  hosts sync            Write /etc/hosts entries for all sites (asks for password)

  php list              Installed and available PHP versions
  php install <version> Install a static PHP build (e.g. 8.4, 8.3.30, latest)
  php use <version>     Make a version the default
  php detect            Register Homebrew PHP installs

  db                    Print database credentials
  mail                  Open the Mailpit inbox
  open                  Open http://localhost/

Environment: ZAMPP_HOME (default ~/.zampp)
`

type Argv = { positional: string[]; flags: Record<string, string | boolean | string[]> }

function parseArgv(args: string[]): Argv {
  const positional: string[] = []
  const flags: Record<string, string | boolean | string[]> = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = args[i + 1]
    if (key.startsWith('no-')) {
      flags[key.slice(3)] = false
      continue
    }
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true
      continue
    }
    const existing = flags[key]
    if (Array.isArray(existing)) existing.push(next)
    else if (typeof existing === 'string') flags[key] = [existing, next]
    else flags[key] = next
    i += 1
  }
  return { positional, flags }
}

const color = {
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
}

function printStatuses(statuses: readonly ServiceStatus[]): void {
  for (const s of statuses) {
    const state = s.running ? color.green('● running') : s.installed ? color.dim('○ stopped') : color.yellow('○ not installed')
    const ports = s.ports.length > 0 ? ` :${s.ports.join(' :')}` : ''
    const pid = s.pid ? color.dim(`  pid ${s.pid}`) : ''
    console.log(`  ${state.padEnd(28)} ${s.name.padEnd(16)} ${(s.version ?? '').padEnd(10)}${ports}${pid}`)
  }
}

function openInBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  execFile(opener, [url], () => {})
}

async function main(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgv(argv)
  const [command, sub, ...rest] = positional
  if (!command || command === 'help' || flags.help) {
    console.log(HELP)
    return 0
  }
  const ctx = await AppContext.create({ log: (m) => console.log(color.dim(`  … ${m}`)) })
  const sup = new Supervisor(ctx, () => allServices(ctx))

  switch (command) {
    case 'start': {
      console.log(color.bold('Starting zampp'))
      const result = await startAll(ctx, sup, (m) => console.log(color.dim(`  … ${m}`)))
      console.log()
      printStatuses(await sup.statuses())
      for (const f of result.failed) console.log(`\n${color.red('✖')} ${f.id}: ${f.error}`)
      const port = ctx.state.settings.web.httpPort
      console.log(`\n  Web      http://localhost${port === 80 ? '' : `:${port}`}/`)
      console.log(`  Mail     http://127.0.0.1:${ctx.state.settings.mail.httpPort}/`)
      console.log(`  DB       127.0.0.1:${ctx.state.settings.db.port}  user root  ${color.dim('(zampp db for the password)')}`)
      console.log(`  Panel    ${color.dim('zampp ui')}`)
      return result.failed.length === 0 ? 0 : 1
    }
    case 'stop': {
      const stopped = await stopAll(sup)
      console.log(`Stopped ${stopped.length} service(s)`)
      return 0
    }
    case 'restart': {
      await stopAll(sup)
      const result = await startAll(ctx, sup)
      printStatuses(await sup.statuses())
      return result.failed.length === 0 ? 0 : 1
    }
    case 'status': {
      printStatuses(await sup.statuses())
      if (ctx.state.sites.length > 0) {
        console.log(`\n${color.bold('Sites')}`)
        for (const site of ctx.state.sites) console.log(`  ${siteUrl(ctx, site).padEnd(32)} ${site.root}  ${color.dim(`php ${site.php ?? defaultPhp(ctx)?.version ?? '-'}`)}`)
      }
      return 0
    }
    case 'serve':
    case 'ui': {
      const handle = await startServer(ctx)
      const url = `${handle.url}?token=${ctx.secrets.token}`
      console.log(`Control panel: ${url}`)
      if (command === 'ui' && flags.open !== false) openInBrowser(url)
      await new Promise<void>((resolve) => {
        process.once('SIGINT', () => resolve())
        process.once('SIGTERM', () => resolve())
      })
      await handle.close()
      return 0
    }
    case 'doctor': {
      const checks = await runDoctor(ctx, sup)
      let failures = 0
      for (const c of checks) {
        const icon = c.level === 'ok' ? color.green('✔') : c.level === 'warn' ? color.yellow('!') : color.red('✖')
        if (c.level === 'fail') failures += 1
        console.log(`  ${icon} ${c.title.padEnd(28)} ${c.detail}${c.fix ? color.dim(`   → ${c.fix}`) : ''}`)
      }
      return failures === 0 ? 0 : 1
    }
    case 'site': {
      if (sub === 'add') {
        const name = rest[0]
        if (!name) throw new Error('Usage: zampp site add <name> [path] [--php <version>] [--tls] [--alias host]')
        await ensureProvisioned(ctx, sup)
        const aliasFlag = flags.alias
        const aliases = Array.isArray(aliasFlag) ? aliasFlag : typeof aliasFlag === 'string' ? [aliasFlag] : []
        const site = await addSite(ctx, {
          name,
          root: rest[1] ?? `${ctx.paths.www}/../sites/${name}`,
          ...(typeof flags.php === 'string' ? { php: flags.php } : {}),
          tls: flags.tls === true,
          aliases,
        })
        const hosts = await syncHosts(ctx)
        if (hosts.error) console.log(color.yellow(`  ! hosts file not updated: ${hosts.error}`))
        const apache = await sup.status('apache')
        if (apache.running) await sup.restart('apache')
        else console.log(color.dim('  Apache is not running; start the stack with `zampp start`.'))
        console.log(`${color.green('✔')} ${siteHost(site, ctx.state.settings.tld)} → ${site.root}\n  ${siteUrl(ctx, site)}`)
        return 0
      }
      if (sub === 'rm' || sub === 'remove') {
        const name = rest[0]
        if (!name) throw new Error('Usage: zampp site rm <name>')
        await removeSite(ctx, name)
        await syncHosts(ctx)
        if ((await sup.status('apache')).running) await sup.restart('apache')
        console.log(`${color.green('✔')} removed ${name}`)
        return 0
      }
      if (sub === 'list' || sub === undefined) {
        for (const site of ctx.state.sites) console.log(`  ${siteUrl(ctx, site).padEnd(32)} ${site.root}`)
        if (ctx.state.sites.length === 0) console.log(color.dim('  no sites yet — zampp site add <name> [path]'))
        return 0
      }
      throw new Error(`Unknown site command "${sub}"`)
    }
    case 'hosts': {
      const result = await syncHosts(ctx)
      console.log(result.error ? color.red(result.error) : result.changed ? 'hosts file updated' : 'hosts file already in sync')
      return result.error ? 1 : 0
    }
    case 'php': {
      if (sub === 'install') {
        const version = rest[0] ?? 'latest'
        const installed = await installStaticPhp(ctx, version, (m) => console.log(color.dim(`  … ${m}`)))
        console.log(`${color.green('✔')} PHP ${installed.version} installed (${installed.fpm})`)
        return 0
      }
      if (sub === 'use') {
        const version = rest[0]
        if (!version || !ctx.state.php.some((p) => p.version === version)) throw new Error(`PHP ${version ?? ''} is not installed. Try: zampp php list`)
        await ctx.update((s) => ({ ...s, settings: { ...s.settings, php: { default: version } } }))
        if ((await sup.status('apache')).running) {
          await sup.start(`php-fpm:${version}`)
          await sup.restart('apache')
        }
        console.log(`${color.green('✔')} default PHP is now ${version}`)
        return 0
      }
      if (sub === 'detect') {
        const found = await detectHomebrewPhp(ctx)
        console.log(found.length === 0 ? 'No Homebrew PHP found' : found.map((p) => `  ${p.version}  ${p.fpm}`).join('\n'))
        return 0
      }
      const def = defaultPhp(ctx)?.version
      console.log(color.bold('Installed'))
      for (const p of ctx.state.php) console.log(`  ${p.version === def ? color.green('●') : ' '} ${p.version.padEnd(8)} ${p.source.padEnd(11)} ${color.dim(p.fpm)}`)
      try {
        const available = await listStaticPhpVersions()
        console.log(`\n${color.bold('Available')} ${color.dim('(static-php-cli)')}\n  ${available.slice(0, 12).join('  ')}`)
      } catch {
        console.log(color.dim('\n  (could not fetch the static-php-cli index)'))
      }
      return 0
    }
    case 'db': {
      console.log(`host      127.0.0.1\nport      ${ctx.state.settings.db.port}\nuser      root\npassword  ${ctx.secrets.dbRootPassword}\nsocket    ${ctx.paths.run}/mariadb.sock`)
      return 0
    }
    case 'mail':
      openInBrowser(`http://127.0.0.1:${ctx.state.settings.mail.httpPort}/`)
      return 0
    case 'open':
      openInBrowser(`http://localhost${ctx.state.settings.web.httpPort === 80 ? '' : `:${ctx.state.settings.web.httpPort}`}/`)
      return 0
    default:
      console.error(`Unknown command "${command}"\n`)
      console.log(HELP)
      return 2
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(color.red(`✖ ${error instanceof Error ? error.message : String(error)}`))
    process.exit(1)
  })
