import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppContext } from '../context.ts'
import { brewPrefix, exists, which } from '../provision.ts'
import { tcpReachable } from '../supervisor.ts'
import type { ServiceDefinition, Resolved, Launch, NamedFile } from './types.ts'

const execFileAsync = promisify(execFile)

interface DbInstall {
  readonly server: string
  readonly client: string
  readonly installDb: string | null
  readonly flavour: 'mariadb' | 'mysql'
  readonly source: string
}

export async function findDatabase(): Promise<DbInstall | null> {
  const mariadb = await brewPrefix('mariadb')
  if (mariadb && (await exists(join(mariadb, 'bin', 'mariadbd')))) {
    return { server: join(mariadb, 'bin', 'mariadbd'), client: join(mariadb, 'bin', 'mariadb'), installDb: join(mariadb, 'bin', 'mariadb-install-db'), flavour: 'mariadb', source: 'homebrew' }
  }
  const mysql = await brewPrefix('mysql')
  if (mysql && (await exists(join(mysql, 'bin', 'mysqld')))) {
    return { server: join(mysql, 'bin', 'mysqld'), client: join(mysql, 'bin', 'mysql'), installDb: null, flavour: 'mysql', source: 'homebrew' }
  }
  const mariadbd = await which('mariadbd')
  if (mariadbd) return { server: mariadbd, client: (await which('mariadb')) ?? 'mariadb', installDb: await which('mariadb-install-db'), flavour: 'mariadb', source: 'system' }
  const mysqld = await which('mysqld')
  if (mysqld) return { server: mysqld, client: (await which('mysql')) ?? 'mysql', installDb: null, flavour: 'mysql', source: 'system' }
  return null
}

export function dbSocket(ctx: AppContext): string {
  return join(ctx.paths.run, 'mariadb.sock')
}

export function myCnfPath(ctx: AppContext): string {
  return join(ctx.paths.etc, 'my.cnf')
}

function dataDir(ctx: AppContext): string {
  return join(ctx.paths.data, 'mariadb')
}

export const mariadbService: ServiceDefinition = {
  id: 'mariadb',
  name: 'MariaDB',
  description: 'Database server on 127.0.0.1 with a generated root password',
  startTimeoutMs: 60_000,
  async resolve(): Promise<Resolved | null> {
    const found = await findDatabase()
    if (!found) return null
    let version: string | null = null
    try {
      const { stdout } = await execFileAsync(found.server, ['--version'])
      version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
    } catch {
      version = null
    }
    return { command: found.server, version, source: `${found.flavour} (${found.source})` }
  },
  async install(_ctx, progress): Promise<void> {
    const brew = await which('brew')
    if (!brew) throw new Error('No MariaDB/MySQL found and Homebrew is not available to install one')
    progress('Installing MariaDB with Homebrew (this can take several minutes)')
    await execFileAsync(brew, ['install', 'mariadb'], { maxBuffer: 64 * 1024 * 1024 })
  },
  async prepare(ctx: AppContext, resolved: Resolved): Promise<Launch> {
    const found = await findDatabase()
    if (!found) throw new Error('database server disappeared')
    const datadir = dataDir(ctx)
    const tmpdir = join(ctx.paths.data, 'mariadb-tmp')
    await Promise.all([mkdir(datadir, { recursive: true }), mkdir(tmpdir, { recursive: true })])
    const cnf = await ctx.renderTemplate('my.cnf.tpl', {
      port: ctx.state.settings.db.port,
      socket: dbSocket(ctx),
      run: ctx.paths.run,
      logs: ctx.paths.logs,
      datadir,
      tmpdir,
    })
    await writeFile(myCnfPath(ctx), cnf, 'utf8')
    const marker = join(datadir, '.zampp-initialized')
    if (!(await exists(marker))) {
      ctx.log('Initializing database data directory')
      if (found.flavour === 'mariadb' && found.installDb) {
        await execFileAsync(found.installDb, [`--defaults-file=${myCnfPath(ctx)}`, `--datadir=${datadir}`, '--auth-root-authentication-method=normal', '--skip-test-db'], { maxBuffer: 16 * 1024 * 1024 })
      } else {
        await execFileAsync(found.server, [`--defaults-file=${myCnfPath(ctx)}`, '--initialize-insecure', `--datadir=${datadir}`], { maxBuffer: 16 * 1024 * 1024 })
      }
      await writeFile(marker, new Date().toISOString(), 'utf8')
    }
    return { command: resolved.command, args: [`--defaults-file=${myCnfPath(ctx)}`] }
  },
  ports(ctx: AppContext): readonly number[] {
    return [ctx.state.settings.db.port]
  },
  async health(ctx: AppContext): Promise<boolean> {
    return (await exists(dbSocket(ctx))) && tcpReachable(ctx.state.settings.db.port)
  },
  async afterStart(ctx: AppContext): Promise<void> {
    const marker = join(dataDir(ctx), '.zampp-password-set')
    if (await exists(marker)) return
    const found = await findDatabase()
    if (!found) return
    const password = ctx.secrets.dbRootPassword
    const base = [`--defaults-file=${myCnfPath(ctx)}`, '-u', 'root', `--socket=${dbSocket(ctx)}`]
    const query = async (sql: string, withPassword: boolean) => {
      const env = withPassword ? { ...process.env, MYSQL_PWD: password } : { ...process.env }
      const { stdout } = await execFileAsync(found.client, [...base, '-N', '-B', '-e', sql], { env })
      return stdout
    }
    // Fresh installs have no password; a half-finished earlier run may already have one.
    let withPassword = false
    try {
      await query('SELECT 1', false)
    } catch {
      withPassword = true
    }
    // The password is base64url (A-Z a-z 0-9 _ -), so inlining it is safe.
    const redact = (text: string) => text.split(password).join('***')
    try {
      if (found.flavour === 'mariadb') {
        // One UPDATE covers every root@<host> row regardless of hostname casing.
        await query(
          [
            `UPDATE mysql.global_priv SET priv = JSON_SET(priv, '$.plugin', 'mysql_native_password', '$.authentication_string', PASSWORD('${password}')) WHERE user = 'root';`,
            "DELETE FROM mysql.global_priv WHERE user = '';",
            'FLUSH PRIVILEGES;',
          ].join(' '),
          withPassword,
        )
      } else {
        const hosts = (await query("SELECT host FROM mysql.user WHERE user = 'root'", withPassword)).split('\n').map((h) => h.trim()).filter((h) => h !== '')
        for (const h of hosts) await query(`ALTER USER 'root'@'${h.replace(/'/g, '')}' IDENTIFIED BY '${password}';`, withPassword)
        await query("DROP USER IF EXISTS ''@'localhost'; FLUSH PRIVILEGES;", withPassword)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not set the database root password: ${redact(message).split('\n').filter((l) => l.includes('ERROR')).join(' ') || 'unknown error'}`)
    }
    await writeFile(marker, new Date().toISOString(), 'utf8')
    ctx.log('Database root password set for every root account')
  },
  logs(ctx: AppContext): readonly NamedFile[] {
    return [{ name: 'error', path: join(ctx.paths.logs, 'mariadb-error.log') }]
  },
  configs(ctx: AppContext): readonly NamedFile[] {
    return [{ name: 'my.cnf', path: myCnfPath(ctx) }]
  },
}
