import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppContext } from './context.ts'
import { download, exists, hostPlatform, latestGithubAsset, makeExecutable, which, type ProgressFn } from './provision.ts'

const execFileAsync = promisify(execFile)

export function mkcertBinary(ctx: AppContext): string {
  return join(ctx.paths.bin, 'mkcert', 'mkcert')
}

export function caRoot(ctx: AppContext): string {
  return join(ctx.paths.ssl, 'ca')
}

export function certificateFiles(ctx: AppContext, host: string): { cert: string; key: string } {
  return { cert: join(ctx.paths.ssl, `${host}.pem`), key: join(ctx.paths.ssl, `${host}-key.pem`) }
}

export async function ensureMkcert(ctx: AppContext, progress: ProgressFn = () => {}): Promise<string> {
  const bin = mkcertBinary(ctx)
  if (await exists(bin)) return bin
  const onPath = await which('mkcert')
  if (onPath) return onPath
  const { platform, arch } = hostPlatform()
  const os = platform === 'macos' ? 'darwin' : 'linux'
  const cpu = arch === 'aarch64' ? 'arm64' : 'amd64'
  const asset = await latestGithubAsset('FiloSottile/mkcert', (n) => n.endsWith(`-${os}-${cpu}`))
  await mkdir(join(ctx.paths.bin, 'mkcert'), { recursive: true })
  await download(asset.url, bin, progress)
  await makeExecutable(bin)
  progress(`mkcert ${asset.tag} ready`)
  return bin
}

/** Installs the local CA into the system trust store (prompts for the admin password once). */
export async function ensureLocalCa(ctx: AppContext, progress: ProgressFn = () => {}): Promise<void> {
  const bin = await ensureMkcert(ctx, progress)
  await mkdir(caRoot(ctx), { recursive: true })
  const rootCert = join(caRoot(ctx), 'rootCA.pem')
  const alreadyTrusted = await exists(join(caRoot(ctx), '.trusted'))
  if (alreadyTrusted && (await exists(rootCert))) return
  progress('Installing the zampp local certificate authority (admin password prompt)')
  await execFileAsync(bin, ['-install'], { env: { ...process.env, CAROOT: caRoot(ctx) } })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(caRoot(ctx), '.trusted'), new Date().toISOString(), 'utf8')
}

export async function ensureSiteCertificate(ctx: AppContext, host: string, progress: ProgressFn = () => {}): Promise<{ cert: string; key: string }> {
  const files = certificateFiles(ctx, host)
  if ((await exists(files.cert)) && (await exists(files.key))) return files
  await ensureLocalCa(ctx, progress)
  const bin = await ensureMkcert(ctx, progress)
  await mkdir(ctx.paths.ssl, { recursive: true })
  await execFileAsync(bin, ['-cert-file', files.cert, '-key-file', files.key, host, `*.${host}`, 'localhost', '127.0.0.1', '::1'], {
    env: { ...process.env, CAROOT: caRoot(ctx) },
  })
  return files
}
