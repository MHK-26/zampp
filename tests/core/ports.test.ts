import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { isPortFree, findFreePort, parseLsof } from '../../src/core/ports.ts'

const LSOF = `COMMAND     PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
httpd      4242 mhk26    4u  IPv4 0x1234      0t0  TCP 127.0.0.1:80 (LISTEN)
mariadbd   4300 mhk26   20u  IPv6 0x5678      0t0  TCP [::1]:3306 (LISTEN)
ControlCe   600 mhk26    8u  IPv4 0x9abc      0t0  TCP *:7000 (LISTEN)
`

test('parseLsof extracts command, pid, address and port', () => {
  const listeners = parseLsof(LSOF)
  assert.deepEqual(listeners, [
    { command: 'httpd', pid: 4242, user: 'mhk26', address: '127.0.0.1', port: 80 },
    { command: 'mariadbd', pid: 4300, user: 'mhk26', address: '[::1]', port: 3306 },
    { command: 'ControlCe', pid: 600, user: 'mhk26', address: '*', port: 7000 },
  ])
})

test('parseLsof tolerates empty output', () => {
  assert.deepEqual(parseLsof(''), [])
})

test('isPortFree reports a bound port as busy and findFreePort skips it', async () => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const busy = address.port
  assert.equal(await isPortFree(busy), false)
  const chosen = await findFreePort([busy])
  assert.notEqual(chosen, busy)
  assert.equal(await isPortFree(chosen), true)
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
