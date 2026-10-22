import { access, chmod, mkdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { arch, platform } from 'node:os'
import { join, dirname } from 'node:path'

const execFileAsync = promisify(execFile)

export type Platform = 'macos' | 'linux'
export type Arch = 'aarch64' | 'x86_64'

export function hostPlatform(): { platform: Platform; arch: Arch } {
  const p = platform()
  if (p !== 'darwin' && p !== 'linux') throw new Error(`Unsupported platform: ${p}`)
  const a = arch()
  return { platform: p === 'darwin' ? 'macos' : 'linux', arch: a === 'arm64' ? 'aarch64' : 'x86_64' }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function which(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [command])
    const found = stdout.trim()
    return found === '' ? null : found
  } catch {
    return null
  }
}

/**
 * Download with curl when available (it uses the OS trust store, which matters behind
 * TLS-inspecting proxies) and fall back to fetch. Writes atomically.
 */
export async function download(url: string, dest: string, onProgress?: (message: string) => void): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  await rm(tmp, { force: true })
  onProgress?.(`Downloading ${url}`)
  const curl = await which('curl')
  if (curl) {
    await execFileAsync(curl, ['-fsSL', '--retry', '3', '-o', tmp, url], { maxBuffer: 1024 * 1024 })
  } else {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(tmp, Buffer.from(await response.arrayBuffer()))
  }
  await rename(tmp, dest)
}

export async function extractTar(archive: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  await execFileAsync('tar', ['-xf', archive, '-C', destDir])
}

export async function makeExecutable(path: string): Promise<void> {
  await chmod(path, 0o755)
}

interface GithubAsset {
  readonly name: string
  readonly browser_download_url: string
}

/** Find the latest release asset of a GitHub repo whose name satisfies `match`. */
export async function latestGithubAsset(repo: string, match: (name: string) => boolean): Promise<{ tag: string; name: string; url: string }> {
  const curl = await which('curl')
  const api = `https://api.github.com/repos/${repo}/releases/latest`
  let json: string
  if (curl) {
    const { stdout } = await execFileAsync(curl, ['-fsSL', '-H', 'Accept: application/vnd.github+json', api], { maxBuffer: 4 * 1024 * 1024 })
    json = stdout
  } else {
    const response = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) throw new Error(`GitHub API returned ${response.status} for ${repo}`)
    json = await response.text()
  }
  const release = JSON.parse(json) as { tag_name: string; assets: GithubAsset[] }
  const asset = release.assets.find((a) => match(a.name))
  if (!asset) throw new Error(`No matching release asset for ${repo} (${release.tag_name})`)
  return { tag: release.tag_name, name: asset.name, url: asset.browser_download_url }
}

/** Homebrew prefix for a formula, or null when brew or the formula is missing. */
export async function brewPrefix(formula: string): Promise<string | null> {
  const brew = await which('brew')
  if (!brew) return null
  try {
    const { stdout } = await execFileAsync(brew, ['--prefix', formula])
    const prefix = stdout.trim()
    return (await exists(prefix)) ? prefix : null
  } catch {
    return null
  }
}

export type ProgressFn = (message: string) => void
