import type { AppContext } from '../context.ts'

export interface Resolved {
  /** Absolute path to the executable. */
  readonly command: string
  readonly version: string | null
  /** Where it came from: system, homebrew, static download… */
  readonly source: string
}

export interface Launch {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
}

export interface NamedFile {
  readonly name: string
  readonly path: string
}

export type ProgressFn = (message: string) => void

export interface ServiceDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Signal used for a graceful stop (default SIGTERM). */
  readonly stopSignal?: NodeJS.Signals
  /** How long to wait for health after spawning, in ms. */
  readonly startTimeoutMs?: number
  resolve(ctx: AppContext): Promise<Resolved | null>
  install(ctx: AppContext, progress: ProgressFn): Promise<void>
  prepare(ctx: AppContext, resolved: Resolved): Promise<Launch>
  ports(ctx: AppContext): readonly number[]
  health(ctx: AppContext): Promise<boolean>
  afterStart?(ctx: AppContext, resolved: Resolved): Promise<void>
  logs(ctx: AppContext): readonly NamedFile[]
  configs(ctx: AppContext): readonly NamedFile[]
}

export interface ServiceStatus {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly installed: boolean
  readonly version: string | null
  readonly source: string | null
  readonly running: boolean
  readonly pid: number | null
  readonly ports: readonly number[]
  readonly startedAt: string | null
  readonly logs: readonly NamedFile[]
  readonly configs: readonly NamedFile[]
}

export class ServiceError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
