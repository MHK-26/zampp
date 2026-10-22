import { stat } from 'node:fs/promises'
import type { AppContext } from './context.ts'
import type { Supervisor } from './supervisor.ts'
import { whoListens } from './ports.ts'
import { readHosts, applyManagedBlock } from './hosts.ts'
import { hostEntries } from './sites.ts'
import { mkcertBinary } from './tls.ts'
import { exists, which } from './provision.ts'

export type CheckLevel = 'ok' | 'warn' | 'fail'

export interface Check {
  readonly id: string
  readonly title: string
  readonly level: CheckLevel
  readonly detail: string
  readonly fix?: string
}

export async function runDoctor(ctx: AppContext, sup: Supervisor): Promise<Check[]> {
  const checks: Check[] = []
  const major = Number(process.versions.node.split('.')[0])
  checks.push({
    id: 'node',
    title: 'Node.js',
    level: major >= 24 ? 'ok' : 'fail',
    detail: `v${process.versions.node}`,
    ...(major >= 24 ? {} : { fix: 'Install Node.js 24 or newer' }),
  })

  for (const status of await sup.statuses()) {
    checks.push({
      id: `service:${status.id}`,
      title: status.name,
      level: status.installed ? 'ok' : 'warn',
      detail: status.installed ? `${status.version ?? 'unknown version'} (${status.source}) — ${status.running ? `running, pid ${status.pid}` : 'stopped'}` : 'not installed',
      ...(status.installed ? {} : { fix: `zampp start (installs ${status.name} automatically)` }),
    })
  }

  const s = ctx.state.settings
  const wanted: [string, number][] = [
    ['apache', s.web.httpPort],
    ['mariadb', s.db.port],
    ['mailpit smtp', s.mail.smtpPort],
    ['mailpit web', s.mail.httpPort],
    ['control panel', s.panel.port],
  ]
  const statuses = await sup.statuses()
  const ownPids = new Set(statuses.map((x) => x.pid).filter((p): p is number => p !== null))
  const runningPorts = new Set(statuses.filter((x) => x.running).flatMap((x) => [...x.ports]))
  for (const [name, port] of wanted) {
    const owners = await whoListens(port)
    // A running zampp service owns its port (Apache workers are children of the pid we know).
    const foreign = runningPorts.has(port) ? [] : owners.filter((o) => !ownPids.has(o.pid) && o.pid !== process.pid)
    if (foreign.length === 0) {
      checks.push({ id: `port:${port}`, title: `Port ${port} (${name})`, level: 'ok', detail: owners.length > 0 ? 'in use by zampp' : 'free' })
    } else {
      const who = foreign.map((o) => `${o.command} pid ${o.pid}`).join(', ')
      checks.push({ id: `port:${port}`, title: `Port ${port} (${name})`, level: 'fail', detail: `in use by ${who}`, fix: `Stop that process or change the port in Settings` })
    }
  }

  try {
    const hosts = await readHosts()
    const synced = applyManagedBlock(hosts, hostEntries(ctx)) === hosts
    checks.push({
      id: 'hosts',
      title: '/etc/hosts',
      level: synced ? 'ok' : 'warn',
      detail: synced ? `${ctx.state.sites.length} site(s) resolvable` : 'managed block is out of date',
      ...(synced ? {} : { fix: 'zampp hosts sync (asks for your password)' }),
    })
  } catch (error: unknown) {
    checks.push({ id: 'hosts', title: '/etc/hosts', level: 'warn', detail: error instanceof Error ? error.message : String(error) })
  }

  const mkcert = (await exists(mkcertBinary(ctx))) || (await which('mkcert')) !== null
  checks.push({ id: 'mkcert', title: 'mkcert (HTTPS)', level: mkcert ? 'ok' : 'warn', detail: mkcert ? 'available' : 'downloaded on first HTTPS site', fix: mkcert ? undefined : 'zampp site add <name> --tls' } as Check)

  try {
    const mode = (await stat(ctx.paths.secretsFile)).mode & 0o777
    checks.push({ id: 'secrets', title: 'secrets.json permissions', level: mode === 0o600 ? 'ok' : 'fail', detail: `0${mode.toString(8)}`, ...(mode === 0o600 ? {} : { fix: `chmod 600 ${ctx.paths.secretsFile}` }) })
  } catch {
    checks.push({ id: 'secrets', title: 'secrets.json', level: 'warn', detail: 'missing (created on first run)' })
  }

  const brew = await which('brew')
  checks.push({ id: 'brew', title: 'Homebrew', level: brew ? 'ok' : 'warn', detail: brew ?? 'not found (needed only to install MySQL/MariaDB)' })
  return checks
}
