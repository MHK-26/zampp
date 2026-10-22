import type { AppContext } from '../context.ts'
import { apacheService } from './apache.ts'
import { mariadbService } from './mariadb.ts'
import { mailpitService } from './mailpit.ts'
import { phpFpmService, PHP_FPM_PREFIX } from './phpfpm.ts'
import type { ServiceDefinition } from './types.ts'

/** Every service the supervisor knows about, including one PHP-FPM per installed version. */
export function allServices(ctx: AppContext): ServiceDefinition[] {
  return [apacheService, ...ctx.state.php.map(phpFpmService), mariadbService, mailpitService]
}

export function isPhpFpmId(id: string): boolean {
  return id.startsWith(PHP_FPM_PREFIX)
}

export { PHP_FPM_PREFIX }
