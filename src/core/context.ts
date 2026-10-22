import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDirs, resolvePaths, type Paths } from './paths.ts'
import { loadState, saveState, type State } from './state.ts'
import { loadOrCreateSecrets, type Secrets } from './secrets.ts'
import { render, type TemplateVars } from './templates.ts'

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates')

export type LogFn = (message: string) => void

/** Everything a service or route needs. State is replaced immutably through `update`. */
export class AppContext {
  readonly paths: Paths
  readonly secrets: Secrets
  readonly log: LogFn
  #state: State

  private constructor(paths: Paths, state: State, secrets: Secrets, log: LogFn) {
    this.paths = paths
    this.#state = state
    this.secrets = secrets
    this.log = log
  }

  static async create(options: { env?: NodeJS.ProcessEnv; log?: LogFn } = {}): Promise<AppContext> {
    const paths = resolvePaths(options.env ?? process.env)
    await ensureDirs(paths)
    const [state, secrets] = await Promise.all([loadState(paths.stateFile), loadOrCreateSecrets(paths.secretsFile)])
    return new AppContext(paths, state, secrets, options.log ?? (() => {}))
  }

  get state(): State {
    return this.#state
  }

  async update(mutate: (state: State) => State): Promise<State> {
    this.#state = mutate(this.#state)
    await saveState(this.paths.stateFile, this.#state)
    return this.#state
  }

  async renderTemplate(name: string, vars: TemplateVars): Promise<string> {
    const template = await readFile(join(TEMPLATES_DIR, name), 'utf8')
    return render(template, vars)
  }
}
