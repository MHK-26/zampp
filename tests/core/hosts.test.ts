import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyManagedBlock, parseManagedBlock, renderManagedBlock, BLOCK_BEGIN, BLOCK_END } from '../../src/core/hosts.ts'

const BASE = '127.0.0.1\tlocalhost\n255.255.255.255\tbroadcasthost\n::1             localhost\n'

test('adds a managed block to a hosts file without one', () => {
  const out = applyManagedBlock(BASE, [{ ip: '127.0.0.1', hostnames: ['app.test', 'www.app.test'] }])
  assert.ok(out.startsWith(BASE))
  assert.ok(out.includes(`${BLOCK_BEGIN}\n127.0.0.1\tapp.test www.app.test\n${BLOCK_END}\n`))
})

test('replaces an existing block in place and keeps the rest intact', () => {
  const first = applyManagedBlock(BASE, [{ ip: '127.0.0.1', hostnames: ['a.test'] }])
  const withTrailer = `${first}# user line after\n`
  const second = applyManagedBlock(withTrailer, [{ ip: '127.0.0.1', hostnames: ['b.test'] }])
  assert.ok(!second.includes('a.test'))
  assert.ok(second.includes('b.test'))
  assert.ok(second.endsWith('# user line after\n'))
  assert.equal(second.split(BLOCK_BEGIN).length, 2)
})

test('removes the block when there are no entries', () => {
  const first = applyManagedBlock(BASE, [{ ip: '127.0.0.1', hostnames: ['a.test'] }])
  assert.equal(applyManagedBlock(first, []), BASE)
})

test('parseManagedBlock round-trips renderManagedBlock', () => {
  const entries = [{ ip: '127.0.0.1', hostnames: ['a.test'] }, { ip: '::1', hostnames: ['a.test', 'b.test'] }]
  assert.deepEqual(parseManagedBlock(renderManagedBlock(entries)), entries)
  assert.deepEqual(parseManagedBlock(BASE), [])
})
