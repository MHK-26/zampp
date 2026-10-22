import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import type { AppContext } from './context.ts'
import { brewPrefix, download, exists, extractTar, hostPlatform, makeExecutable, which, type ProgressFn } from './provision.ts'
import { compareVersions, upsertPhp, type InstalledPhp } from './state.ts'

const execFileAsync = promisify(execFile)
export const STATIC_PHP_INDEX = 'https://dl.static-php.dev/static-php-cli/common/'

export function phpSocket(ctx: AppContext, version: string): string {
  return join(ctx.paths.run, `php-${version}.sock`)
}

export function phpEtcDir(ctx: AppContext, version: string): string {
  return join(ctx.paths.etc, 'php', version)
}

export async function phpVersionOf(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['-v'])
    return /PHP (\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
  } catch {
    return null
  }
}

/** Versions published by static-php-cli for this platform, newest first. Exported parser for tests. */
export function parseStaticPhpIndex(html: string, platform: string, arch: string): string[] {
  const re = new RegExp(`php-(\\d+\\.\\d+\\.\\d+)-fpm-${platform}-${arch}\\.tar\\.gz`, 'g')
  const versions = new Set<string>()
  for (const m of html.matchAll(re)) if (m[1]) versions.add(m[1])
  return [...versions].sort((a, b) => compareVersions(b, a))
}

export async function listStaticPhpVersions(): Promise<string[]> {
  const { platform, arch } = hostPlatform()
  const curl = await which('curl')
  let html: string
  if (curl) {
    const { stdout } = await execFileAsync(curl, ['-fsSL', STATIC_PHP_INDEX], { maxBuffer: 16 * 1024 * 1024 })
    html = stdout
  } else {
    const res = await fetch(STATIC_PHP_INDEX)
    if (!res.ok) throw new Error(`static-php index returned ${res.status}`)
    html = await res.text()
  }
  return parseStaticPhpIndex(html, platform, arch)
}

/** "8.4" → newest 8.4.x; "latest" → newest overall; "8.4.27" → itself if published. */
export function pickVersion(available: readonly string[], requested: string): string {
  if (requested === 'latest') {
    const first = available[0]
    if (!first) throw new Error('No PHP versions available')
    return first
  }
  const exact = available.find((v) => v === requested)
  if (exact) return exact
  const minor = available.find((v) => v.startsWith(`${requested}.`))
  if (minor) return minor
  throw new Error(`PHP ${requested} is not available from static-php-cli`)
}

export async function installStaticPhp(ctx: AppContext, requested: string, progress: ProgressFn = () => {}): Promise<InstalledPhp> {
  const { platform, arch } = hostPlatform()
  const available = await listStaticPhpVersions()
  const version = pickVersion(available, requested)
  const dir = join(ctx.paths.bin, 'php', version)
  const fpm = join(dir, 'php-fpm')
  const cli = join(dir, 'php')
  if (!(await exists(fpm)) || !(await exists(cli))) {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    for (const flavour of ['fpm', 'cli']) {
      const file = `php-${version}-${flavour}-${platform}-${arch}.tar.gz`
      const archive = join(ctx.paths.cache, file)
      if (!(await exists(archive))) await download(`${STATIC_PHP_INDEX}${file}`, archive, progress)
      progress(`Extracting ${file}`)
      await extractTar(archive, dir)
    }
    await Promise.all([makeExecutable(fpm), makeExecutable(cli)])
  }
  const installed: InstalledPhp = { version, source: 'static-php', fpm, cli }
  await ctx.update((s) => upsertPhp(s, installed))
  progress(`PHP ${version} ready`)
  return installed
}

/** Register any Homebrew PHP installs as usable versions (no download needed). */
export async function detectHomebrewPhp(ctx: AppContext): Promise<InstalledPhp[]> {
  const found: InstalledPhp[] = []
  for (const formula of ['php', 'php@8.5', 'php@8.4', 'php@8.3', 'php@8.2', 'php@8.1']) {
    const prefix = await brewPrefix(formula)
    if (!prefix) continue
    const fpm = join(prefix, 'sbin', 'php-fpm')
    const cli = join(prefix, 'bin', 'php')
    if (!(await exists(fpm))) continue
    const version = await phpVersionOf(cli)
    if (!version || found.some((f) => f.version === version)) continue
    found.push({ version, source: 'homebrew', fpm, cli })
  }
  if (found.length > 0) await ctx.update((s) => found.reduce((acc, p) => upsertPhp(acc, p), s))
  return found
}

export function installedPhp(ctx: AppContext): readonly InstalledPhp[] {
  return ctx.state.php
}

export function defaultPhp(ctx: AppContext): InstalledPhp | null {
  const wanted = ctx.state.settings.php.default
  const list = ctx.state.php
  return list.find((p) => p.version === wanted) ?? list[0] ?? null
}

/** Make sure at least one PHP exists: Homebrew first (free), then the newest static build. */
export async function ensurePhp(ctx: AppContext, progress: ProgressFn = () => {}): Promise<InstalledPhp> {
  const current = defaultPhp(ctx)
  if (current && (await exists(current.fpm))) return current
  const brew = await detectHomebrewPhp(ctx)
  if (brew.length > 0 && brew[0]) return brew[0]
  return installStaticPhp(ctx, 'latest', progress)
}

/** Versions a running stack needs: the default plus every version pinned by a site. */
export function requiredPhpVersions(ctx: AppContext): string[] {
  const versions = new Set<string>()
  const def = defaultPhp(ctx)
  if (def) versions.add(def.version)
  for (const site of ctx.state.sites) if (site.php) versions.add(site.php)
  return [...versions].filter((v) => ctx.state.php.some((p) => p.version === v))
}
