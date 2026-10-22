import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStaticPhpIndex, pickVersion } from '../../src/core/php.ts'

const HTML = `
<a href="php-8.4.27-fpm-macos-aarch64.tar.gz">x</a>
<a href="php-8.5.8-fpm-macos-aarch64.tar.gz">x</a>
<a href="php-8.5.7-fpm-macos-aarch64.tar.gz">x</a>
<a href="php-8.5.8-cli-macos-aarch64.tar.gz">x</a>
<a href="php-8.3.30-fpm-linux-x86_64.tar.gz">x</a>
`

test('parseStaticPhpIndex returns fpm versions for the platform, newest first', () => {
  assert.deepEqual(parseStaticPhpIndex(HTML, 'macos', 'aarch64'), ['8.5.8', '8.5.7', '8.4.27'])
  assert.deepEqual(parseStaticPhpIndex(HTML, 'linux', 'x86_64'), ['8.3.30'])
})

test('pickVersion resolves latest, minor and exact requests', () => {
  const available = ['8.5.8', '8.5.7', '8.4.27']
  assert.equal(pickVersion(available, 'latest'), '8.5.8')
  assert.equal(pickVersion(available, '8.4'), '8.4.27')
  assert.equal(pickVersion(available, '8.5.7'), '8.5.7')
  assert.throws(() => pickVersion(available, '7.4'))
})
