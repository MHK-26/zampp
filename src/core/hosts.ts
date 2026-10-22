import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { platform } from 'node:os'

const execFileAsync = promisify(execFile)

export const HOSTS_FILE = '/etc/hosts'
export const BLOCK_BEGIN = '# zampp managed block - begin (do not edit by hand)'
export const BLOCK_END = '# zampp managed block - end'

export interface HostEntry {
  readonly ip: string
  readonly hostnames: readonly string[]
}

export function renderManagedBlock(entries: readonly HostEntry[]): string {
  const lines = entries.filter((e) => e.hostnames.length > 0).map((e) => `${e.ip}\t${[...e.hostnames].join(' ')}`)
  if (lines.length === 0) return ''
  return [BLOCK_BEGIN, ...lines, BLOCK_END].join('\n')
}

/** Returns the hosts file content with the managed block replaced, added or removed. */
export function applyManagedBlock(content: string, entries: readonly HostEntry[]): string {
  const block = renderManagedBlock(entries)
  const begin = content.indexOf(BLOCK_BEGIN)
  const end = content.indexOf(BLOCK_END)
  const normalised = content.endsWith('\n') || content === '' ? content : `${content}\n`
  if (begin !== -1 && end !== -1 && end > begin) {
    const before = normalised.slice(0, begin)
    const after = normalised.slice(end + BLOCK_END.length).replace(/^\n/, '')
    const middle = block === '' ? '' : `${block}\n`
    return before + middle + after
  }
  if (block === '') return normalised
  return `${normalised}${normalised.endsWith('\n\n') || normalised === '' ? '' : '\n'}${block}\n`
}

export function parseManagedBlock(content: string): HostEntry[] {
  const begin = content.indexOf(BLOCK_BEGIN)
  const end = content.indexOf(BLOCK_END)
  if (begin === -1 || end === -1 || end < begin) return []
  return content
    .slice(begin + BLOCK_BEGIN.length, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => {
      const [ip, ...hostnames] = l.split(/\s+/)
      return { ip: ip ?? '', hostnames }
    })
}

export async function readHosts(file = HOSTS_FILE): Promise<string> {
  return readFile(file, 'utf8')
}

/**
 * Write the hosts file with elevated privileges. On macOS this shows the standard
 * administrator password dialog; elsewhere it falls back to sudo on the terminal.
 */
export async function writeHostsPrivileged(content: string, file = HOSTS_FILE): Promise<void> {
  const encoded = Buffer.from(content, 'utf8').toString('base64')
  const shell = `printf '%s' '${encoded}' | /usr/bin/base64 -d > '${file}' && /usr/bin/dscacheutil -flushcache && /usr/bin/killall -HUP mDNSResponder`
  if (platform() === 'darwin') {
    const script = `do shell script ${JSON.stringify(shell)} with administrator privileges`
    await execFileAsync('osascript', ['-e', script])
    return
  }
  await execFileAsync('sudo', ['sh', '-c', `printf '%s' '${encoded}' | base64 -d > '${file}'`])
}
