import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

export const secretsSchema = z.object({
  /** Bearer token the control panel and CLI must present. */
  token: z.string().min(32),
  /** Generated database root password. XAMPP ships with none; zampp never does. */
  dbRootPassword: z.string().min(16),
})
export type Secrets = z.infer<typeof secretsSchema>

export function generateSecrets(): Secrets {
  return {
    token: randomBytes(32).toString('hex'),
    dbRootPassword: randomBytes(18).toString('base64url'),
  }
}

/** Load the secrets file, creating it (mode 0600) on first use. */
export async function loadOrCreateSecrets(file: string): Promise<Secrets> {
  try {
    const parsed = secretsSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    await chmod(file, 0o600)
    return parsed
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
    if (code !== 'ENOENT') throw error
  }
  const secrets = generateSecrets()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(secrets, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(file, 0o600)
  return secrets
}
