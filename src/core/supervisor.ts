import { spawn } from 'node:child_process'
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { AppContext } from './context.ts'
import { whoListens, isPortFree } from './ports.ts'
import { ServiceError, type ServiceDefinition, type ServiceStatus, type ProgressFn } from './services/types.ts'

export interface SupervisorEvents {
  status: [ServiceStatus]
  log: [string]
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'EPERM')
  }
}

export function tcpReachable(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/**
 * Starts services as detached processes so they outlive the CLI, records pid files and
 * adopts already-running processes on the next run. One instance per process.
 */
export class Supervisor extends EventEmitter<SupervisorEvents> {
  readonly #ctx: AppContext
  readonly #services: () => readonly ServiceDefinition[]

  constructor(ctx: AppContext, services: () => readonly ServiceDefinition[]) {
    super()
    this.#ctx = ctx
    this.#services = services
  }

  get services(): readonly ServiceDefinition[] {
    return this.#services()
  }

  find(id: string): ServiceDefinition {
    const service = this.services.find((s) => s.id === id)
    if (!service) throw new ServiceError('unknown_service', `Unknown service "${id}"`)
    return service
  }

  pidFile(id: string): string {
    return join(this.#ctx.paths.run, `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.pid`)
  }

  outLog(id: string): string {
    return join(this.#ctx.paths.logs, `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.out.log`)
  }

  async readPid(id: string): Promise<number | null> {
    try {
      const pid = Number((await readFile(this.pidFile(id), 'utf8')).trim())
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  async runningPid(id: string): Promise<number | null> {
    const pid = await this.readPid(id)
    if (pid === null) return null
    if (isPidAlive(pid)) return pid
    await rm(this.pidFile(id), { force: true })
    return null
  }

  async status(id: string): Promise<ServiceStatus> {
    const service = this.find(id)
    const [resolved, pid] = await Promise.all([service.resolve(this.#ctx), this.runningPid(id)])
    let startedAt: string | null = null
    if (pid !== null) {
      try {
        startedAt = (await stat(this.pidFile(id))).mtime.toISOString()
      } catch {
        startedAt = null
      }
    }
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      installed: resolved !== null,
      version: resolved?.version ?? null,
      source: resolved?.source ?? null,
      running: pid !== null,
      pid,
      ports: service.ports(this.#ctx),
      startedAt,
      logs: [{ name: 'process output', path: this.outLog(id) }, ...service.logs(this.#ctx)],
      configs: service.configs(this.#ctx),
    }
  }

  async statuses(): Promise<ServiceStatus[]> {
    return Promise.all(this.services.map((s) => this.status(s.id)))
  }

  async install(id: string, progress: ProgressFn = () => {}): Promise<void> {
    const service = this.find(id)
    await service.install(this.#ctx, (m) => {
      progress(m)
      this.emit('log', `[${id}] ${m}`)
    })
  }

  async start(id: string): Promise<ServiceStatus> {
    const service = this.find(id)
    if ((await this.runningPid(id)) !== null) return this.status(id)

    let resolved = await service.resolve(this.#ctx)
    if (!resolved) {
      await this.install(id)
      resolved = await service.resolve(this.#ctx)
      if (!resolved) throw new ServiceError('not_installed', `${service.name} is not installed`)
    }

    for (const port of service.ports(this.#ctx)) {
      if (!(await isPortFree(port))) {
        const owners = await whoListens(port)
        const who = owners.map((o) => `${o.command} (pid ${o.pid})`).join(', ') || 'another process'
        throw new ServiceError('port_in_use', `Port ${port} needed by ${service.name} is in use by ${who}`)
      }
    }

    const launch = await service.prepare(this.#ctx, resolved)
    const out = await open(this.outLog(id), 'a')
    await out.write(`\n--- ${new Date().toISOString()} zampp starting ${id}: ${launch.command} ${launch.args.join(' ')}\n`)
    const child = spawn(launch.command, [...launch.args], {
      detached: true,
      stdio: ['ignore', out.fd, out.fd],
      env: { ...process.env, ...(launch.env ?? {}) },
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
    })
    let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null
    child.once('exit', (code, signal) => {
      exited = { code, signal }
    })
    child.once('error', () => {
      exited = { code: -1, signal: null }
    })
    if (!child.pid) throw new ServiceError('spawn_failed', `Could not start ${service.name}`)
    await writeFile(this.pidFile(id), `${child.pid}\n`, 'utf8')
    child.unref()

    const deadline = Date.now() + (service.startTimeoutMs ?? 20_000)
    while (Date.now() < deadline) {
      if (exited !== null) break
      if (await service.health(this.#ctx)) break
      await sleep(250)
    }
    await out.close()
    if (exited !== null || !(await service.health(this.#ctx))) {
      await rm(this.pidFile(id), { force: true })
      if (exited === null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          /* already gone */
        }
      }
      const tail = await this.tail(this.outLog(id), 15)
      throw new ServiceError('start_failed', `${service.name} did not become healthy.\n${tail}`)
    }
    if (service.afterStart) await service.afterStart(this.#ctx, resolved)
    const status = await this.status(id)
    this.emit('status', status)
    return status
  }

  async stop(id: string, timeoutMs = 15_000): Promise<ServiceStatus> {
    const service = this.find(id)
    const pid = await this.runningPid(id)
    if (pid === null) return this.status(id)
    try {
      process.kill(pid, service.stopSignal ?? 'SIGTERM')
    } catch {
      /* already gone */
    }
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && isPidAlive(pid)) await sleep(150)
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
      await sleep(300)
    }
    await rm(this.pidFile(id), { force: true })
    const status = await this.status(id)
    this.emit('status', status)
    return status
  }

  async restart(id: string): Promise<ServiceStatus> {
    await this.stop(id)
    return this.start(id)
  }

  async tail(file: string, lines: number): Promise<string> {
    try {
      const content = await readFile(file, 'utf8')
      return content.trimEnd().split('\n').slice(-lines).join('\n')
    } catch {
      return ''
    }
  }
}
