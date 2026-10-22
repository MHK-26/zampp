import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'

/** Every file zampp owns lives under one home directory. */
export interface Paths {
  readonly home: string
  readonly bin: string
  readonly etc: string
  readonly sitesEtc: string
  readonly logs: string
  readonly run: string
  readonly www: string
  readonly data: string
  readonly ssl: string
  readonly cache: string
  readonly stateFile: string
  readonly secretsFile: string
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = resolve(env.ZAMPP_HOME && env.ZAMPP_HOME.trim() !== '' ? env.ZAMPP_HOME : join(homedir(), '.zampp'))
  return {
    home,
    bin: join(home, 'bin'),
    etc: join(home, 'etc'),
    sitesEtc: join(home, 'etc', 'sites'),
    logs: join(home, 'logs'),
    run: join(home, 'run'),
    www: join(home, 'www'),
    data: join(home, 'data'),
    ssl: join(home, 'ssl'),
    cache: join(home, 'cache'),
    stateFile: join(home, 'state.json'),
    secretsFile: join(home, 'secrets.json'),
  }
}

export async function ensureDirs(paths: Paths): Promise<void> {
  const dirs = [paths.home, paths.bin, paths.etc, paths.sitesEtc, paths.logs, paths.run, paths.www, paths.data, paths.ssl, paths.cache]
  await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })))
}
