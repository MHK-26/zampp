import type { AppContext } from './context.ts'
import type { Supervisor } from './supervisor.ts'
import { ensurePhp, requiredPhpVersions } from './php.ts'
import { ensureAdminer } from './www.ts'
import { PHP_FPM_PREFIX } from './services/index.ts'
import type { ProgressFn } from './provision.ts'
import type { ServiceStatus } from './services/types.ts'
import { probePort, findFreePort } from './ports.ts'

export interface StackResult {
  readonly started: ServiceStatus[]
  readonly failed: { id: string; error: string }[]
}

/** Download/detect everything the default stack needs. Idempotent and safe to call often. */
export async function ensureProvisioned(ctx: AppContext, sup: Supervisor, progress: ProgressFn = () => {}): Promise<void> {
  await ensurePhp(ctx, progress)
  await ensureAdminer(ctx, progress)
  for (const id of ['mailpit', 'mariadb', 'apache']) {
    const service = sup.find(id)
    if ((await service.resolve(ctx)) === null) await sup.install(id, progress)
  }
}

/** Service ids the autostart list expands to right now. */
export function autostartIds(ctx: AppContext): string[] {
  const ids: string[] = []
  for (const entry of ctx.state.settings.autostart) {
    if (entry === 'php-fpm') ids.push(...requiredPhpVersions(ctx).map((v) => `${PHP_FPM_PREFIX}${v}`))
    else ids.push(entry)
  }
  return [...new Set(ids)]
}

export const FALLBACK_HTTP_PORTS = [8080, 8000, 8888, 8081]
export const FALLBACK_HTTPS_PORTS = [8443, 8444, 9443]

/**
 * Ports 80/443 are the XAMPP defaults, but many systems refuse them without root.
 * When the OS denies the bind, switch to the first free high port and remember it.
 */
export async function ensureWebPorts(ctx: AppContext, sup: Supervisor, progress: ProgressFn = () => {}): Promise<{ httpPort: number; httpsPort: number; changed: boolean }> {
  const { httpPort, httpsPort } = ctx.state.settings.web
  if ((await sup.status('apache')).running) return { httpPort, httpsPort, changed: false }
  let nextHttp = httpPort
  let nextHttps = httpsPort
  if ((await probePort(httpPort)) === 'denied') nextHttp = await findFreePort(FALLBACK_HTTP_PORTS)
  if ((await probePort(httpsPort)) === 'denied') nextHttps = await findFreePort(FALLBACK_HTTPS_PORTS)
  const changed = nextHttp !== httpPort || nextHttps !== httpsPort
  if (changed) {
    progress(`Ports ${httpPort}/${httpsPort} need administrator rights here; using ${nextHttp}/${nextHttps} instead (change in Settings)`)
    await ctx.update((s) => ({ ...s, settings: { ...s.settings, web: { ...s.settings.web, httpPort: nextHttp, httpsPort: nextHttps } } }))
  }
  return { httpPort: nextHttp, httpsPort: nextHttps, changed }
}

export async function startAll(ctx: AppContext, sup: Supervisor, progress: ProgressFn = () => {}): Promise<StackResult> {
  await ensureProvisioned(ctx, sup, progress)
  await ensureWebPorts(ctx, sup, progress)
  const ids = autostartIds(ctx)
  // PHP-FPM first so Apache's FastCGI sockets exist; the rest in parallel.
  const php = ids.filter((id) => id.startsWith(PHP_FPM_PREFIX))
  const rest = ids.filter((id) => !id.startsWith(PHP_FPM_PREFIX))
  const started: ServiceStatus[] = []
  const failed: { id: string; error: string }[] = []
  const run = async (id: string) => {
    try {
      progress(`Starting ${id}`)
      started.push(await sup.start(id))
    } catch (error: unknown) {
      failed.push({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const id of php) await run(id)
  await Promise.all(rest.map(run))
  return { started, failed }
}

export async function stopAll(sup: Supervisor): Promise<ServiceStatus[]> {
  const statuses = await sup.statuses()
  return Promise.all(statuses.filter((s) => s.running).map((s) => sup.stop(s.id)))
}
