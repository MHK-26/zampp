import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

export const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export const siteSchema = z.object({
  name: z.string().regex(SITE_NAME, 'lowercase letters, digits and dashes only'),
  root: z.string().min(1),
  php: z.string().min(1).optional(),
  tls: z.boolean().default(false),
  aliases: z.array(z.string().min(1)).default([]),
  createdAt: z.string().default(() => new Date().toISOString()),
})
export type Site = z.infer<typeof siteSchema>
export type SiteInput = z.input<typeof siteSchema>

export const installedPhpSchema = z.object({
  version: z.string().min(1),
  source: z.enum(['static-php', 'homebrew', 'custom']),
  fpm: z.string().min(1),
  cli: z.string().min(1).optional(),
})
export type InstalledPhp = z.infer<typeof installedPhpSchema>

export const settingsSchema = z.object({
  tld: z.string().regex(/^[a-z]{2,16}$/).default('test'),
  web: z
    .object({
      engine: z.enum(['apache']).default('apache'),
      httpPort: z.number().int().min(1).max(65535).default(80),
      httpsPort: z.number().int().min(1).max(65535).default(443),
    })
    .prefault({}),
  php: z.object({ default: z.string().optional() }).prefault({}),
  db: z
    .object({ engine: z.enum(['mariadb', 'mysql']).default('mariadb'), port: z.number().int().default(3306) })
    .prefault({}),
  mail: z
    .object({ smtpPort: z.number().int().default(1025), httpPort: z.number().int().default(8025) })
    .prefault({}),
  panel: z.object({ port: z.number().int().default(1980) }).prefault({}),
  autostart: z.array(z.string()).default(['apache', 'php-fpm', 'mariadb', 'mailpit']),
})
export type Settings = z.infer<typeof settingsSchema>

export const stateSchema = z.object({
  version: z.literal(1).default(1),
  settings: settingsSchema.prefault({}),
  sites: z.array(siteSchema).default([]),
  php: z.array(installedPhpSchema).default([]),
})
export type State = z.infer<typeof stateSchema>

export function defaultState(): State {
  return stateSchema.parse({})
}

export async function loadState(file: string): Promise<State> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'ENOENT') return defaultState()
    throw error
  }
  return stateSchema.parse(JSON.parse(raw))
}

/** Atomic write: a crash mid-write never leaves a truncated state file. */
export async function saveState(file: string, state: State): Promise<void> {
  const validated = stateSchema.parse(state)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

export function upsertSite(state: State, site: Site): State {
  const others = state.sites.filter((s) => s.name !== site.name)
  return { ...state, sites: [...others, site].sort((a, b) => a.name.localeCompare(b.name)) }
}

export function removeSite(state: State, name: string): State {
  return { ...state, sites: state.sites.filter((s) => s.name !== name) }
}

export function upsertPhp(state: State, php: InstalledPhp): State {
  const others = state.php.filter((p) => p.version !== php.version)
  return { ...state, php: [...others, php].sort((a, b) => compareVersions(b.version, a.version)) }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
