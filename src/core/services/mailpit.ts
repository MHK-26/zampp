import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppContext } from '../context.ts'
import { download, exists, extractTar, hostPlatform, latestGithubAsset, makeExecutable } from '../provision.ts'
import { tcpReachable } from '../supervisor.ts'
import type { ServiceDefinition, Resolved, Launch, NamedFile } from './types.ts'

const execFileAsync = promisify(execFile)

export function mailpitBinary(ctx: AppContext): string {
  return join(ctx.paths.bin, 'mailpit', 'mailpit')
}

export const mailpitService: ServiceDefinition = {
  id: 'mailpit',
  name: 'Mailpit',
  description: 'Catches every email PHP sends; web inbox + SMTP',
  async resolve(ctx: AppContext): Promise<Resolved | null> {
    const bin = mailpitBinary(ctx)
    if (!(await exists(bin))) return null
    let version: string | null = null
    try {
      const { stdout } = await execFileAsync(bin, ['version'])
      version = /v?(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
    } catch {
      version = null
    }
    return { command: bin, version, source: 'github release' }
  },
  async install(ctx: AppContext, progress): Promise<void> {
    const { platform, arch } = hostPlatform()
    const os = platform === 'macos' ? 'darwin' : 'linux'
    const cpu = arch === 'aarch64' ? 'arm64' : 'amd64'
    const asset = await latestGithubAsset('axllent/mailpit', (n) => n === `mailpit-${os}-${cpu}.tar.gz`)
    const archive = join(ctx.paths.cache, asset.name)
    if (!(await exists(archive))) await download(asset.url, archive, progress)
    const dir = join(ctx.paths.bin, 'mailpit')
    await mkdir(dir, { recursive: true })
    progress(`Extracting ${asset.name}`)
    await extractTar(archive, dir)
    await makeExecutable(mailpitBinary(ctx))
    progress(`Mailpit ${asset.tag} ready`)
  },
  async prepare(ctx: AppContext, resolved: Resolved): Promise<Launch> {
    const dataDir = join(ctx.paths.data, 'mailpit')
    await mkdir(dataDir, { recursive: true })
    const { smtpPort, httpPort } = ctx.state.settings.mail
    return {
      command: resolved.command,
      args: ['--listen', `127.0.0.1:${httpPort}`, '--smtp', `127.0.0.1:${smtpPort}`, '--database', join(dataDir, 'mailpit.db'), '--quiet'],
    }
  },
  ports(ctx: AppContext): readonly number[] {
    return [ctx.state.settings.mail.smtpPort, ctx.state.settings.mail.httpPort]
  },
  async health(ctx: AppContext): Promise<boolean> {
    return tcpReachable(ctx.state.settings.mail.httpPort)
  },
  logs(): readonly NamedFile[] {
    return []
  },
  configs(): readonly NamedFile[] {
    return []
  },
}
